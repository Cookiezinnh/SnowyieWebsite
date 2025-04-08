const express = require("express");
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require("../config/db");
const { mustBeAdmin } = require("../middlewares/authMiddleware");
const throttle = require('throttle');

// Configuração do Multer para upload de arquivos
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const contentId = req.params.id || "temp";
        const uploadPath = path.join(__dirname, `../public/uploads/contents/${contentId}`);
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
    limits: { fileSize: 100 * 1024 * 1024 },
    fileFilter: function (req, file, cb) {
        cb(null, true);
    }
});

// Rota para exibir o formulário de criação de conteúdo
router.get("/create-content", mustBeAdmin, (req, res) => {
    res.render("create-content", { errors: [] });
});

// Rota para processar o formulário de criação de conteúdo
router.post("/create-content", mustBeAdmin, upload.fields([{ name: 'banner', maxCount: 1 }, { name: 'photo', maxCount: 1 }, { name: 'file', maxCount: 1 }, { name: 'carousel', maxCount: 10 }]), (req, res) => {
    const errors = [];

    if (!req.body.name) errors.push("Você precisa providenciar um nome.");
    if (!req.files.file) errors.push("Você precisa providenciar um arquivo para download.");

    if (errors.length) {
        return res.render("create-content", { errors });
    }

    const tempBannerPath = req.files.banner ? `/uploads/contents/temp/${req.files.banner[0].filename}` : null;
    const tempPhotoPath = req.files.photo ? `/uploads/contents/temp/${req.files.photo[0].filename}` : null;
    const tempFilePath = `/uploads/contents/temp/${req.files.file[0].filename}`;
    const tempCarouselPaths = req.files.carousel ? req.files.carousel.map(file => `/uploads/contents/temp/${file.filename}`) : [];
    const tags = req.body.tags ? JSON.stringify(req.body.tags.split(',').map(tag => tag.trim())) : null;

    const ourStatement = db.prepare("INSERT INTO contents (name, description, banner, photo, file_path, external_link, type, category, authorid, createdDate, carousel, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    const result = ourStatement.run(
        req.body.name,
        req.body.description,
        tempBannerPath,
        tempPhotoPath,
        tempFilePath,
        req.body.external_link,
        req.body.type,
        req.body.category,
        req.user.id,
        new Date().toISOString(),
        JSON.stringify(tempCarouselPaths),
        tags
    );

    const contentPath = path.join(__dirname, `../public/uploads/contents/${result.lastInsertRowid}`);
    if (!fs.existsSync(contentPath)) {
        fs.mkdirSync(contentPath, { recursive: true });
    }

    if (req.files.banner) {
        const tempBannerFile = path.join(__dirname, `../public/uploads/contents/temp/${req.files.banner[0].filename}`);
        const newBannerFile = path.join(contentPath, req.files.banner[0].filename);
        fs.renameSync(tempBannerFile, newBannerFile);
    }

    if (req.files.photo) {
        const tempPhotoFile = path.join(__dirname, `../public/uploads/contents/temp/${req.files.photo[0].filename}`);
        const newPhotoFile = path.join(contentPath, req.files.photo[0].filename);
        fs.renameSync(tempPhotoFile, newPhotoFile);
    }

    if (req.files.file) {
        const tempFile = path.join(__dirname, `../public/uploads/contents/temp/${req.files.file[0].filename}`);
        const newFile = path.join(contentPath, req.files.file[0].filename);
        fs.renameSync(tempFile, newFile);
    }

    if (req.files.carousel) {
        req.files.carousel.forEach(file => {
            const tempCarouselFile = path.join(__dirname, `../public/uploads/contents/temp/${file.filename}`);
            const newCarouselFile = path.join(contentPath, file.filename);
            fs.renameSync(tempCarouselFile, newCarouselFile);
        });
    }

    const bannerPath = req.files.banner ? `/uploads/contents/${result.lastInsertRowid}/${req.files.banner[0].filename}` : null;
    const photoPath = req.files.photo ? `/uploads/contents/${result.lastInsertRowid}/${req.files.photo[0].filename}` : null;
    const filePath = `/uploads/contents/${result.lastInsertRowid}/${req.files.file[0].filename}`;
    const carouselPaths = req.files.carousel ? req.files.carousel.map(file => `/uploads/contents/${result.lastInsertRowid}/${file.filename}`) : [];

    const updateStatement = db.prepare(`
        UPDATE contents 
        SET banner = ?, photo = ?, file_path = ?, carousel = ?
        WHERE id = ?
    `);
    updateStatement.run(
        bannerPath,
        photoPath,
        filePath,
        JSON.stringify(carouselPaths),
        result.lastInsertRowid
    );

    res.redirect(`/content/${result.lastInsertRowid}`);
});

// Rota para exibir um conteúdo individual
router.get("/content/:id", (req, res) => {
    const statement = db.prepare(`
        SELECT contents.*, users.display_name, users.avatar 
        FROM contents 
        INNER JOIN users ON contents.authorid = users.id 
        WHERE contents.id = ?
    `);
    const content = statement.get(req.params.id);

    if (!content) {
        return res.redirect("/");
    }

    const isAuthor = req.user && content.authorid === req.user.id;

    db.prepare("UPDATE contents SET views = views + 1 WHERE id = ?").run(req.params.id);

    res.render("single-content", { 
        content, 
        user: req.user, 
        isAuthor
    });
});

// Rota para baixar o arquivo - Versão melhorada
router.get("/download-content/:id", (req, res) => {
    try {
        const statement = db.prepare("SELECT file_path FROM contents WHERE id = ?");
        const content = statement.get(req.params.id);

        if (!content || !content.file_path) {
            return res.status(404).render('error', { 
                message: "Arquivo não encontrado.",
                error: { status: 404 }
            });
        }

        const filePath = path.join(__dirname, '../public', content.file_path);

        if (!fs.existsSync(filePath)) {
            return res.status(404).render('error', {
                message: "O arquivo solicitado não existe mais no servidor.",
                error: { status: 404 }
            });
        }

        // Atualiza contador de downloads de forma assíncrona
        db.prepare("UPDATE contents SET downloads = downloads + 1 WHERE id = ?").run(req.params.id);

        // Configura timeout de 10 minutos para download
        req.setTimeout(600000, () => {
            if (!res.headersSent) {
                console.log(`Timeout de download para o arquivo ${content.file_path}`);
            }
        });

        // Configura handlers para erros
        req.on('aborted', () => {
            console.log(`Download abortado pelo cliente: ${content.file_path}`);
        });

        req.on('error', (err) => {
            console.error(`Erro na conexão durante download: ${err.message}`);
        });

        res.on('error', (err) => {
            console.error(`Erro ao enviar resposta: ${err.message}`);
        });

        // Obtém estatísticas do arquivo para enviar headers adequados
        const stats = fs.statSync(filePath);
        const fileSize = stats.size;
        const fileName = path.basename(filePath);

        res.setHeader('Content-Length', fileSize);
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

        // Cria stream com throttling (limite de 1MB/s)
        const readStream = fs.createReadStream(filePath);
        const throttledStream = new throttle(1024 * 1024); // 1MB/s

        readStream.pipe(throttledStream).pipe(res)
            .on('finish', () => {
                console.log(`Download concluído: ${fileName}`);
            })
            .on('error', (err) => {
                if (!res.headersSent) {
                    console.error(`Erro durante o streaming do arquivo: ${err.message}`);
                    res.status(500).render('error', {
                        message: "Ocorreu um erro durante o download.",
                        error: { status: 500 }
                    });
                }
            });

    } catch (error) {
        console.error(`Erro no processo de download: ${error.message}`);
        if (!res.headersSent) {
            res.status(500).render('error', {
                message: "Ocorreu um erro interno ao processar seu download.",
                error: { status: 500 }
            });
        }
    }
});

// Rota para exibir o formulário de edição de conteúdo
router.get("/edit-content/:id", mustBeAdmin, (req, res) => {
    const statement = db.prepare("SELECT * FROM contents WHERE id = ?");
    const content = statement.get(req.params.id);

    if (!content) {
        return res.redirect("/");
    }

    res.render("edit-content", { content, errors: [] });
});

// Rota para processar o formulário de edição de conteúdo
router.post("/edit-content/:id", mustBeAdmin, upload.fields([{ name: 'banner', maxCount: 1 }, { name: 'photo', maxCount: 1 }, { name: 'file', maxCount: 1 }, { name: 'carousel', maxCount: 10 }]), (req, res) => {
    const content = db.prepare("SELECT * FROM contents WHERE id = ?").get(req.params.id);

    if (!content) {
        return res.redirect("/");
    }

    const errors = [];

    if (!req.body.name) errors.push("Você precisa providenciar um nome.");

    if (errors.length) {
        return res.render("edit-content", { content, errors });
    }

    const bannerPath = req.files.banner ? `/uploads/contents/${req.params.id}/${req.files.banner[0].filename}` : content.banner;
    const photoPath = req.files.photo ? `/uploads/contents/${req.params.id}/${req.files.photo[0].filename}` : content.photo;
    const filePath = req.files.file ? `/uploads/contents/${req.params.id}/${req.files.file[0].filename}` : content.file_path;
    const carouselPaths = req.files.carousel ? req.files.carousel.map(file => `/uploads/contents/${req.params.id}/${file.filename}`) : JSON.parse(content.carousel || '[]');
    const tags = req.body.tags ? JSON.stringify(req.body.tags.split(',').map(tag => tag.trim())) : content.tags;

    const updateStatement = db.prepare(`
        UPDATE contents 
        SET name = ?, description = ?, banner = ?, photo = ?, file_path = ?, external_link = ?, type = ?, category = ?, carousel = ?, tags = ?
        WHERE id = ?
    `);
    updateStatement.run(
        req.body.name,
        req.body.description,
        bannerPath,
        photoPath,
        filePath,
        req.body.external_link,
        req.body.type,
        req.body.category,
        JSON.stringify(carouselPaths),
        tags,
        req.params.id
    );

    res.redirect(`/content/${req.params.id}`);
});

// Rota para excluir um conteúdo
router.post("/delete-content/:id", mustBeAdmin, (req, res) => {
    const statement = db.prepare("SELECT * FROM contents WHERE id = ?");
    const content = statement.get(req.params.id);

    if (!content) {
        return res.redirect("/");
    }

    const deleteStatement = db.prepare("DELETE FROM contents WHERE id = ?");
    deleteStatement.run(req.params.id);

    const contentPath = path.join(__dirname, `../public/uploads/contents/${req.params.id}`);
    if (fs.existsSync(contentPath)) {
        fs.rmdirSync(contentPath, { recursive: true });
    }

    res.redirect("/dashboard");
});

// Rota para adicionar uma franquia
router.post("/add-franchise", mustBeAdmin, (req, res) => {
    const { name } = req.body;
    if (!name) {
        return res.status(400).json({ error: "O nome da franquia é obrigatório." });
    }

    try {
        const statement = db.prepare("INSERT INTO franchises (name) VALUES (?)");
        statement.run(name);
        res.status(201).json({ message: "Franquia adicionada com sucesso!" });
    } catch (error) {
        res.status(500).json({ error: "Erro ao adicionar franquia." });
    }
});

// Rota para adicionar um jogo
router.post("/add-game", mustBeAdmin, (req, res) => {
    const { name, franchise_id } = req.body;
    if (!name) {
        return res.status(400).json({ error: "O nome do jogo é obrigatório." });
    }

    try {
        const statement = db.prepare("INSERT INTO games (name, franchise_id) VALUES (?, ?)");
        statement.run(name, franchise_id);
        res.status(201).json({ message: "Jogo adicionado com sucesso!" });
    } catch (error) {
        res.status(500).json({ error: "Erro ao adicionar jogo." });
    }
});

// Rota para buscar franquias
router.get("/franchises", (req, res) => {
    const franchises = db.prepare("SELECT * FROM franchises ORDER BY name").all();
    res.json(franchises);
});

// Rota para buscar jogos
router.get("/games", (req, res) => {
    const games = db.prepare(`
        SELECT g.*, f.name as franchise_name 
        FROM games g
        LEFT JOIN franchises f ON g.franchise_id = f.id
        ORDER BY COALESCE(f.name, 'ZZZ'), g.name
    `).all();
    res.json(games);
});

// Rota /media atualizada
router.get("/media", (req, res) => {
    const type = req.query.type;
    
    if (!type) {
        // Tela de escolha quando nenhum tipo é especificado
        return res.render("media", {
            viewType: 'choice',
            showChoice: true,
            layout: 'news-layout'
        });
    }
    
    if (type === 'games') {
        const games = db.prepare(`
            SELECT id, name, banner as image, createdDate as release_year, category
            FROM contents
            WHERE type = 'Jogo Standalone'
            ORDER BY category, name
        `).all();

        // Agrupa jogos por categoria
        const gamesByCategory = {};
        games.forEach(game => {
            const category = game.category || "Outros";
            if (!gamesByCategory[category]) {
                gamesByCategory[category] = [];
            }
            game.image = game.image || '/static/images/default/default_game.png';
            if (game.release_year) {
                game.release_year = new Date(game.release_year).getFullYear();
            }
            gamesByCategory[category].push(game);
        });

        // Ordena categorias (Outros no final)
        const sortedCategories = Object.keys(gamesByCategory).sort((a, b) => {
            if (a === "Outros") return 1;
            if (b === "Outros") return -1;
            return a.localeCompare(b);
        });

        const orderedData = {};
        sortedCategories.forEach(category => {
            orderedData[category] = gamesByCategory[category];
        });

        return res.render("media", {
            viewType: 'games',
            noGamesAvailable: games.length === 0,
            gamesByFranchise: orderedData,
            user: req.user,
            showChoice: false,
            layout: 'news-layout'
        });
    } 
    else if (type === 'contents') {
        const gameId = req.query.game;
        const tag = req.query.tag;
        
        const games = db.prepare(`
            SELECT id, name, COALESCE(image, '/static/images/default/default_game.png') as image
            FROM games 
            ORDER BY name
        `).all();
        
        let tagsQuery = `
            SELECT DISTINCT json_each.value as tag 
            FROM contents, json_each(contents.tags) 
            WHERE contents.type = 'Conteúdo ADD-ON'
        `;
        const tagsParams = [];
        
        if (gameId) {
            const game = db.prepare("SELECT name FROM games WHERE id = ?").get(gameId);
            if (game) {
                tagsQuery += " AND category = ?";
                tagsParams.push(game.name);
            }
        }
        
        const tags = db.prepare(tagsQuery + " GROUP BY tag ORDER BY tag").all(...tagsParams);
        
        let query = `
            SELECT contents.*, users.display_name, users.avatar 
            FROM contents 
            INNER JOIN users ON contents.authorid = users.id
            WHERE contents.type = 'Conteúdo ADD-ON'
        `;
        const params = [];
        
        if (gameId) {
            query += " AND category = (SELECT name FROM games WHERE id = ?)";
            params.push(gameId);
        }
        if (tag) {
            query += " AND tags LIKE ?";
            params.push(`%"${tag}"%`);
        }
        
        const contents = db.prepare(query + " ORDER BY createdDate DESC").all(...params);
        
        return res.render("media", {
            viewType: 'contents',
            contents,
            games,
            tags,
            currentGame: gameId,
            currentTag: tag,
            showChoice: false,
            layout: 'news-layout'
        });
    }
});

module.exports = router;