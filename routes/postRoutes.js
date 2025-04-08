const express = require("express");
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require("../config/db");
const { mustBeAdmin } = require("../middlewares/authMiddleware");
const sanitizeHTML = require('sanitize-html');
const { filterUserHTML } = require("../utils/helper");

// Configuração do Multer para upload de arquivos
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const postId = req.params.id || "temp"; // Usa "temp" para novos posts
        const uploadPath = path.join(__dirname, `../public/uploads/posts/${postId}`);
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
    limits: { fileSize: 5 * 1024 * 1024 }, // Limite de 5MB
    fileFilter: function (req, file, cb) {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Somente arquivos de imagem são permitidos.'));
        }
    }
});

// Rota para o dashboard
router.get("/dashboard", mustBeAdmin, (req, res) => {
    const view = req.query.view || "posts"; // Padrão para posts

    if (view === "contents") {
        // Carregar conteúdos
        const contentsStatement = db.prepare("SELECT contents.*, users.display_name FROM contents INNER JOIN users ON contents.authorid = users.id ORDER BY contents.createdDate DESC");
        const contents = contentsStatement.all();
        return res.render("dashboard", { contents, view });
    } else {
        // Carregar posts
        let postsStatement;
        if (req.query.filter === "mine") {
            postsStatement = db.prepare("SELECT posts.*, users.display_name FROM posts INNER JOIN users ON posts.authorid = users.id WHERE posts.authorid = ? ORDER BY posts.createdDate DESC");
            posts = postsStatement.all(req.user.id);
        } else {
            postsStatement = db.prepare("SELECT posts.*, users.display_name FROM posts INNER JOIN users ON posts.authorid = users.id ORDER BY posts.createdDate DESC");
            posts = postsStatement.all();
        }
        return res.render("dashboard", { posts, view });
    }
});

// Rota para a página de notícias
router.get("/news", (req, res) => {
    const postsStatement = db.prepare(`
        SELECT posts.*, users.display_name 
        FROM posts 
        INNER JOIN users ON posts.authorid = users.id 
        ORDER BY posts.createdDate DESC
        LIMIT 7
    `);
    const posts = postsStatement.all();

    // Separa o post mais recente (principal) e os 6 seguintes (secundários)
    const mainPost = posts[0];
    const otherPosts = posts.slice(1); // Pega do índice 1 em diante (6 postagens)

    res.render("news", { mainPost, otherPosts });
});

// Rota para carregar mais postagens
router.get("/load-more-posts", (req, res) => {
    const offset = parseInt(req.query.offset) || 0;
    const limit = 6; // Carrega 6 postagens por vez

    const postsStatement = db.prepare(`
        SELECT posts.*, users.display_name 
        FROM posts 
        INNER JOIN users ON posts.authorid = users.id 
        ORDER BY posts.createdDate DESC
        LIMIT ? OFFSET ?
    `);
    const posts = postsStatement.all(limit, offset);

    res.json(posts);
});

// Rota para exibir o formulário de criação de post
router.get("/create-post", mustBeAdmin, (req, res) => {
    res.render("create-post", { errors: [] });
});

// Rota para processar o formulário de criação de post
router.post("/create-post", mustBeAdmin, upload.single('banner'), (req, res) => {
    const errors = sharedPostValidation(req);

    if (errors.length) {
        return res.render("create-post", { errors });
    }

    // Sanitiza o conteúdo antes de salvar
    const sanitizedTitle = sanitizeHTML(req.body.title.trim(), { allowedTags: [], allowedAttributes: {} });
    const sanitizedBody = sanitizeHTML(req.body.body.trim(), { allowedTags: [], allowedAttributes: {} });

    // Caminho temporário para o banner
    const tempBannerPath = req.file ? `/uploads/posts/temp/${req.file.filename}` : null;

    // Insere o post no banco de dados
    const ourStatement = db.prepare("INSERT INTO posts (title, body, authorid, createdDate, banner) VALUES (?, ?, ?, ?, ?)");
    const result = ourStatement.run(sanitizedTitle, sanitizedBody, req.user.id, new Date().toISOString(), tempBannerPath);

    // Cria a pasta do post
    const postPath = path.join(__dirname, `../public/uploads/posts/${result.lastInsertRowid}`);
    if (!fs.existsSync(postPath)) {
        fs.mkdirSync(postPath, { recursive: true });
    }

    // Move o banner da pasta "temp" para a pasta do post
    if (req.file) {
        const tempFilePath = path.join(__dirname, `../public/uploads/posts/temp/${req.file.filename}`);
        const newFilePath = path.join(postPath, req.file.filename);
        fs.renameSync(tempFilePath, newFilePath);

        // Atualiza o caminho do banner no banco de dados
        const bannerPath = `/uploads/posts/${result.lastInsertRowid}/${req.file.filename}`;
        const updateStatement = db.prepare("UPDATE posts SET banner = ? WHERE id = ?");
        updateStatement.run(bannerPath, result.lastInsertRowid);
    }

    // Redireciona para o post criado
    res.redirect(`/post/${result.lastInsertRowid}`);
});

// Rota para exibir um post individual
router.get("/post/:id", (req, res) => {
    const statement = db.prepare(`
        SELECT posts.*, users.display_name, users.avatar 
        FROM posts 
        INNER JOIN users ON posts.authorid = users.id 
        WHERE posts.id = ?
    `);
    const post = statement.get(req.params.id);

    if (!post) {
        return res.redirect("/");
    }

    const isAuthor = req.user && post.authorid === req.user.id;
    const canEdit = isAuthor || (req.user && req.user.role === 'admin');

    res.render("single-post", { post, isAuthor, user: req.user, canEdit });
});

// Rota para exibir o formulário de edição de post
router.get("/edit-post/:id", mustBeAdmin, (req, res) => {
    const statement = db.prepare("SELECT * FROM posts WHERE id = ?");
    const post = statement.get(req.params.id);

    if (!post) {
        return res.redirect("/");
    }

    res.render("edit-post", { post, errors: [] });
});

// Rota para processar o formulário de edição de post
router.post("/edit-post/:id", mustBeAdmin, upload.single('banner'), (req, res) => {
    const post = db.prepare("SELECT * FROM posts WHERE id = ?").get(req.params.id);

    if (!post) {
        return res.redirect("/");
    }

    const errors = sharedPostValidation(req);

    if (errors.length) {
        return res.render("edit-post", { post, errors });
    }

    // Sanitiza o conteúdo antes de salvar
    const sanitizedTitle = sanitizeHTML(req.body.title.trim(), { allowedTags: [], allowedAttributes: {} });
    const sanitizedBody = sanitizeHTML(req.body.body.trim(), { allowedTags: [], allowedAttributes: {} });

    // Mantém o caminho do banner existente se nenhum novo arquivo for enviado
    const bannerPath = req.file ? `/uploads/posts/${req.params.id}/${req.file.filename}` : post.banner;

    // Move o novo banner para a pasta do post, se houver
    if (req.file) {
        const tempFilePath = path.join(__dirname, `../public/uploads/posts/temp/${req.file.filename}`);
        const newFilePath = path.join(__dirname, `../public/uploads/posts/${req.params.id}/${req.file.filename}`);
        fs.renameSync(tempFilePath, newFilePath);
    }

    const updateStatement = db.prepare("UPDATE posts SET title = ?, body = ?, banner = ? WHERE id = ?");
    updateStatement.run(sanitizedTitle, sanitizedBody, bannerPath, req.params.id);

    res.redirect(`/post/${req.params.id}`);
});

// Rota para deletar um post
router.post("/delete-post/:id", mustBeAdmin, (req, res) => {
    const statement = db.prepare("SELECT * FROM posts WHERE id = ?");
    const post = statement.get(req.params.id);

    if (!post) {
        return res.redirect("/");
    }

    const deleteStatement = db.prepare("DELETE FROM posts WHERE id = ?");
    deleteStatement.run(req.params.id);

    // Excluir a pasta do post
    const postPath = path.join(__dirname, `../public/uploads/posts/${req.params.id}`);
    if (fs.existsSync(postPath)) {
        fs.rmdirSync(postPath, { recursive: true });
    }

    res.redirect("/dashboard");
});

// Função para validação compartilhada de posts
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