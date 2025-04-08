const express = require("express");
const router = express.Router();
const db = require("../config/db");
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configuração do Multer para upload de arquivos
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadPath = path.join(__dirname, '../public/uploads/users');
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
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // Limite de 5MB
    fileFilter: (req, file, cb) => {
        const filetypes = /jpeg|jpg|png|gif/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        
        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('Apenas imagens são permitidas (jpeg, jpg, png, gif)'));
    }
});

// Helper para formatar datas e ordenar
const sortByDateDesc = (a, b) => new Date(b.createdDate) - new Date(a.createdDate);

// Rota para exibir o perfil do usuário
router.get("/users/:id", async (req, res) => {
    try {
        const userId = req.params.id;

        // Busca as informações do usuário
        const userStatement = db.prepare("SELECT *, datetime(createdDate, 'localtime') as formattedDate FROM users WHERE id = ?");
        const profileUser = userStatement.get(userId);

        if (!profileUser) {
            return res.status(404).render("404", { message: "Usuário não encontrado." });
        }

        // Verifica se o usuário é administrador
        profileUser.isAdmin = profileUser.role === 'admin';
        profileUser.createdDate = profileUser.formattedDate || profileUser.createdDate;

        // Busca os conteúdos publicados pelo usuário (ordenados por data decrescente)
        const contentsStatement = db.prepare(`
            SELECT *, 
                   datetime(createdDate, 'localtime') as formattedDate 
            FROM contents 
            WHERE authorid = ? 
            ORDER BY createdDate DESC
        `);
        let contents = contentsStatement.all(userId);
        contents = contents.map(content => ({
            ...content,
            createdDate: content.formattedDate || content.createdDate
        }));

        // Busca as postagens publicadas pelo usuário (ordenadas por data decrescente)
        const postsStatement = db.prepare(`
            SELECT *, 
                   datetime(createdDate, 'localtime') as formattedDate 
            FROM posts 
            WHERE authorid = ? 
            ORDER BY createdDate DESC
        `);
        let posts = postsStatement.all(userId);
        posts = posts.map(post => ({
            ...post,
            createdDate: post.formattedDate || post.createdDate
        }));

        res.render("profile", { 
            user: req.user, // Usuário logado (se houver)
            profileUser,   // Usuário cujo perfil está sendo visualizado
            contents,      // Conteúdos publicados pelo usuário (já ordenados)
            posts          // Postagens publicadas pelo usuário (já ordenadas)
        });

    } catch (error) {
        console.error("Erro ao carregar perfil:", error);
        res.status(500).render("500", { message: "Erro ao carregar o perfil do usuário." });
    }
});

// Rota para editar o perfil do usuário
router.post("/users/:id/edit", upload.single('avatar'), async (req, res) => {
    try {
        const userId = req.params.id;
        const { bio, display_name } = req.body;
        
        // Verifica se o usuário logado é o dono do perfil
        if (!req.user || req.user.id !== parseInt(userId)) {
            return res.status(403).render("403", { message: "Você não tem permissão para editar este perfil." });
        }

        let avatarPath = null;
        if (req.file) {
            // Remove a imagem antiga se existir
            if (req.user.avatar && !req.user.avatar.startsWith('http')) {
                const oldPath = path.join(__dirname, '../public', req.user.avatar);
                if (fs.existsSync(oldPath)) {
                    fs.unlinkSync(oldPath);
                }
            }
            avatarPath = `/uploads/users/${req.file.filename}`;
        }

        const updateStatement = db.prepare(`
            UPDATE users 
            SET bio = ?, display_name = ?, avatar = COALESCE(?, avatar) 
            WHERE id = ?
        `);
        updateStatement.run(bio, display_name, avatarPath, userId);

        res.redirect(`/users/${userId}`);

    } catch (error) {
        console.error("Erro ao editar perfil:", error);
        if (error instanceof multer.MulterError) {
            return res.status(400).render("400", { message: "Arquivo muito grande. O tamanho máximo é 5MB." });
        }
        res.status(500).render("500", { message: "Erro ao atualizar o perfil." });
    }
});

module.exports = router;