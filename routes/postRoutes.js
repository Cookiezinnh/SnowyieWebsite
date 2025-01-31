const express = require("express");
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require("../config/db");
const { mustBeAdmin } = require("../middlewares/authMiddleware");
const sanitizeHTML = require('sanitize-html'); // Certifique-se de importar o sanitizeHTML

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadPath = path.join(__dirname, '../public/uploads');
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }
        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: function (req, file, cb) {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Somente arquivos de imagem são permitidos.'));
        }
    }
});

router.get("/dashboard", mustBeAdmin, (req, res) => {
    let postsStatement;
    if (req.query.filter === "mine") {
        postsStatement = db.prepare("SELECT posts.*, users.username FROM posts INNER JOIN users ON posts.authorid = users.id WHERE posts.authorid = ? ORDER BY posts.createdDate DESC");
        posts = postsStatement.all(req.user.id);
    } else {
        postsStatement = db.prepare("SELECT posts.*, users.username FROM posts INNER JOIN users ON posts.authorid = users.id ORDER BY posts.createdDate DESC");
        posts = postsStatement.all();
    }
    res.render("dashboard", { posts });
});

// Rota para exibir o formulário de criação de post
router.get("/create-post", mustBeAdmin, (req, res) => {
    res.render("create-post", { errors: [] }); // Passa `errors` como um array vazio
});

// Rota para processar o formulário de criação de post
router.post("/create-post", mustBeAdmin, upload.single('banner'), (req, res) => {
    const errors = sharedPostValidation(req);

    if (errors.length) {
        return res.render("create-post", { errors }); // Passa `errors` para o template
    }

    const bannerPath = req.file ? `/uploads/${req.file.filename}` : null;

    const ourStatement = db.prepare("INSERT INTO posts (title, body, authorid, createdDate, banner) VALUES (?, ?, ?, ?, ?)");
    const result = ourStatement.run(req.body.title, req.body.body, req.user.id, new Date().toISOString(), bannerPath);

    const realPost = db.prepare("SELECT * FROM posts WHERE ROWID = ?").get(result.lastInsertRowid);

    res.redirect(`/post/${realPost.id}`);
});

router.get("/post/:id", (req, res) => {
    const statement = db.prepare("SELECT posts.*, users.username FROM posts INNER JOIN users ON posts.authorid = users.id WHERE posts.id = ?");
    const post = statement.get(req.params.id);

    if (!post) {
        return res.redirect("/");
    }

    const isAuthor = req.user && post.authorid === req.user.id;
    const canEdit = isAuthor || (req.user && req.user.role === 'admin');

    res.render("single-post", { post, isAuthor, user: req.user, canEdit });
});

router.get("/edit-post/:id", mustBeAdmin, (req, res) => {
    const statement = db.prepare("SELECT * FROM posts WHERE id = ?");
    const post = statement.get(req.params.id);

    if (!post) {
        return res.redirect("/");
    }

    res.render("edit-post", { post });
});

router.post("/edit-post/:id", mustBeAdmin, upload.single('banner'), (req, res) => {
    const post = db.prepare("SELECT * FROM posts WHERE id = ?").get(req.params.id);

    if (!post) {
        return res.redirect("/");
    }

    const errors = sharedPostValidation(req);

    if (errors.length) {
        return res.render("edit-post", { errors });
    }

    const bannerPath = req.file ? `/uploads/${req.file.filename}` : post.banner;

    const updateStatement = db.prepare("UPDATE posts SET title = ?, body = ?, banner = ? WHERE id = ?");
    updateStatement.run(req.body.title, req.body.body, bannerPath, req.params.id);

    res.redirect(`/post/${req.params.id}`);
});

router.post("/delete-post/:id", mustBeAdmin, (req, res) => {
    const statement = db.prepare("SELECT * FROM posts WHERE id = ?");
    const post = statement.get(req.params.id);

    if (!post) {
        return res.redirect("/");
    }

    const deleteStatement = db.prepare("DELETE FROM posts WHERE id = ?");
    deleteStatement.run(req.params.id);

    res.redirect("/dashboard");
});

function sharedPostValidation(req) {
    const errors = [];

    if (typeof req.body.title !== "string") req.body.title = "";
    if (typeof req.body.body !== "string") req.body.body = "";

    req.body.title = sanitizeHTML(req.body.title.trim(), { allowedTags: [], allowedAttributes: {} });
    req.body.body = sanitizeHTML(req.body.body.trim(), { allowedTags: [], allowedAttributes: {} });

    if (!req.body.title) errors.push("Você precisa providenciar um título.");
    if (!req.body.body) errors.push("Você precisa providenciar um texto.");

    return errors;
}

module.exports = router;