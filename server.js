require("dotenv").config();
const jwt = require("jsonwebtoken");
const marked = require("marked");
const sanitizeHTML = require("sanitize-html");
const bcrypt = require("bcrypt");
const cookieParser = require("cookie-parser");
const express = require("express");
const multer = require('multer');
const fs = require('fs');
const db = require("better-sqlite3")("Snowyie.db");
const path = require('path');
db.pragma("journal_mode = WAL");

// Database setup
const createTables = db.transaction(() => {
    db.prepare(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username STRING NOT NULL UNIQUE,
            password STRING NOT NULL,
            role STRING DEFAULT 'user' -- Adicionada a coluna role
        )
    `).run();

    db.prepare(`
        CREATE TABLE IF NOT EXISTS posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            createdDate TEXT,
            title STRING NOT NULL,
            body TEXT NOT NULL,
            banner TEXT,
            authorid INTEGER,
            FOREIGN KEY (authorid) REFERENCES users (id)
        )
    `).run();
});

createTables();

// Configuração do armazenamento do multer
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadPath = path.join(__dirname, 'public/uploads');
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

const app = express();

app.set("view engine", "ejs");
app.use(express.urlencoded({ extended: false }));
app.use(express.static("public"));
app.use('/static', express.static(path.join(__dirname, 'public')));

app.use(cookieParser());

app.use(function (req, res, next) {
    // markdown function
    res.locals.filterUserHTML = function (content) {
        return sanitizeHTML(marked.parse(content), {
            allowedTags: ["p", "br", "ul", "li", "ol", "strong", "bold", "i", "em", "h1", "h2", "h3", "h4", "h5", "h6"],
            allowedAttributes: {}
        });
    };

    res.locals.errors = [];

    // Tentar decriptografar cookie
    try {
        const decoded = jwt.verify(req.cookies.login, process.env.JWTSECRET);
        const userStatement = db.prepare("SELECT id, username, role FROM users WHERE id = ?");
        const user = userStatement.get(decoded.userid);
        req.user = user || false;
    } catch (err) {
        req.user = false;
    }

    res.locals.user = req.user;
    console.log(req.user);
    next();
});

function mustBeAdmin(req, res, next) {
    if (req.user && req.user.role === 'admin') {
        return next();
    }
    return res.redirect("/");
}

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

// Rotas
app.get("/", (req, res) => {
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

app.get("/dashboard", mustBeAdmin, (req, res) => {
    let postsStatement;
    if (req.query.filter === "mine") {
        postsStatement = db.prepare("SELECT posts.*, users.username FROM posts INNER JOIN users ON posts.authorid = users.id WHERE posts.authorid = ? ORDER BY posts.createdDate DESC");
        posts = postsStatement.all(req.user.id); // Corrigido de req.user.userid para req.user.id
    } else {
        postsStatement = db.prepare("SELECT posts.*, users.username FROM posts INNER JOIN users ON posts.authorid = users.id ORDER BY posts.createdDate DESC");
        posts = postsStatement.all();
    }
    res.render("dashboard", { posts });
});

app.get("/logout", (req, res) => {
    res.clearCookie("login");
    res.redirect("/");
});

app.get("/register", (req, res) => {
    res.render("register");
});

app.post("/register", (req, res) => {
    const errors = [];

    if (typeof req.body.username !== "string") req.body.username = "";
    if (typeof req.body.password !== "string") req.body.password = "";
    if (typeof req.body["repeat-password"] !== "string") req.body["repeat-password"] = "";

    req.body.username = req.body.username.trim();

    if (!req.body.username) errors.push("Você precisa fornecer um nome de usuário.");
    if (req.body.username && req.body.username.length < 3) errors.push("O nome de usuário precisa ser maior que 3 caracteres.");
    if (req.body.username && req.body.username.length > 12) errors.push("O nome de usuário precisa ser menor que 12 caracteres.");
    if (req.body.username && !req.body.username.match(/^[a-zA-Z0-9]+$/)) errors.push("O nome de usuário não pode conter caracteres especiais.");

    // Verificar se o nome de usuário já existe:
    const usernameStatement = db.prepare("SELECT * FROM users WHERE username = ?");
    const usernameCheck = usernameStatement.get(req.body.username);

    if (usernameCheck) errors.push("O nome de usuário especificado já foi escolhido.");

    if (!req.body.password) errors.push("Você precisa fornecer uma senha.");
    if (req.body.password && req.body.password.length < 6) errors.push("A senha precisa ser maior que 6 caracteres.");
    if (req.body.password && req.body.password.length > 70) errors.push("A senha precisa ser menor que 70 caracteres.");
    if (req.body.password !== req.body["repeat-password"]) errors.push("As senhas não coincidem.");

    if (errors.length) {
        return res.render("register", { errors });
    }

    // Salvar o novo usuário na database
    const salt = bcrypt.genSaltSync(10);
    req.body.password = bcrypt.hashSync(req.body.password, salt);
    const ourStatement = db.prepare("INSERT INTO users (username, password) VALUES (?, ?)");
    const result = ourStatement.run(req.body.username, req.body.password);

    const lookupStatement = db.prepare("SELECT * FROM users WHERE ROWID = ?");
    const ourUser = lookupStatement.get(result.lastInsertRowid);

    // Logar o usuário, dando um cookie a ele
    const ourTokenValue = jwt.sign({ exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24, userid: ourUser.id, username: ourUser.username }, process.env.JWTSECRET);
    res.cookie("login", ourTokenValue, {
        httpOnly: true,
        secure: true,
        sameSite: "strict",
        maxAge: 1000 * 60 * 60 * 24,
    });
    res.redirect("/");
});

app.get("/login", (req, res) => {
    res.render("login");
});

app.post("/login", (req, res) => {
    let errors = [];

    if (typeof req.body.username !== "string") req.body.username = "";
    if (typeof req.body.password !== "string") req.body.password = "";

    if (req.body.username.trim() == "") errors = ["Nome de usuário ou senha inválidos."];
    if (req.body.password == "") errors = ["Nome de usuário ou senha inválidos."];

    if (errors.length) {
        return res.render("login", { errors });
    }

    const userInQuestionStatement = db.prepare("SELECT * FROM users WHERE username = ?");
    const userInQuestion = userInQuestionStatement.get(req.body.username);

    if (!userInQuestion) {
        errors = ["Nome de usuário ou senha inválidos."];
        return res.render("login", { errors });
    }

    const matchOrNot = bcrypt.compareSync(req.body.password, userInQuestion.password);

    if (!matchOrNot) {
        errors = ["Nome de usuário ou senha inválidos."];
        return res.render("login", { errors });
    }

    // Logar o usuário, dando um cookie a ele
    const ourTokenValue = jwt.sign({ exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24, userid: userInQuestion.id, username: userInQuestion.username }, process.env.JWTSECRET);
    res.cookie("login", ourTokenValue, {
        httpOnly: true,
        secure: true,
        sameSite: "strict",
        maxAge: 1000 * 60 * 60 * 24,
    });
    res.redirect("/");
});

app.get("/create-post", mustBeAdmin, (req, res) => {
    res.render("create-post");
});

app.post("/create-post", mustBeAdmin, upload.single('banner'), (req, res) => {
    const errors = sharedPostValidation(req);

    if (errors.length) {
        return res.render("create-post", { errors });
    }

    const bannerPath = req.file ? `/uploads/${req.file.filename}` : null;

    const ourStatement = db.prepare("INSERT INTO posts (title, body, authorid, createdDate, banner) VALUES (?, ?, ?, ?, ?)");
    const result = ourStatement.run(req.body.title, req.body.body, req.user.id, new Date().toISOString(), bannerPath);

    const realPost = db.prepare("SELECT * FROM posts WHERE ROWID = ?").get(result.lastInsertRowid);

    res.redirect(`/post/${realPost.id}`);
});

app.get("/post/:id", (req, res) => {
    const statement = db.prepare("SELECT posts.*, users.username FROM posts INNER JOIN users ON posts.authorid = users.id WHERE posts.id = ?");
    const post = statement.get(req.params.id);

    if (!post) {
        return res.redirect("/");
    }

    const isAuthor = post.authorid === req.user.userid;

    res.render("single-post", { post: post, isAuthor });
});

app.get("/edit-post/:id", mustBeAdmin, (req, res) => {
    const statement = db.prepare("SELECT * FROM posts WHERE id = ?");
    const post = statement.get(req.params.id);

    if (!post) {
        return res.redirect("/");
    }

    if (post.authorid !== req.user.userid) {
        return res.redirect("/");
    }

    res.render("edit-post", { post });
});

app.post("/edit-post/:id", mustBeAdmin, upload.single('banner'), (req, res) => {
    const post = db.prepare("SELECT * FROM posts WHERE id = ?").get(req.params.id);

    if (!post || post.authorid !== req.user.userid) {
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

app.post("/delete-post/:id", mustBeAdmin, (req, res) => {
    const statement = db.prepare("SELECT * FROM posts WHERE id = ?");
    const post = statement.get(req.params.id);

    if (!post) {
        return res.redirect("/");
    }

    if (post.authorid !== req.user.userid) {
        return res.redirect("/");
    }

    const deleteStatement = db.prepare("DELETE FROM posts WHERE id = ?");
    deleteStatement.run(req.params.id);

    res.redirect("/dashboard");
});

app.listen(2020);