const express = require('express');
const mysql = require('mysql2');

//******** TODO: Insert code to import 'express-session' *********//
const session = require('express-session')

const flash = require('connect-flash');

const app = express();

// Database connection
const db = mysql.createConnection({
    host: '127.0.0.1',
    user: 'root',
    password: 'Republic_C207',
    database: 'fypdb',
    multipleStatements: true
});

db.connect((err) => {
    if (err) {
        throw err;
    }
    console.log('\x1b[32mConnected to database\x1b[0m');
});

app.use(express.urlencoded({ extended: false }));
app.use(express.static('public'));

//******** TODO: Insert code for Session Middleware below ********//
app.use(session({
    secret: 'secret',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }

}));

app.use(flash());

// Setting up EJS
app.set('view engine', 'ejs');

//******** TODO: Create a Middleware to check if user is logged in. ********//
const checkAuthenticated = (req, res, next) => {
    if (req.session.user) {
        return next();
    } else {
        req.flash('error', 'Please log in to view this resource');
        res.redirect('/login')
    }
}

//******** TODO: Create a Middleware to check if user is admin. ********//
const checkAdmin = (req, res, next) => {
    if (req.session.user.role === 'admin') {
        return next();
    } else {
        req.flash('error', 'Access denied');
        res.redirect('/dashboard')
    }
}

//******** New Middleware: Redirect to dashboard if already logged in ********//
const redirectIfAuthenticated = (req, res, next) => {
    if (req.session && req.session.user) {
        return res.redirect('/dashboard');
    }
    next();
};

// Routes
app.get('/', redirectIfAuthenticated, (req, res) => {
    res.render('index', { user: req.session.user, messages: req.flash('success') });
});

app.get('/register', (req, res) => {
    res.render('register', { messages: req.flash('error'), formData: req.flash('formData')[0] });
});


//******** TODO: Create a middleware function validateRegistration ********//
const validateRegistration = (req, res, next) => {
    const { username, email, password, home_address, contact} = req.body;

    if (!username || !email || !password || !home_address || !contact) {
        return res.status(400).send('All fields are required.')
    }

    if (password.length < 6) {
        req.flash( 'error', 'Password should be at least 6 or more characters long');
        req.flash('formData', req.body);
        return res.redirect('/register');
    }
    next();
}


//******** TODO: Integrate validateRegistration into the register route. ********//
app.post('/register', validateRegistration, (req, res) => {
    const { username, email, password, home_address, work_address, contact } = req.body;
    const role = 'user';

    const workAddrValue = work_address ? `'${work_address}'` : 'NULL';

    // INSECURE: Direct variable interpolation allows breaking out of SQL syntax
    const sql = `
        INSERT INTO users (username, email, password, contact, role, home_address, work_address)
        VALUES ('${username}', '${email}', SHA2('${password}', 256), '${contact}', '${role}', '${home_address}', ${workAddrValue})
    `;

    db.query(sql, (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Registration failed. Error: ' + err.message);
        }

        req.flash('success', 'Registration successful! Please log in.');
        res.redirect('/login');
    });
});

//******** TODO: Insert code for login routes to render login page below ********//
app.get('/login', (req,res) => {
    res.render('login', {
        messages: req.flash('success'),
        errors: req.flash('error')
    });
});

//******** TODO: Insert code for login routes for form submission below ********//
app.post('/login', (req, res) => {
    const { email, password } = req.body;

    // INSECURE: Unescaped string injection in login, fyi, amin@admin.com' #
    const sql = `SELECT * FROM users WHERE email = '${email}' AND password = SHA2('${password}', 256)`;
    
    db.query(sql, (err, results) => {
        if (err) {
            // Exposing raw SQL errors for educational error-based demonstration
            return res.status(500).send('Database Error: ' + err.message);
        }

        if (results.length > 0) {
            req.session.user = results[0];
            req.flash('success', 'Login successful!');
            res.redirect('/dashboard');
        } else {
            req.flash('error', 'Invalid email or password.');
            res.redirect('/login');
        }
    });
});

//******** TODO: Insert code for dashboard route to render dashboard page for users. ********//
app.get('/dashboard', checkAuthenticated, (req, res) => {
    const user = req.session.user;
    const recentPostsSql = `
        SELECT p.id, p.title, p.content, p.created_at, u.username
        FROM forum_posts p
        JOIN users u ON u.id = p.user_id
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT 5
    `;

    const userRequestsSql = `
        SELECT r.id, m.name, m.type, m.specs, a.serial_no,
               r.start_date, r.end_date, r.purpose, r.status, r.created_at
        FROM asset_requests r
        LEFT JOIN asset a ON a.id = r.asset_id
        LEFT JOIN asset_models m ON m.id = COALESCE(r.model_id, a.model_id)
        WHERE r.user_id = ?
        ORDER BY r.created_at DESC, r.id DESC
    `;

    db.query(recentPostsSql, (postsError, recentPosts) => {
        if (postsError) {
            console.error(postsError);
            return res.status(500).send('Unable to load recent forum posts.');
        }

        db.query(userRequestsSql, [user.id], (requestsError, requests) => {
            if (requestsError) {
                console.error(requestsError);
                return res.status(500).send('Unable to load your asset requests.');
            }

            res.render('dashboard', {
                user,
                username: user.username,
                recentPosts,
                requests,
                messages: req.flash('success'),
                errors: req.flash('error')
            });
        });
    });
});

//******** TODO: Insert code for admin route to render dashboard page for admin. ********//
app.get('/admin', checkAuthenticated, checkAdmin, (req, res) => {
    res.render('admin', { user: req.session.user });
});

// Profile Routes (Fixed to prevent asset_models errors and support /profile/:id)
app.get('/profile', checkAuthenticated, (req, res) => {
    res.redirect('/profile/' + req.session.user.id);
});

app.get('/profile/:id', checkAuthenticated, (req, res) => {
    const profileId = req.params.id;
    const currentUserId = req.session.user.id;
    const isOwnProfile = String(profileId) === String(currentUserId);

    const userSql = `
        SELECT u.id, u.username, u.email, u.contact, u.role, u.home_address, u.work_address, p.about_me
        FROM users u
        LEFT JOIN user_profiles p ON p.user_id = u.id
        WHERE u.id = ?
    `;

    const postsSql = `
        SELECT p.id, p.title, p.content, p.created_at, c.name AS category_name,
               (SELECT COUNT(*) FROM forum_comments fc WHERE fc.post_id = p.id) AS reply_count
        FROM forum_posts p
        LEFT JOIN forum_categories c ON c.id = p.category_id
        WHERE p.user_id = ?
        ORDER BY p.created_at DESC
        LIMIT 10
    `;

    const repliesSql = `
        SELECT fc.id, fc.post_id, fc.content, fc.created_at, fp.title AS post_title
        FROM forum_comments fc
        JOIN forum_posts fp ON fp.id = fc.post_id
        WHERE fc.user_id = ?
        ORDER BY fc.created_at DESC
        LIMIT 10
    `;

    const assetCommentsSql = `
        SELECT ac.id, ac.asset_id, ac.content, ac.type, ac.is_pinned, ac.created_at, a.name AS asset_name
        FROM asset_comments ac
        JOIN asset a ON a.id = ac.asset_id
        WHERE ac.user_id = ?
        ORDER BY ac.created_at DESC
        LIMIT 10
    `;

    db.query(userSql, [profileId], (err, userResults) => {
        if (err || userResults.length === 0) {
            console.error(err);
            return res.status(404).send('User profile not found.');
        }

        const profile = userResults[0];

        db.query(postsSql, [profileId], (errPosts, posts) => {
            if (errPosts) posts = [];
            db.query(repliesSql, [profileId], (errReplies, replies) => {
                if (errReplies) replies = [];
                db.query(assetCommentsSql, [profileId], (errAsset, assetComments) => {
                    if (errAsset) assetComments = [];

                    res.render('profile', {
                        profile,
                        isOwnProfile,
                        user: req.session.user,
                        success: req.flash('success'),
                        error: req.flash('error'),
                        activity: {
                            posts,
                            replies,
                            assetComments
                        }
                    });
                });
            });
        });
    });
});

app.get('/profile/edit', checkAuthenticated, (req, res) => {
    const userId = req.session.user.id;
    const sql = `
        SELECT u.id, u.username, u.email, u.contact, u.home_address, u.work_address, p.about_me
        FROM users u
        LEFT JOIN user_profiles p ON p.user_id = u.id
        WHERE u.id = ?
    `;
    db.query(sql, [userId], (err, results) => {
        if (err || results.length === 0) {
            return res.status(404).send('User not found.');
        }
        res.render('edit_profile', {
            formData: results[0],
            errors: req.flash('error'),
            success: req.flash('success'),
            user: req.session.user
        });
    });
});

app.post('/profile/edit', checkAuthenticated, (req, res) => {
    const userId = req.session.user.id;
    const { username, email, contact, home_address, work_address, about_me } = req.body;

    const updateUserSql = `
        UPDATE users SET username = ?, email = ?, contact = ?, home_address = ?, work_address = ?
        WHERE id = ?
    `;
    const upsertProfileSql = `
        INSERT INTO user_profiles (user_id, about_me) VALUES (?, ?)
        ON DUPLICATE KEY UPDATE about_me = ?
    `;

    db.query(updateUserSql, [username, email, contact, home_address, work_address || null, userId], (err) => {
        if (err) {
            req.flash('error', 'Failed to update profile: ' + err.message);
            req.flash('formData', req.body);
            return res.redirect('/profile/edit');
        }

        db.query(upsertProfileSql, [userId, about_me || '', about_me || ''], (err2) => {
            if (err2) console.error(err2);
            req.session.user.username = username;
            req.session.user.email = email;
            req.flash('success', 'Profile updated successfully.');
            res.redirect('/profile/' + userId);
        });
    });
});

// ******** Integration for Asset Request Router ******** //
const assetRequestRouter = require('./assetrequests')(db);
app.use('/assets', checkAuthenticated, assetRequestRouter);

// ******** Integration for User Management Router ******** //
const userManagementRouter = require('./usermanagement')(db);
app.use('/admin/users', checkAuthenticated, checkAdmin, userManagementRouter);

// ******** Integration for Admin Asset Management Router ******** //
const adminAssetsRouter = require('./adminassets')(db);
app.use('/admin/assets', checkAuthenticated, checkAdmin, adminAssetsRouter);

// ******** Integration for Forum Router ******** //
const forumRouter = require('./forum')(db);
app.use('/forum', checkAuthenticated, forumRouter);

//******** TODO: Insert code for logout route ********//
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// Starting the server
app.listen(3000, () => {
    console.log('\x1b[32mServer started on port 3000\x1b[0m');
    console.log('\x1b[31mCAUTION: This application is intentionally vulnerable for educational purposes. Do not use in production.\x1b[0m');
});