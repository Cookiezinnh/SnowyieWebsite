const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const db = require("../config/db");

// Rota para exibir o formulário de registro
router.get("/register", (req, res) => {
    res.render("register", { errors: [] });
});

// Rota para processar o formulário de registro
router.post("/register", (req, res) => {
    const errors = [];

    if (typeof req.body.username !== "string") req.body.username = "";
    if (typeof req.body.password !== "string") req.body.password = "";
    if (typeof req.body["repeat-password"] !== "string") req.body["repeat-password"] = "";
    if (typeof req.body.email !== "string") req.body.email = "";

    req.body.username = req.body.username.trim();
    req.body.email = req.body.email.trim();

    if (!req.body.username) errors.push("Você precisa fornecer um nome de usuário.");
    if (req.body.username && req.body.username.length < 3) errors.push("O nome de usuário precisa ser maior que 3 caracteres.");
    if (req.body.username && req.body.username.length > 12) errors.push("O nome de usuário precisa ser menor que 12 caracteres.");
    if (req.body.username && !req.body.username.match(/^[a-zA-Z0-9]+$/)) errors.push("O nome de usuário não pode conter caracteres especiais.");

    if (!req.body.email) errors.push("Você precisa fornecer um email.");
    if (req.body.email && !req.body.email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) errors.push("O email fornecido é inválido.");

    const normalizedUsername = req.body.username.toLowerCase(); // Normaliza o nome de usuário para minúsculas
    const usernameStatement = db.prepare("SELECT * FROM users WHERE LOWER(username) = ?");
    const usernameCheck = usernameStatement.get(normalizedUsername);

    if (usernameCheck) errors.push("O nome de usuário especificado já foi escolhido.");

    const emailStatement = db.prepare("SELECT * FROM users WHERE LOWER(email) = ?");
    const emailCheck = emailStatement.get(req.body.email.toLowerCase());

    if (emailCheck) errors.push("O email especificado já foi escolhido.");

    if (!req.body.password) errors.push("Você precisa fornecer uma senha.");
    if (req.body.password && req.body.password.length < 6) errors.push("A senha precisa ser maior que 6 caracteres.");
    if (req.body.password && req.body.password.length > 70) errors.push("A senha precisa ser menor que 70 caracteres.");
    if (req.body.password !== req.body["repeat-password"]) errors.push("As senhas não coincidem.");

    if (errors.length) {
        return res.render("register", { errors });
    }

    const salt = bcrypt.genSaltSync(10);
    req.body.password = bcrypt.hashSync(req.body.password, salt);
    const ourStatement = db.prepare("INSERT INTO users (username, password, email) VALUES (?, ?, ?)");
    const result = ourStatement.run(normalizedUsername, req.body.password, req.body.email);

    const lookupStatement = db.prepare("SELECT * FROM users WHERE ROWID = ?");
    const ourUser = lookupStatement.get(result.lastInsertRowid);

    const ourTokenValue = jwt.sign({ exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24, userid: ourUser.id, username: ourUser.username }, process.env.JWTSECRET);
    res.cookie("login", ourTokenValue, {
        httpOnly: true,
        secure: true,
        sameSite: "strict",
        maxAge: 1000 * 60 * 60 * 24,
    });
    res.redirect("/");
});

// Rota para exibir o formulário de login
router.get("/login", (req, res) => {
    res.render("login", { errors: [] });
});

// Rota para processar o formulário de login
router.post("/login", (req, res) => {
    let errors = [];

    if (typeof req.body.username !== "string") req.body.username = "";
    if (typeof req.body.password !== "string") req.body.password = "";

    if (req.body.username.trim() === "") errors.push("Nome de usuário ou senha inválidos.");
    if (req.body.password === "") errors.push("Nome de usuário ou senha inválidos.");

    if (errors.length) {
        return res.render("login", { errors });
    }

    const normalizedUsername = req.body.username.toLowerCase(); // Normaliza o nome de usuário para minúsculas
    const userInQuestionStatement = db.prepare("SELECT * FROM users WHERE LOWER(username) = ? OR LOWER(email) = ?");
    const userInQuestion = userInQuestionStatement.get(normalizedUsername, normalizedUsername);

    if (!userInQuestion) {
        errors.push("Nome de usuário ou senha inválidos.");
        return res.render("login", { errors });
    }

    const matchOrNot = bcrypt.compareSync(req.body.password, userInQuestion.password);

    if (!matchOrNot) {
        errors.push("Nome de usuário ou senha inválidos.");
        return res.render("login", { errors });
    }

    const ourTokenValue = jwt.sign({ exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24, userid: userInQuestion.id, username: userInQuestion.username }, process.env.JWTSECRET);
    res.cookie("login", ourTokenValue, {
        httpOnly: true,
        secure: true,
        sameSite: "strict",
        maxAge: 1000 * 60 * 60 * 24,
    });
    res.redirect("/");
});

// Rota para logout
router.get("/logout", (req, res) => {
    res.clearCookie("login");
    res.redirect("/");
});

module.exports = router;