const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');

// Gunakan /tmp atau folder lokal yang diizinkan Railway
const dbDir = path.join(__dirname, 'db');
const uploadDir = path.join(__dirname, 'uploads');

[dbDir, uploadDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`Folder created: ${dir}`);
    }
});

const dbPath = path.join(dbDir, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error("Database error: ", err.message);
    else console.log("Connected to SQLite database.");
});

db.serialize(async () => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        role TEXT DEFAULT 'user'
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS history_koreksi (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        kunci_pg TEXT,
        kriteria_essay TEXT,
        hasil_koreksi TEXT,
        skor_total INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Akun Admin Versacy
    const adminUser = 'Versacy';
    const adminPass = '08556545';
    const hashedAdminPass = await bcrypt.hash(adminPass, 10);
    db.run("INSERT OR IGNORE INTO users (username, password, role) VALUES (?, ?, ?)", 
    [adminUser, hashedAdminPass, 'admin']);
});

module.exports = db;
