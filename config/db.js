const db = require("better-sqlite3")("Snowyie.db");
db.pragma("journal_mode = WAL");

const createTables = db.transaction(() => {
    db.prepare(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username STRING NOT NULL UNIQUE,
            password STRING NOT NULL,
            role STRING DEFAULT 'user'
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

module.exports = db;