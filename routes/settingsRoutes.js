const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const db = require("../config/db");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Configuração do Multer para upload de arquivos
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const userId = req.user.id; // Usa o ID do usuário logado
        const uploadPath = path.join(__dirname, `../public/uploads/users/${userId}`);
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }
        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const upload = multer({ storage });

// Middleware para verificar autenticação
const authMiddleware = require("../middlewares/authMiddleware");
router.use(authMiddleware.authMiddleware);

// Rota para exibir o formulário de configurações
router.get("/settings", (req, res) => {
    if (!req.user) {
        return res.redirect("/login");
    }

    const userStatement = db.prepare("SELECT * FROM users WHERE id = ?");
    const user = userStatement.get(req.user.id);

    res.render("settings", { user, errors: [] });
});

// Rota para processar o formulário de configurações
router.post("/settings", upload.fields([
    { name: "avatar", maxCount: 1 }, // Campo para o avatar
    { name: "banner", maxCount: 1 }  // Campo para o banner
]), (req, res) => {
    const errors = [];
    const userStatement = db.prepare("SELECT * FROM users WHERE id = ?");
    const user = userStatement.get(req.user.id);

    // Verifica o tipo de formulário
    const formType = req.body.formType;

    if (formType === "avatar") {
        // Lógica para o avatar
        if (req.files && req.files["avatar"]) {
            const avatarFile = req.files["avatar"][0];
            const avatarPath = `/uploads/users/${req.user.id}/${avatarFile.filename}`;
            const updateStatement = db.prepare("UPDATE users SET avatar = ? WHERE id = ?");
            updateStatement.run(avatarPath, req.user.id);
        } else {
            errors.push({ message: "Nenhum arquivo de avatar foi enviado.", formType: "avatar" });
        }
    } else if (formType === "banner") {
        // Lógica para o banner
        if (req.files && req.files["banner"]) {
            const bannerFile = req.files["banner"][0];
            const bannerPath = `/uploads/users/${req.user.id}/${bannerFile.filename}`;
            const updateStatement = db.prepare("UPDATE users SET banner = ? WHERE id = ?");
            updateStatement.run(bannerPath, req.user.id);
        } else {
            errors.push({ message: "Nenhum arquivo de banner foi enviado.", formType: "banner" });
        }
    } else if (formType === "profile") {
        // Validação do nome de usuário
        if (req.body.username) {
            if (req.body.username.length < 3) errors.push({ message: "O nome de usuário precisa ser maior que 3 caracteres.", formType: "profile" });
            if (req.body.username.length > 12) errors.push({ message: "O nome de usuário precisa ser menor que 12 caracteres.", formType: "profile" });
            if (!req.body.username.match(/^[a-zA-Z0-9]+$/)) errors.push({ message: "O nome de usuário não pode conter caracteres especiais.", formType: "profile" });

            const normalizedUsername = req.body.username.toLowerCase();
            const usernameStatement = db.prepare("SELECT * FROM users WHERE LOWER(username) = ? AND id != ?");
            const usernameCheck = usernameStatement.get(normalizedUsername, user.id);

            if (usernameCheck) errors.push({ message: "O nome de usuário especificado já foi escolhido.", formType: "profile" });
        }

        // Validação do e-mail
        if (req.body.email) {
            if (!req.body.email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) errors.push({ message: "O email fornecido é inválido.", formType: "profile" });

            const emailStatement = db.prepare("SELECT * FROM users WHERE LOWER(email) = ? AND id != ?");
            const emailCheck = emailStatement.get(req.body.email.toLowerCase(), user.id);

            if (emailCheck) errors.push({ message: "O email especificado já foi escolhido.", formType: "profile" });
        }

        // Atualiza o perfil se não houver erros
        if (errors.length === 0) {
            const updateStatement = db.prepare("UPDATE users SET username = ?, display_name = ?, email = ?, bio = ? WHERE id = ?");
            updateStatement.run(
                req.body.username || user.username,
                req.body.displayName || user.display_name,
                req.body.email || user.email,
                req.body.bio || user.bio, // Adiciona a bio
                user.id
            );
        }
    } else if (formType === "password") {
        // Validação da senha
        if (req.body.newPassword) {
            if (req.body.newPassword.length < 6) errors.push({ message: "A nova senha precisa ser maior que 6 caracteres.", formType: "password" });
            if (req.body.newPassword.length > 70) errors.push({ message: "A nova senha precisa ser menor que 70 caracteres.", formType: "password" });
            if (req.body.newPassword !== req.body["repeat-new-password"]) errors.push({ message: "As novas senhas não coincidem.", formType: "password" });

            const matchOrNot = bcrypt.compareSync(req.body.oldPassword, user.password);
            if (!matchOrNot) errors.push({ message: "A senha antiga está incorreta.", formType: "password" });
        }

        // Atualiza a senha se não houver erros
        if (errors.length === 0) {
            const salt = bcrypt.genSaltSync(10);
            const newPassword = bcrypt.hashSync(req.body.newPassword, salt);

            const updateStatement = db.prepare("UPDATE users SET password = ? WHERE id = ?");
            updateStatement.run(newPassword, user.id);
        }
    }

    // Se houver erros, retorna para a página de configurações com os erros
    if (errors.length) {
        return res.render("settings", { user, errors });
    }

    // Redireciona de volta para a página de configurações
    res.redirect("/settings");
});

// Rota para excluir a conta do usuário
router.post("/delete-account", (req, res) => {
    const userStatement = db.prepare("SELECT * FROM users WHERE id = ?");
    const user = userStatement.get(req.user.id);

    if (!user) {
        return res.redirect("/settings");
    }

    // Verifica se a senha fornecida está correta
    const matchOrNot = bcrypt.compareSync(req.body.password, user.password);
    if (!matchOrNot) {
        return res.render("settings", { user, errors: [{ message: "A senha fornecida está incorreta.", formType: "delete-account" }] });
    }

    // Exclui o usuário do banco de dados
    const deleteStatement = db.prepare("DELETE FROM users WHERE id = ?");
    deleteStatement.run(req.user.id);

    // Exclui a pasta do usuário
    const userPath = path.join(__dirname, `../public/uploads/users/${req.user.id}`);
    if (fs.existsSync(userPath)) {
        fs.rmdirSync(userPath, { recursive: true });
    }

    // Desloga o usuário e redireciona para a página inicial
    res.clearCookie("token");
    res.redirect("/");
});

module.exports = router;