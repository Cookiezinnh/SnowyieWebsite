const jwt = require("jsonwebtoken");
const db = require("../config/db");

function authMiddleware(req, res, next) {
    try {
        const decoded = jwt.verify(req.cookies.login, process.env.JWTSECRET);
        const userStatement = db.prepare("SELECT id, username, role FROM users WHERE id = ?");
        const user = userStatement.get(decoded.userid);
        req.user = user || null; // Define como null se não houver usuário
    } catch (err) {
        req.user = null; // Define como null se o token for inválido
    }

    res.locals.user = req.user;
    next();
}

function mustBeAdmin(req, res, next) {
    if (req.user && req.user.role === 'admin') {
        return next();
    }
    return res.redirect("/");
}

module.exports = { authMiddleware, mustBeAdmin };