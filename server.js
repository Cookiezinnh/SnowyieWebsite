require("dotenv").config();

const express = require("express");
const cookieParser = require("cookie-parser");
const path = require('path');
const db = require("./config/db");

const authRoutes = require("./routes/authRoutes");
const postRoutes = require("./routes/postRoutes");
const indexRoutes = require("./routes/indexRoutes");
const contentRoutes = require('./routes/contentRoutes');
const settingsRoutes = require("./routes/settingsRoutes");
const userRoutes = require("./routes/userRoutes");

const { mustBeAdmin } = require("./middlewares/authMiddleware");
const { filterUserHTML } = require("./utils/helper.js");

const app = express();

app.set("view engine", "ejs");
app.use(express.urlencoded({ extended: false }));
app.use(express.static("public"));
app.use('/static', express.static(path.join(__dirname, 'public')));
app.use(cookieParser());

// Middleware para verificar autenticação
app.use(require("./middlewares/authMiddleware").authMiddleware);

// Middleware para injetar o usuário em todos os templates
app.use((req, res, next) => {
    if (req.user) {
        res.locals.user = req.user; // Injeta o usuário autenticado em todos os templates
    } else {
        res.locals.user = null; // Define como null se não houver usuário autenticado
    }
    next();
});

// Tornar a função disponível para todos os templates EJS
app.locals.filterUserHTML = filterUserHTML;

// Rotas
app.use("/", indexRoutes);
app.use("/", authRoutes);
app.use("/", settingsRoutes);
app.use("/", postRoutes);
app.use('/', contentRoutes);
app.use('/', userRoutes); // Adiciona as rotas de usuário

app.listen(2020, () => {
    console.log("Servidor rodando na porta 2020");
});