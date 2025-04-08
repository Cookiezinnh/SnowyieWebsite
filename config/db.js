const db = require("better-sqlite3")("Snowyie.db");
db.pragma("journal_mode = WAL");

const createTables = db.transaction(() => {
    db.prepare(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username STRING NOT NULL UNIQUE,
            password STRING NOT NULL,
            email STRING UNIQUE,
            display_name STRING,
            avatar STRING DEFAULT '/static/images/default/default_user_pfp_256x.png',
            banner STRING DEFAULT '/static/images/default/default_banner.png',
            bio TEXT,
            role STRING DEFAULT 'user',
            createdDate TEXT DEFAULT CURRENT_TIMESTAMP
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

    db.prepare(`
        CREATE TABLE IF NOT EXISTS contents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            createdDate TEXT,
            name STRING NOT NULL,
            description TEXT,
            banner TEXT,
            photo TEXT,
            file_path TEXT NOT NULL,
            external_link TEXT,
            type STRING NOT NULL,
            category STRING NOT NULL,
            authorid INTEGER,
            views INTEGER DEFAULT 0,
            downloads INTEGER DEFAULT 0,
            carousel TEXT,
            tags TEXT,
            FOREIGN KEY (authorid) REFERENCES users (id)
        )
    `).run();

    // Tabela para franquias
    db.prepare(`
        CREATE TABLE IF NOT EXISTS franchises (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name STRING NOT NULL UNIQUE,
            image STRING DEFAULT '/static/images/default/default_game_banner.png',
            description TEXT,
            createdDate TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `).run();

    // Tabela para jogos
    db.prepare(`
        CREATE TABLE IF NOT EXISTS games (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name STRING NOT NULL UNIQUE,
            franchise_id INTEGER,
            image STRING DEFAULT '/static/images/default/default_game_banner.png',
            description TEXT,
            createdDate TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (franchise_id) REFERENCES franchises (id)
        )
    `).run();
});

createTables();

module.exports = db;