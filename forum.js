const express = require('express');

module.exports = function(db) {
    const router = express.Router();

    const getCategories = (callback) => {
        db.query('SELECT id, name FROM forum_categories ORDER BY name ASC', callback);
    };

    const getPost = (postId, callback) => {
        const sql = `
            SELECT
                p.id, p.user_id, p.category_id, p.title, p.content,
                p.is_pinned, p.created_at, p.updated_at,
                u.username,
                fc.name AS category_name
            FROM forum_posts p
            JOIN users u ON p.user_id = u.id
            JOIN forum_categories fc ON p.category_id = fc.id
            WHERE p.id = ?
        `;
        db.query(sql, [postId], callback);
    };

    const validId = (value) => {
        const id = Number.parseInt(value, 10);
        return Number.isInteger(id) && id > 0 ? id : null;
    };

    const isAdmin = (user) => user && user.role === 'admin';

    // GET /forum - Main forum page
    router.get('/', (req, res) => {
        const selectedCategory = validId(req.query.category);
        let sql = `
            SELECT
                p.id, p.user_id, p.title, p.content, p.is_pinned,
                p.created_at, p.updated_at,
                u.username,
                fc.name AS category_name,
                (SELECT COUNT(*) FROM forum_comments c WHERE c.post_id = p.id) AS reply_count
            FROM forum_posts p
            JOIN users u ON p.user_id = u.id
            JOIN forum_categories fc ON p.category_id = fc.id
        `;
        const params = [];

        if (selectedCategory) {
            sql += ' WHERE p.category_id = ?';
            params.push(selectedCategory);
        }

        sql += ' ORDER BY p.is_pinned DESC, p.created_at DESC';

        db.query(sql, params, (err, posts) => {
            if (err) {
                console.error(err);
                return res.status(500).send('Unable to load forum posts.');
            }

            getCategories((categoryErr, categories) => {
                if (categoryErr) {
                    console.error(categoryErr);
                    return res.status(500).send('Unable to load forum categories.');
                }

                res.render('forum', {
                    posts,
                    categories,
                    selectedCategory: selectedCategory || '',
                    notice: req.query.notice || '',
                    user: req.session.user
                });
            });
        });
    });

    // POST /forum/categories/create - Admin creates a category
    router.post('/categories/create', (req, res) => {
        if (!isAdmin(req.session.user)) {
            return res.status(403).send('Only administrators can manage categories.');
        }

        const name = (req.body.name || '').trim();
        const description = (req.body.description || '').trim();

        if (!name || name.length > 100 || description.length > 255) {
            return res.redirect('/forum?notice=' + encodeURIComponent('Enter a category name (up to 100 characters) and a description no longer than 255 characters.'));
        }

        db.query(
            'INSERT INTO forum_categories (name, description) VALUES (?, ?)',
            [name, description || null],
            (err) => {
                if (err) {
                    const message = err.code === 'ER_DUP_ENTRY'
                        ? 'A category with that name already exists.'
                        : 'Unable to create category.';
                    if (err.code !== 'ER_DUP_ENTRY') console.error(err);
                    return res.redirect('/forum?notice=' + encodeURIComponent(message));
                }
                res.redirect('/forum?notice=' + encodeURIComponent('Category created successfully.'));
            }
        );
    });

    // POST /forum/categories/:categoryId/delete - Admin deletes an unused category
    router.post('/categories/:categoryId/delete', (req, res) => {
        if (!isAdmin(req.session.user)) {
            return res.status(403).send('Only administrators can manage categories.');
        }

        const categoryId = validId(req.params.categoryId);
        if (!categoryId) return res.status(400).send('Invalid category ID.');

        db.query(
            'SELECT COUNT(*) AS post_count FROM forum_posts WHERE category_id = ?',
            [categoryId],
            (countErr, results) => {
                if (countErr) {
                    console.error(countErr);
                    return res.status(500).send('Unable to check category usage.');
                }

                if (results[0].post_count > 0) {
                    return res.redirect('/forum?notice=' + encodeURIComponent('This category is in use and cannot be deleted.'));
                }

                db.query('DELETE FROM forum_categories WHERE id = ?', [categoryId], (deleteErr, result) => {
                    if (deleteErr) {
                        console.error(deleteErr);
                        return res.status(500).send('Unable to delete category.');
                    }
                    const message = result.affectedRows
                        ? 'Category deleted successfully.'
                        : 'Category not found.';
                    res.redirect('/forum?notice=' + encodeURIComponent(message));
                });
            }
        );
    });

    // POST /forum/:id/pin - Admin toggles a post's pinned status
    router.post('/:id/pin', (req, res) => {
        if (!isAdmin(req.session.user)) {
            return res.status(403).send('Only administrators can pin forum posts.');
        }

        const postId = validId(req.params.id);
        if (!postId) return res.status(400).send('Invalid post ID.');

        db.query('SELECT is_pinned FROM forum_posts WHERE id = ?', [postId], (err, results) => {
            if (err) {
                console.error(err);
                return res.status(500).send('Unable to load post.');
            }
            if (results.length === 0) return res.status(404).send('Post not found.');

            const newPinnedStatus = results[0].is_pinned ? 0 : 1;
            db.query(
                'UPDATE forum_posts SET is_pinned = ? WHERE id = ?',
                [newPinnedStatus, postId],
                (updateErr) => {
                    if (updateErr) {
                        console.error(updateErr);
                        return res.status(500).send('Unable to update pinned status.');
                    }

                    const returnTo = req.body.return_to || '/forum';
                    const safeReturnTo = /^\/forum(?:\/\d+)?$/.test(returnTo) ? returnTo : '/forum';
                    res.redirect(safeReturnTo);
                }
            );
        });
    });

    // GET /forum/create - Show create-post form
    router.get('/create', (req, res) => {
        getCategories((err, categories) => {
            if (err) {
                console.error(err);
                return res.status(500).send('Unable to load categories.');
            }

            res.render('forum-form', {
                mode: 'create',
                post: null,
                categories,
                error: null
            });
        });
    });

    // POST /forum/create - Create a post
    router.post('/create', (req, res) => {
        const title = (req.body.title || '').trim();
        const content = (req.body.content || '').trim();
        const categoryId = validId(req.body.category_id);

        if (!title || !content || !categoryId) {
            return getCategories((err, categories) => {
                if (err) return res.status(500).send('Unable to load categories.');

                return res.status(400).render('forum-form', {
                    mode: 'create',
                    post: { title, content, category_id: categoryId },
                    categories,
                    error: 'Please complete every field and select a valid category.'
                });
            });
        }

        const sql = `
            INSERT INTO forum_posts (user_id, category_id, title, content)
            VALUES (?, ?, ?, ?)
        `;

        db.query(sql, [req.session.user.id, categoryId, title, content], (err) => {
            if (err) {
                console.error(err);
                return res.status(500).send('Unable to create post.');
            }

            res.redirect('/forum');
        });
    });

    // GET /forum/:id/edit - Show edit form (owner only)
    router.get('/:id/edit', (req, res) => {
        const postId = validId(req.params.id);
        if (!postId) return res.status(400).send('Invalid post ID.');

        getPost(postId, (err, results) => {
            if (err) {
                console.error(err);
                return res.status(500).send('Unable to load post.');
            }
            if (results.length === 0) return res.status(404).send('Post not found.');

            const post = results[0];
            if (post.user_id !== req.session.user.id) {
                return res.status(403).send('You can only edit your own posts.');
            }

            getCategories((categoryErr, categories) => {
                if (categoryErr) {
                    console.error(categoryErr);
                    return res.status(500).send('Unable to load categories.');
                }

                res.render('forum-form', {
                    mode: 'edit',
                    post,
                    categories,
                    error: null
                });
            });
        });
    });

    // POST /forum/:id/edit - Update own post
    router.post('/:id/edit', (req, res) => {
        const postId = validId(req.params.id);
        const title = (req.body.title || '').trim();
        const content = (req.body.content || '').trim();
        const categoryId = validId(req.body.category_id);

        if (!postId) return res.status(400).send('Invalid post ID.');

        getPost(postId, (err, results) => {
            if (err) {
                console.error(err);
                return res.status(500).send('Unable to load post.');
            }
            if (results.length === 0) return res.status(404).send('Post not found.');

            const existingPost = results[0];
            if (existingPost.user_id !== req.session.user.id) {
                return res.status(403).send('You can only edit your own posts.');
            }

            if (!title || !content || !categoryId) {
                return getCategories((categoryErr, categories) => {
                    if (categoryErr) return res.status(500).send('Unable to load categories.');

                    return res.status(400).render('forum-form', {
                        mode: 'edit',
                        post: { ...existingPost, title, content, category_id: categoryId },
                        categories,
                        error: 'Please complete every field and select a valid category.'
                    });
                });
            }

            db.query(
                'UPDATE forum_posts SET title = ?, content = ?, category_id = ? WHERE id = ?',
                [title, content, categoryId, postId],
                (updateErr) => {
                    if (updateErr) {
                        console.error(updateErr);
                        return res.status(500).send('Unable to update post.');
                    }
                    res.redirect(`/forum/${postId}`);
                }
            );
        });
    });

    // POST /forum/:id/delete - Owner or admin can delete a post
    router.post('/:id/delete', (req, res) => {
        const postId = validId(req.params.id);
        if (!postId) return res.status(400).send('Invalid post ID.');

        getPost(postId, (err, results) => {
            if (err) {
                console.error(err);
                return res.status(500).send('Unable to load post.');
            }
            if (results.length === 0) return res.status(404).send('Post not found.');

            const post = results[0];
            if (post.user_id !== req.session.user.id && !isAdmin(req.session.user)) {
                return res.status(403).send('You are not allowed to delete this post.');
            }

            // Delete replies first because the current schema has no ON DELETE CASCADE.
            db.query('DELETE FROM forum_comments WHERE post_id = ?', [postId], (commentErr) => {
                if (commentErr) {
                    console.error(commentErr);
                    return res.status(500).send('Unable to delete post replies.');
                }

                db.query('DELETE FROM forum_posts WHERE id = ?', [postId], (deleteErr) => {
                    if (deleteErr) {
                        console.error(deleteErr);
                        return res.status(500).send('Unable to delete post.');
                    }
                    res.redirect('/forum');
                });
            });
        });
    });

    // GET /forum/:id - View one post and its replies
    router.get('/:id', (req, res) => {
        const postId = validId(req.params.id);
        if (!postId) return res.status(400).send('Invalid post ID.');

        getPost(postId, (err, results) => {
            if (err) {
                console.error(err);
                return res.status(500).send('Unable to load post.');
            }
            if (results.length === 0) return res.status(404).send('Post not found.');

            const post = results[0];
            const sql = `
                SELECT c.id, c.post_id, c.user_id, c.content,
                       c.created_at, c.updated_at, u.username
                FROM forum_comments c
                JOIN users u ON c.user_id = u.id
                WHERE c.post_id = ?
                ORDER BY c.created_at ASC
            `;

            db.query(sql, [postId], (commentErr, comments) => {
                if (commentErr) {
                    console.error(commentErr);
                    return res.status(500).send('Unable to load replies.');
                }

                res.render('forum-post', {
                    post,
                    comments,
                    user: req.session.user
                });
            });
        });
    });

    // POST /forum/:id/reply - Add a reply
    router.post('/:id/reply', (req, res) => {
        const postId = validId(req.params.id);
        const content = (req.body.content || '').trim();

        if (!postId) return res.status(400).send('Invalid post ID.');
        if (!content) return res.status(400).send('Reply cannot be empty.');

        getPost(postId, (err, results) => {
            if (err) {
                console.error(err);
                return res.status(500).send('Unable to load post.');
            }
            if (results.length === 0) return res.status(404).send('Post not found.');

            db.query(
                'INSERT INTO forum_comments (post_id, user_id, content) VALUES (?, ?, ?)',
                [postId, req.session.user.id, content],
                (insertErr) => {
                    if (insertErr) {
                        console.error(insertErr);
                        return res.status(500).send('Unable to add reply.');
                    }
                    res.redirect(`/forum/${postId}`);
                }
            );
        });
    });

    // POST /forum/:postId/comments/:commentId/edit - Edit own reply
    router.post('/:postId/comments/:commentId/edit', (req, res) => {
        const postId = validId(req.params.postId);
        const commentId = validId(req.params.commentId);
        const content = (req.body.content || '').trim();

        if (!postId || !commentId) return res.status(400).send('Invalid ID.');
        if (!content) return res.status(400).send('Reply cannot be empty.');

        db.query(
            'SELECT id, user_id FROM forum_comments WHERE id = ? AND post_id = ?',
            [commentId, postId],
            (err, results) => {
                if (err) {
                    console.error(err);
                    return res.status(500).send('Unable to load reply.');
                }
                if (results.length === 0) return res.status(404).send('Reply not found.');
                if (results[0].user_id !== req.session.user.id) {
                    return res.status(403).send('You can only edit your own replies.');
                }

                db.query(
                    'UPDATE forum_comments SET content = ? WHERE id = ?',
                    [content, commentId],
                    (updateErr) => {
                        if (updateErr) {
                            console.error(updateErr);
                            return res.status(500).send('Unable to update reply.');
                        }
                        res.redirect(`/forum/${postId}`);
                    }
                );
            }
        );
    });

    // POST /forum/:postId/comments/:commentId/delete - Owner or admin can delete reply
    router.post('/:postId/comments/:commentId/delete', (req, res) => {
        const postId = validId(req.params.postId);
        const commentId = validId(req.params.commentId);

        if (!postId || !commentId) return res.status(400).send('Invalid ID.');

        db.query(
            'SELECT id, user_id FROM forum_comments WHERE id = ? AND post_id = ?',
            [commentId, postId],
            (err, results) => {
                if (err) {
                    console.error(err);
                    return res.status(500).send('Unable to load reply.');
                }
                if (results.length === 0) return res.status(404).send('Reply not found.');

                const comment = results[0];
                if (comment.user_id !== req.session.user.id && !isAdmin(req.session.user)) {
                    return res.status(403).send('You are not allowed to delete this reply.');
                }

                db.query(
                    'DELETE FROM forum_comments WHERE id = ?',
                    [commentId],
                    (deleteErr) => {
                        if (deleteErr) {
                            console.error(deleteErr);
                            return res.status(500).send('Unable to delete reply.');
                        }
                        res.redirect(`/forum/${postId}`);
                    }
                );
            }
        );
    });

    return router;
};
