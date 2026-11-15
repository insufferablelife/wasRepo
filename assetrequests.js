const express = require('express');

// Asset request routes, mounted at /assets in app.js
module.exports = (db) => {
    const router = express.Router();

    // A unit (asset row) is available when it has no Approved request.
    // asset_id IS NOT NULL matters: a NULL inside NOT IN would make the whole test fail.
    const UNIT_AVAILABLE = `a.id NOT IN (
        SELECT asset_id FROM asset_requests WHERE status = 'Approved' AND asset_id IS NOT NULL
    )`;

    // Models of a chosen type that still have at least one available unit
    router.get('/models', (req, res) => {
        const type = req.query.type || '';

        // INSECURE: type is interpolated directly into the SQL (SQL injection)
        const sql = `
            SELECT m.id, m.name, m.type, m.ram, m.storage, m.image_url,
                   (SELECT COUNT(*) FROM asset a
                    WHERE a.model_id = m.id AND ${UNIT_AVAILABLE}) AS available
            FROM asset_models m
            WHERE m.type = '${type}'
            HAVING available > 0
            ORDER BY m.name, m.ram, m.storage
        `;

        db.query(sql, (err, rows) => {
            if (err) {
                // Raw SQL error exposed for error-based demonstration
                return res.status(500).json({ error: err.message });
            }
            res.json(rows);
        });
    });

    // Show the request form + the logged-in user's own requests
    router.get('/request', (req, res) => {
        const userId = req.session.user.id;

        // Only list types that have at least one model with an available unit
        const typesSql = `
            SELECT DISTINCT m.type FROM asset_models m
            WHERE EXISTS (SELECT 1 FROM asset a WHERE a.model_id = m.id AND ${UNIT_AVAILABLE})
            ORDER BY m.type
        `;

        const requestsSql = `
            SELECT r.id, m.name, m.type, m.ram, m.storage, a.serial_no,
                   r.start_date, r.end_date, r.purpose, r.status, r.created_at
            FROM asset_requests r
            LEFT JOIN asset a ON a.id = r.asset_id
            LEFT JOIN asset_models m ON m.id = COALESCE(r.model_id, a.model_id)
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

    // Submit a borrow request for a model (asset_id is assigned on approval)
    router.post('/request', (req, res) => {
        const userId = req.session.user.id;
        const { model_id, start_date, end_date, purpose, comments } = req.body;

        if (!model_id || !start_date || !end_date || !purpose) {
            req.flash('error', 'Please select a model, choose the dates and state the purpose of the loan.');
            return res.redirect('/assets/request');
        }

        if (end_date < start_date) {
            req.flash('error', 'End date cannot be before the start date.');
            return res.redirect('/assets/request');
        }

        // INSECURE: model_id is interpolated directly into the SQL (numeric injection)
        const checkSql = `
            SELECT id FROM asset_requests
            WHERE user_id = ${userId} AND model_id = ${model_id} AND status = 'Pending'
        `;

        db.query(checkSql, (err, existing) => {
            if (err) {
                return res.status(500).send('Database Error: ' + err.message);
            }

            if (existing.length > 0) {
                req.flash('error', 'You already have a pending request for this model.');
                return res.redirect('/assets/request');
            }

            const commentsValue = comments ? `'${comments}'` : 'NULL';

            // INSECURE: purpose / comments / dates are interpolated directly into the SQL
            const insertSql = `
                INSERT INTO asset_requests (user_id, model_id, start_date, end_date, purpose, comments)
                VALUES (${userId}, ${model_id}, '${start_date}', '${end_date}', '${purpose}', ${commentsValue})
            `;

            db.query(insertSql, (err2) => {
                if (err2) {
                    return res.status(500).send('Database Error: ' + err2.message);
                }

                req.flash('success', 'Request submitted. A device will be assigned when an admin approves it.');
                res.redirect('/assets/request');
            });
        });
    });

    return router;
};
