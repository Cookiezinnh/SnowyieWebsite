const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const db = require("../config/db");

// Rota para exibir o formulário de registro
router.get("/register", (req, res) => {
    res.render("register", { errors: [] }); // Sempre passe `errors`, mesmo que vazio
});

// Rota para processar o formulário de registro
router.post("/register", (req, res) => {
    const errors = [];

    if (typeof req.body.username !== "string") req.body.username = "";
    if (typeof req.body.password !== "string") req.body.password = "";
    if (typeof req.body["repeat-password"] !== "string") req.body["repeat-password"] = "";

    req.body.username = req.body.username.trim();

    if (!req.body.username) errors.push("Você precisa fornecer um nome de usuário.");
    if (req.body.username && req.body.username.length < 3) errors.push("O nome de usuário precisa ser maior que 3 caracteres.");
    if (req.body.username && req.body.username.length > 12) errors.push("O nome de usuário precisa ser menor que 12 caracteres.");
    if (req.body.username && !req.body.username.match(/^[a-zA-Z0-9]+$/)) errors.push("O nome de usuário não pode conter caracteres especiais.");

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

    const salt = bcrypt.genSaltSync(10);
    req.body.password = bcrypt.hashSync(req.body.password, salt);
    const ourStatement = db.prepare("INSERT INTO users (username, password) VALUES (?, ?)");
    const result = ourStatement.run(req.body.username, req.body.password);

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
    res.render("login", { errors: [] }); // Sempre passe `errors`, mesmo que vazio
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

    const userInQuestionStatement = db.prepare("SELECT * FROM users WHERE username = ?");
    const userInQuestion = userInQuestionStatement.get(req.body.username);

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