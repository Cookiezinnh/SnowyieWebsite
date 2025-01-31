const express = require("express");
const router = express.Router();
const db = require("../config/db");

router.get("/", (req, res) => {
    const postsStatement = db.prepare(`
        SELECT posts.*, users.username
        FROM posts
        INNER JOIN users ON posts.authorid = users.id
        ORDER BY posts.createdDate DESC
        LIMIT 3
    `);
    const posts = postsStatement.all();
    res.render("index", { posts });
});

module.exports = router;