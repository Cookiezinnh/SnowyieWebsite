require("dotenv").config()
const jwt          = require("jsonwebtoken")
const sanitizeHTML = require("sanitize-html")
const bcrypt       = require("bcrypt")
const cookieParser = require("cookie-parser")
const express      = require("express")
const db           = require("better-sqlite3")("Snowyie.db");
const path         = require('path');
db.pragma("journal_mode = WAL");

// Database setup
const createTables = db.transaction(() => {
    db.prepare(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username STRING NOT NULL UNIQUE,
            password STRING NOT NULL
        )
    `).run()

    db.prepare(`
        CREATE TABLE IF NOT EXISTS posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            createdDate TEXT,
            title STRING NOT NULL,
            body TEXT NOT NULL,
            authorid INTEGER,
            FOREIGN KEY (authorid) REFERENCES users (id)
        )
    `).run();
});

createTables();
const app = express()

app.set("view engine", "ejs")
app.use(express.urlencoded({extended: false}))
app.use(express.static("public"));
app.use('/static', express.static(path.join(__dirname, 'public')));

app.use(cookieParser())

app.use(function (req, res, next) {
    res.locals.errors = []

    // tentar decriptografar cookie
    try{
        const decoded = jwt.verify(req.cookies.login, process.env.JWTSECRET)
        req.user = decoded
    }catch(err){
        req.user = false
    }

    res.locals.user = req.user
    console.log(req.user)
    next()
})

app.get("/", (req, res) =>{
    res.render("index")
})

app.get("/dashboard", (req, res) =>{
    const postsStatement = db.prepare("SELECT * FROM posts WHERE authorid = ?")
    const posts = postsStatement.all(req.user.userid)
    res.render("dashboard", {posts})
})

app.get("/logout", (req, res) =>{
    res.clearCookie("login")
    res.redirect("/")
})

app.get("/register", (req, res) =>{
    res.render("register")
})

app.get("/login", (req, res) =>{
    res.render("login")
})
app.post("/login", (req, res) =>{
    let errors = []

    if (typeof req.body.username !== "string") req.body.username = ""
    if (typeof req.body.password !== "string") req.body.password = ""

    if (req.body.username.trim() == "") errors = ["Nome de usuario ou senha invalidos."]
    if (req.body.password == "") errors = ["Nome de usuario ou senha invalidos."]

    if (errors.length) {
        return res.render("login", {errors})
    }

    const userInQuestionStatement = db.prepare("SELECT * FROM users WHERE USERNAME = ?")
    const userInQuestion = userInQuestionStatement.get(req.body.username)

    if (!userInQuestion) {
        errors = ["Nome de usuario ou senha invalidos."]
        return res.render("login", {errors})
    }

    const matchOrNot = bcrypt.compareSync(req.body.password, userInQuestion.password)

    if (!matchOrNot){
        errors = ["Nome de usuario ou senha invalidos."]
        return res.render("login", {errors})
    }

    // logar o usuario, dando um cookie a ele
    const ourTokenValue = jwt.sign({exp:Math.floor(Date.now()/1000) + 60 * 60 * 24, userid:userInQuestion.id, username: userInQuestion.username}, process.env.JWTSECRET)
    res.cookie("login", ourTokenValue, {
        httpOnly: true,
        secure: true,
        sameSite: "strict",
        maxAge: 1000 * 60 * 60 * 24
    })
    res.redirect("/")
})

function mustBeLoggedIn(req, res, next) {
    if (req.user) {
        return next()
    }

    return res.redirect("/")
}

app.get("/create-post", mustBeLoggedIn, (req, res) =>{
    res.render("create-post")
})

function sharedPostValidation(req) {
    const errors = []

    if (typeof req.body.title !== "string") req.body.title = ""
    if (typeof req.body.body !== "string") req.body.body = ""

    req.body.title = sanitizeHTML(req.body.title.trim(), {allowedTags: [], allowedAttributes: {}})
    req.body.body = sanitizeHTML(req.body.body.trim(), {allowedTags: [], allowedAttributes: {}})

    if (!req.body.title) errors.push("Você precisa providenciar um titulo.")
    if (!req.body.body) errors.push("Você precisa providenciar um textp.")

    return errors
}

app.get("/edit-post/:id", mustBeLoggedIn, (req, res) => {
    const statement = db.prepare("SELECT * FROM posts WHERE id = ?");
    const post = statement.get(req.params.id);

    if (!post){
        return res.redirect("/");
    }

    if (post.authorid !== req.user.userid) {
        return res.redirect("/");
    }

    res.render("edit-post", { post: post });
});

app.post("/edit-post/:id", mustBeLoggedIn, (req, res) => {
    const statement = db.prepare("SELECT * FROM posts WHERE id = ?");
    const post = statement.get(req.params.id);

    if (!post){
        return res.redirect("/");
    }

    if (post.authorid !== req.user.userid) {
        return res.redirect("/");
    }

    const errors = sharedPostValidation(req)

    if (errors.length){
        return res.render("edit-post", {errors})
    }

    const updateStatement = db.prepare("UPDATE posts SET title = ?, body = ? WHERE id = ?")
    updateStatement.run(req.body.title, req.body.body, req.params.id)

    res.redirect(`/post/${req.params.id}`)
})

app.post("/delete-post/:id", mustBeLoggedIn, (req, res) => {
    const statement = db.prepare("SELECT * FROM posts WHERE id = ?");
    const post = statement.get(req.params.id);

    if (!post){
        return res.redirect("/");
    }

    if (post.authorid !== req.user.userid) {
        return res.redirect("/");
    }
    
    const deleteStatement = db.prepare("DELETE FROM posts WHERE id = ?")
    deleteStatement.run(req.params.id)

    res.redirect("/dashboard")
})

app.get("/post/:id", (req, res) => {
    const statement = db.prepare("SELECT posts.*, users.username FROM posts INNER JOIN users ON posts.authorid = users.id WHERE posts.id = ?");
    const post = statement.get(req.params.id);

    if (!post) {
        return res.redirect("/");
    }

    const isAuthor = post.authorid === req.user.userid

    res.render("single-post", { post: post, isAuthor });
});

app.post("/create-post", mustBeLoggedIn, (req, res) =>{
    const errors = sharedPostValidation(req)

    if (errors.length) {
        return res.render("create-post", {errors})
    }

    // salvar no banco de dados
    const ourStatement = db.prepare("INSERT INTO posts (title, body, authorid, createdDate) VALUES (?, ?, ?, ?)")
    const result = ourStatement.run(req.body.title, req.body.body, req.user.userid, new Date().toISOString())

    const getPostStatement = db.prepare("SELECT * FROM posts WHERE ROWID = ?")
    const realPost = getPostStatement.get(result.lastInsertRowid)

    res.redirect(`/post/${realPost.id}`)
})

app.post("/register", (req, res) =>{
    const errors = []

    if (typeof req.body.username !== "string") req.body.username = ""
    if (typeof req.body.password !== "string") req.body.password = ""

    req.body.username = req.body.username.trim()

    if (!req.body.username) errors.push("Você precisa fornecer um nome de Usuário.")
    if (req.body.username && req.body.username.length < 3) errors.push("O nome de usuário precisa ser maior que 3 caracteres.")
    if (req.body.username && req.body.username.length > 12) errors.push("O nome de usuário precisa ser menor que 12 caracteres.")
    if (req.body.username && !req.body.username.match(/^[a-zA-Z0-9]+$/)) errors.push("O nome de usuário não pode conter caracteres especiais.")

    // Verificar se o nome de usuario já existe:
    const usernameStatement = db.prepare("SELECT * FROM users WHERE username = ?")
    const usernameCheck = usernameStatement.get(req.body.username)

    if (usernameCheck) errors.push("O nome de usuário especificado já foi escolhido.")
    
    if (!req.body.password) errors.push("Você precisa fornecer uma senha.")
    if (req.body.password && req.body.password.length < 6) errors.push("A senha precisa ser maior que 6 caracteres.")
    if (req.body.password && req.body.password.length > 70) errors.push("A senha precisa ser menor que 70 caracteres.")

    if (errors.length) {
        return res.render("register", {errors})
    }

    // salvar o novo usuario em uma database
    const salt = bcrypt.genSaltSync(10)
    req.body.password = bcrypt.hashSync(req.body.password, salt)
    const ourStatement = db.prepare("INSERT INTO users (username, password) VALUES (?, ?)")
    const result = ourStatement.run(req.body.username, req.body.password)

    const lookupStatement = db.prepare("SELECT * FROM users WHERE ROWID = ?")
    const ourUser = lookupStatement.get(result.lastInsertRowid)

    // logar o usuario, dando um cookie a ele
    const ourTokenValue = jwt.sign({exp:Math.floor(Date.now()/1000) + 60 * 60 * 24, userid:ourUser.id, username: ourUser.username}, process.env.JWTSECRET)
    res.cookie("login", ourTokenValue, {
        httpOnly: true,
        secure: true,
        sameSite: "strict",
        maxAge: 1000 * 60 * 60 * 24
    })
    res.redirect("/")
})

app.listen(2020)