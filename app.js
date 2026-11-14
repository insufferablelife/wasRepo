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

// Routes
app.get('/', (req, res) => {
    res.render('index', { user: req.session.user, messages: req.flash('success')});
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
    res.render('dashboard', { user: req.session.user, messages: req.flash('success'), errors: req.flash('error') });
});

//******** TODO: Insert code for admin route to render dashboard page for admin. ********//
app.get('/admin', checkAuthenticated, checkAdmin, (req, res) => {
    res.render('admin', { user: req.session.user });
});

// ******** Asset Request routes ******** //

// Available assets of a chosen type (feeds the 2nd dropdown)
app.get('/assets/available', checkAuthenticated, (req, res) => {
    const type = req.query.type || '';

    // INSECURE: type is interpolated directly into the SQL (SQL injection)
    const sql = `
        SELECT id, name, serial_no FROM asset
        WHERE type = '${type}'
        AND id NOT IN (SELECT asset_id FROM asset_requests WHERE status = 'Approved')
        ORDER BY name
    `;

    db.query(sql, (err, rows) => {
        if (err) {
            // Raw SQL error exposed for error-based demonstration
            return res.status(500).json({ error: err.message });
        }
        res.json(rows);
    });
});

// Show the asset request form + the logged-in user's own requests
app.get('/assets/request', checkAuthenticated, (req, res) => {
    const userId = req.session.user.id;

    // Only list types that still have at least one available asset
    const typesSql = `
        SELECT DISTINCT type FROM asset
        WHERE id NOT IN (SELECT asset_id FROM asset_requests WHERE status = 'Approved')
        ORDER BY type
    `;

    const requestsSql = `
        SELECT r.id, a.name, a.type, a.serial_no, r.start_date, r.end_date,
               r.purpose, r.status, r.created_at
        FROM asset_requests r
        JOIN asset a ON a.id = r.asset_id
        WHERE r.user_id = ${userId}
        ORDER BY r.created_at DESC
    `;

    db.query(typesSql, (err, types) => {
        if (err) {
            return res.status(500).send('Database Error: ' + err.message);
        }

        db.query(requestsSql, (err2, requests) => {
            if (err2) {
                return res.status(500).send('Database Error: ' + err2.message);
            }

            res.render('assetrequest', {
                user: req.session.user,
                types,
                requests,
                messages: req.flash('success'),
                errors: req.flash('error')
            });
        });
    });
});

// Submit a borrow request
app.post('/assets/request', checkAuthenticated, (req, res) => {
    const userId = req.session.user.id;
    const { asset_id, start_date, end_date, purpose, comments } = req.body;

    if (!asset_id || !start_date || !end_date || !purpose) {
        req.flash('error', 'Please select an asset, choose the dates and state the purpose of the loan.');
        return res.redirect('/assets/request');
    }

    if (end_date < start_date) {
        req.flash('error', 'End date cannot be before the start date.');
        return res.redirect('/assets/request');
    }

    // INSECURE: asset_id is interpolated directly into the SQL (numeric injection)
    const checkSql = `
        SELECT id FROM asset_requests
        WHERE user_id = ${userId} AND asset_id = ${asset_id} AND status = 'Pending'
    `;

    db.query(checkSql, (err, existing) => {
        if (err) {
            return res.status(500).send('Database Error: ' + err.message);
        }

        if (existing.length > 0) {
            req.flash('error', 'You already have a pending request for this asset.');
            return res.redirect('/assets/request');
        }

        const commentsValue = comments ? `'${comments}'` : 'NULL';

        // INSECURE: purpose / comments / dates are interpolated directly into the SQL
        const insertSql = `
            INSERT INTO asset_requests (user_id, asset_id, start_date, end_date, purpose, comments)
            VALUES (${userId}, ${asset_id}, '${start_date}', '${end_date}', '${purpose}', ${commentsValue})
        `;

        db.query(insertSql, (err2) => {
            if (err2) {
                return res.status(500).send('Database Error: ' + err2.message);
            }

            req.flash('success', 'Asset request submitted. Waiting for admin approval.');
            res.redirect('/assets/request');
        });
    });
});

// ******** Integration for User Management Router ******** //
const userManagementRouter = require('./usermanagement')(db);
app.use('/admin/users', checkAuthenticated, checkAdmin, userManagementRouter);

// ******** Integration for Forum Router ******** //
const forumRouter = require('./forum')(db);
app.use('/forum', checkAuthenticated, forumRouter);

// ******** Integration for Profile Router ******** //
const profileRouter = require('./profile')(db);
app.use('/profile', checkAuthenticated, profileRouter);

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
