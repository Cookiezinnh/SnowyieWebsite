require("dotenv").config();
const express = require("express");
const cookieParser = require("cookie-parser");
const path = require('path');
const db = require("./config/db");
const authRoutes = require("./routes/authRoutes");
const postRoutes = require("./routes/postRoutes");
const indexRoutes = require("./routes/indexRoutes");
const { mustBeAdmin } = require("./middlewares/authMiddleware");

const app = express();

app.set("view engine", "ejs");
app.use(express.urlencoded({ extended: false }));
app.use(express.static("public"));
app.use('/static', express.static(path.join(__dirname, 'public')));
app.use(cookieParser());

// Middleware para verificar autenticação
app.use(require("./middlewares/authMiddleware").authMiddleware);

// Rotas
app.use("/", indexRoutes);
app.use("/", authRoutes);
app.use("/", postRoutes);

app.listen(2020, () => {
    console.log("Servidor rodando na porta 2020");
});