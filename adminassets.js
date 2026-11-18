const express = require('express');

// Admin asset management, mounted at /admin/assets in app.js
// (checkAuthenticated + checkAdmin are applied where it is mounted)
module.exports = (db) => {
    const router = express.Router();
    const p = db.promise();

    // A unit (asset row) is free when it has no Approved (i.e. currently on loan) request
    const UNIT_FREE = `a.id NOT IN (
        SELECT asset_id FROM asset_requests WHERE status = 'Approved' AND asset_id IS NOT NULL
    )`;

    const dbError = (res, err) => res.status(500).send('Database Error: ' + err.message);

    // INSECURE on purpose: wraps the raw value in quotes with no escaping
    const sqlVal = (v) => (v ? `'${v}'` : 'NULL');

    // ---------------------------------------------------------
    // Assets overview: models + units
    // ---------------------------------------------------------
    router.get('/', async (req, res) => {
        const modelsSql = `
            SELECT m.*,
                   (SELECT COUNT(*) FROM asset a WHERE a.model_id = m.id) AS total_units,
                   (SELECT COUNT(*) FROM asset a WHERE a.model_id = m.id AND ${UNIT_FREE}) AS free_units
            FROM asset_models m
            ORDER BY m.type, m.name
        `;

        const unitsSql = `
            SELECT a.id, a.serial_no, a.start_date, a.end_date, m.name AS model_name, m.type,
                   (SELECT u.username FROM asset_requests r
                    JOIN users u ON u.id = r.user_id
                    WHERE r.asset_id = a.id AND r.status = 'Approved' LIMIT 1) AS borrower
            FROM asset a
            LEFT JOIN asset_models m ON m.id = a.model_id
            ORDER BY m.type, m.name, a.serial_no
        `;

        try {
            const [models] = await p.query(modelsSql);
            const [units] = await p.query(unitsSql);

            res.render('adminassets', {
                user: req.session.user,
                models,
                units,
                messages: req.flash('success'),
                errors: req.flash('error')
            });
        } catch (err) {
            dbError(res, err);
        }
    });

    // ---------------------------------------------------------
    // Models
    // ---------------------------------------------------------
    router.post('/models', (req, res) => {
        const { name, type, specs, image_url } = req.body;

        if (!name || !type) {
            req.flash('error', 'Model name and type are required.');
            return res.redirect('/admin/assets');
        }

        // INSECURE: direct interpolation
        const sql = `
            INSERT INTO asset_models (name, type, specs, image_url)
            VALUES ('${name}', '${type}', ${sqlVal(specs)}, ${sqlVal(image_url)})
        `;

        db.query(sql, (err) => {
            if (err) return dbError(res, err);
            req.flash('success', 'Model added.');
            res.redirect('/admin/assets');
        });
    });

    router.get('/models/:id/edit', (req, res) => {
        // INSECURE: req.params.id interpolated directly
        db.query(`SELECT * FROM asset_models WHERE id = ${req.params.id}`, (err, rows) => {
            if (err) return dbError(res, err);

            if (rows.length === 0) {
                req.flash('error', 'Model not found.');
                return res.redirect('/admin/assets');
            }

            db.query('SELECT DISTINCT type FROM asset_models ORDER BY type', (err2, types) => {
                if (err2) return dbError(res, err2);

                res.render('adminmodeledit', {
                    user: req.session.user,
                    model: rows[0],
                    types,
                    messages: req.flash('success'),
                    errors: req.flash('error')
                });
            });
        });
    });

    router.post('/models/:id/edit', (req, res) => {
        const id = req.params.id;
        const { name, type, specs, image_url } = req.body;

        if (!name || !type) {
            req.flash('error', 'Model name and type are required.');
            return res.redirect(`/admin/assets/models/${id}/edit`);
        }

        // INSECURE: direct interpolation
        const sql = `
            UPDATE asset_models
            SET name = '${name}', type = '${type}', specs = ${sqlVal(specs)}, image_url = ${sqlVal(image_url)}
            WHERE id = ${id}
        `;

        db.query(sql, (err) => {
            if (err) return dbError(res, err);

            // Keep the name/type copied onto each unit in sync with its model
            db.query(`UPDATE asset SET name = '${name}', type = '${type}' WHERE model_id = ${id}`, (err2) => {
                if (err2) return dbError(res, err2);
                req.flash('success', 'Model updated.');
                res.redirect('/admin/assets');
            });
        });
    });

    router.post('/models/:id/delete', (req, res) => {
        db.query(`DELETE FROM asset_models WHERE id = ${req.params.id}`, (err) => {
            if (err) {
                if (err.errno === 1451) {
                    req.flash('error', 'Cannot delete a model that still has units or requests.');
                    return res.redirect('/admin/assets');
                }
                return dbError(res, err);
            }
            req.flash('success', 'Model deleted.');
            res.redirect('/admin/assets');
        });
    });

    // ---------------------------------------------------------
    // Units (individual devices with serial numbers)
    // ---------------------------------------------------------
    router.post('/units', (req, res) => {
        const { model_id, serial_no, start_date, end_date } = req.body;

        if (!model_id || !serial_no || !start_date || !end_date) {
            req.flash('error', 'Model, serial number and availability dates are required.');
            return res.redirect('/admin/assets');
        }

        if (end_date < start_date) {
            req.flash('error', 'End date cannot be before the start date.');
            return res.redirect('/admin/assets');
        }

        // INSECURE: direct interpolation
        db.query(`SELECT id FROM asset WHERE serial_no = '${serial_no}'`, (err, existing) => {
            if (err) return dbError(res, err);

            if (existing.length > 0) {
                req.flash('error', 'A unit with that serial number already exists.');
                return res.redirect('/admin/assets');
            }

            // name and type are copied from the model
            const sql = `
                INSERT INTO asset (model_id, name, type, serial_no, start_date, end_date)
                SELECT id, name, type, '${serial_no}', '${start_date}', '${end_date}'
                FROM asset_models WHERE id = ${model_id}
            `;

            db.query(sql, (err2, result) => {
                if (err2) return dbError(res, err2);

                if (result.affectedRows === 0) {
                    req.flash('error', 'Selected model does not exist.');
                    return res.redirect('/admin/assets');
                }

                req.flash('success', 'Unit added.');
                res.redirect('/admin/assets');
            });
        });
    });

    router.post('/units/:id/delete', (req, res) => {
        db.query(`DELETE FROM asset WHERE id = ${req.params.id}`, (err) => {
            if (err) {
                if (err.errno === 1451) {
                    req.flash('error', 'Cannot delete a unit that has loan requests or comments attached.');
                    return res.redirect('/admin/assets');
                }
                return dbError(res, err);
            }
            req.flash('success', 'Unit deleted.');
            res.redirect('/admin/assets');
        });
    });

    // ---------------------------------------------------------
    // Loan requests: review, assign a unit, return
    // ---------------------------------------------------------
    router.get('/requests', async (req, res) => {
        const pendingSql = `
            SELECT r.id, r.model_id, r.start_date, r.end_date, r.purpose, r.comments, r.created_at,
                   u.username, u.email, m.name AS model_name, m.type, m.specs
            FROM asset_requests r
            JOIN users u ON u.id = r.user_id
            LEFT JOIN asset_models m ON m.id = r.model_id
            WHERE r.status = 'Pending'
            ORDER BY r.created_at
        `;

        const freeUnitsSql = `
            SELECT a.id, a.model_id, a.serial_no FROM asset a
            WHERE ${UNIT_FREE}
            ORDER BY a.serial_no
        `;

        const activeSql = `
            SELECT r.id, r.start_date, r.end_date, u.username, a.serial_no,
                   m.name AS model_name, m.type
            FROM asset_requests r
            JOIN users u ON u.id = r.user_id
            LEFT JOIN asset a ON a.id = r.asset_id
            LEFT JOIN asset_models m ON m.id = COALESCE(r.model_id, a.model_id)
            WHERE r.status = 'Approved'
            ORDER BY r.end_date
        `;

        const historySql = `
            SELECT r.id, r.status, r.start_date, r.end_date, r.reviewed_at, u.username, a.serial_no,
                   m.name AS model_name, m.type
            FROM asset_requests r
            JOIN users u ON u.id = r.user_id
            LEFT JOIN asset a ON a.id = r.asset_id
            LEFT JOIN asset_models m ON m.id = COALESCE(r.model_id, a.model_id)
            WHERE r.status NOT IN ('Pending', 'Approved')
            ORDER BY r.created_at DESC
            LIMIT 50
        `;

        try {
            const [pending] = await p.query(pendingSql);
            const [freeUnits] = await p.query(freeUnitsSql);
            const [active] = await p.query(activeSql);
            const [history] = await p.query(historySql);

            res.render('adminrequests', {
                user: req.session.user,
                pending,
                freeUnits,
                active,
                history,
                messages: req.flash('success'),
                errors: req.flash('error')
            });
        } catch (err) {
            dbError(res, err);
        }
    });

    // Approve: assign a specific unit (serial number) of the requested model
    router.post('/requests/:id/approve', (req, res) => {
        const reqId = req.params.id;
        const { asset_id } = req.body;
        const adminId = req.session.user.id;

        if (!asset_id) {
            req.flash('error', 'Please choose a unit to assign.');
            return res.redirect('/admin/assets/requests');
        }

        // The unit must belong to the requested model and not already be on loan
        // INSECURE: ids interpolated directly
        const checkSql = `
            SELECT a.id FROM asset a
            JOIN asset_requests r ON r.model_id = a.model_id
            WHERE r.id = ${reqId} AND r.status = 'Pending'
              AND a.id = ${asset_id} AND ${UNIT_FREE}
        `;

        db.query(checkSql, (err, rows) => {
            if (err) return dbError(res, err);

            if (rows.length === 0) {
                req.flash('error', 'That unit is not available for this request.');
                return res.redirect('/admin/assets/requests');
            }

            const sql = `
                UPDATE asset_requests
                SET asset_id = ${asset_id}, status = 'Approved', reviewed_by = ${adminId}, reviewed_at = NOW()
                WHERE id = ${reqId} AND status = 'Pending'
            `;

            db.query(sql, (err2) => {
                if (err2) return dbError(res, err2);
                req.flash('success', 'Request approved and unit assigned.');
                res.redirect('/admin/assets/requests');
            });
        });
    });

    router.post('/requests/:id/reject', (req, res) => {
        const adminId = req.session.user.id;

        const sql = `
            UPDATE asset_requests
            SET status = 'Rejected', reviewed_by = ${adminId}, reviewed_at = NOW()
            WHERE id = ${req.params.id} AND status = 'Pending'
        `;

        db.query(sql, (err) => {
            if (err) return dbError(res, err);
            req.flash('success', 'Request rejected.');
            res.redirect('/admin/assets/requests');
        });
    });

    // Mark a loaned device as returned (frees the unit for new requests)
    router.post('/requests/:id/return', (req, res) => {
        const sql = `UPDATE asset_requests SET status = 'Returned' WHERE id = ${req.params.id} AND status = 'Approved'`;

        db.query(sql, (err) => {
            if (err) return dbError(res, err);
            req.flash('success', 'Device marked as returned.');
            res.redirect('/admin/assets/requests');
        });
    });

    return router;
};
