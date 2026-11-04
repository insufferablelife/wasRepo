const express = require('express');

module.exports = function(db) {
    const router = express.Router();

    // GET /admin/users - User Management Board
    router.get('/', (req, res) => {
        const searchQuery = req.query.search || '';
        let sql = 'SELECT id, username, email, address, contact, role FROM users';
        let queryParams = [];

        if (searchQuery) {
            sql += ' WHERE username LIKE ? OR email LIKE ? OR address LIKE ?';
            queryParams = [`%${searchQuery}%`, `%${searchQuery}%`, `%${searchQuery}%`];
        }

        db.query(sql, queryParams, (err, results) => {
            if (err) {
                console.error(err);
                return res.status(500).send('Database error');
            }

            res.render('usermanagement', {
                users: results,
                search: searchQuery,
                user: req.session.user
            });
        });
    });

    return router;
};