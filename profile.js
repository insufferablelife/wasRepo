
const express = require('express');

module.exports = function (db) {
    const router = express.Router();

    // Promise wrapper for the existing mysql2 connection
    const query = (sql, params = []) => new Promise((resolve, reject) => {
        db.query(sql, params, (err, results) => {
            if (err) return reject(err);
            resolve(results);
        });
    });

    // Retrieve profile information
    const getProfile = async (id) => {
        const rows = await query(
            `SELECT u.id, u.username, u.email, u.contact, u.role,
                    u.home_address, u.work_address,
                    COALESCE(up.about_me, '') AS about_me
             FROM users u
             LEFT JOIN user_profiles up ON up.user_id = u.id
             WHERE u.id = ?`,
            [id]
        );

        return rows[0] || null;
    };

    // Retrieve user's recent activity
    const getActivity = async (id) => {
        const [posts, replies, assetComments] = await Promise.all([
            query(
                `SELECT p.id, p.title, p.content, p.created_at,
                        fc.name AS category_name,
                        (SELECT COUNT(*) FROM forum_comments c
                         WHERE c.post_id = p.id) AS reply_count
                 FROM forum_posts p
                 LEFT JOIN forum_categories fc ON fc.id = p.category_id
                 WHERE p.user_id = ?
                 ORDER BY p.created_at DESC
                 LIMIT 10`,
                [id]
            ),

            query(
                `SELECT c.id, c.post_id, c.content, c.created_at,
                        p.title AS post_title
                 FROM forum_comments c
                 JOIN forum_posts p ON p.id = c.post_id
                 WHERE c.user_id = ?
                 ORDER BY c.created_at DESC
                 LIMIT 10`,
                [id]
            ),

            query(
                `SELECT ac.id, ac.asset_id, ac.content, ac.type,
                        ac.is_pinned, ac.created_at,
                        a.name AS asset_name
                 FROM asset_comments ac
                 JOIN asset a ON a.id = ac.asset_id
                 WHERE ac.user_id = ?
                 ORDER BY ac.created_at DESC
                 LIMIT 10`,
                [id]
            )
        ]);

        return { posts, replies, assetComments };
    };

    // /profile redirects to the logged-in user's profile
    router.get('/', (req, res) => {
        res.redirect(`/profile/${req.session.user.id}`);
    });

    // Edit profile page
    // Keep this above /:id so "edit" isn't treated as a profile ID.
    router.get('/edit', async (req, res) => {
        try {
            const profile = await getProfile(req.session.user.id);

            if (!profile) {
                return res.status(404).send('Profile not found.');
            }

            res.render('profile-edit', {
                formData: profile,
                errors: [],
                success: [],
                error: []
            });

        } catch (err) {
            console.error('Error loading profile editor:', err);
            res.status(500).send('Unable to load the profile editor.');
        }
    });

    // Save profile changes
    router.post('/edit', async (req, res) => {
        const userId = req.session.user.id;

        const formData = {
            username: (req.body.username || '').trim(),
            email: (req.body.email || '').trim(),
            contact: (req.body.contact || '').trim(),
            home_address: (req.body.home_address || '').trim(),
            work_address: (req.body.work_address || '').trim(),
            about_me: (req.body.about_me || '').trim()
        };

        const errors = [];

        if (!formData.username) {
            errors.push('Username is required.');
        }

        if (formData.username.length > 100) {
            errors.push('Username must be 100 characters or fewer.');
        }

        if (!formData.email ||
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
            errors.push('Enter a valid email address.');
        }

        if (formData.email.length > 255) {
            errors.push('Email must be 255 characters or fewer.');
        }

        if (!formData.contact) {
            errors.push('Contact number is required.');
        }

        if (formData.contact.length > 30) {
            errors.push('Contact number must be 30 characters or fewer.');
        }

        if (!formData.home_address) {
            errors.push('Home address is required.');
        }

        if (formData.home_address.length > 255) {
            errors.push('Home address must be 255 characters or fewer.');
        }

        if (formData.work_address.length > 255) {
            errors.push('Work address must be 255 characters or fewer.');
        }

        if (formData.about_me.length > 5000) {
            errors.push('About Me must be 5000 characters or fewer.');
        }

        if (errors.length) {
            return res.status(400).render('profile-edit', {
                formData,
                errors,
                success: [],
                error: []
            });
        }

        try {
            await query(
                `UPDATE users
                 SET username = ?, email = ?, contact = ?,
                     home_address = ?, work_address = ?
                 WHERE id = ?`,
                [
                    formData.username,
                    formData.email,
                    formData.contact,
                    formData.home_address,
                    formData.work_address || null,
                    userId
                ]
            );

            // Create or update the user's About Me section
            await query(
                `INSERT INTO user_profiles (user_id, about_me)
                 VALUES (?, ?)
                 ON DUPLICATE KEY UPDATE about_me = VALUES(about_me)`,
                [userId, formData.about_me]
            );

            // Update session information
            Object.assign(req.session.user, {
                username: formData.username,
                email: formData.email,
                contact: formData.contact,
                home_address: formData.home_address,
                work_address: formData.work_address || null
            });

            req.flash('success', 'Your profile has been updated.');

            res.redirect(`/profile/${userId}`);

        } catch (err) {
            console.error('Error updating profile:', err);

            if (err.code === 'ER_DUP_ENTRY') {
                errors.push('That email address is already being used by another account.');

                return res.status(400).render('profile-edit', {
                    formData,
                    errors,
                    success: [],
                    error: []
                });
            }

            res.status(500).send('Unable to update your profile.');
        }
    });

    // View a user's profile
    router.get('/:id', async (req, res) => {
        const profileId = Number(req.params.id);

        if (!Number.isInteger(profileId) || profileId < 1) {
            return res.status(400).send('Invalid profile ID.');
        }

        try {
            const profile = await getProfile(profileId);

            if (!profile) {
                return res.status(404).send('Profile not found.');
            }

            const activity = await getActivity(profileId);

            res.render('profile', {
                profile,
                activity,
                isOwnProfile: Number(req.session.user.id) === profileId,
                success: req.flash('success'),
                error: req.flash('error')
            });

        } catch (err) {
            console.error('Error loading profile:', err);
            res.status(500).send('Unable to load this profile.');
        }
    });

    return router;
};
