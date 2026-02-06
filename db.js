const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');

// Pastikan folder 'db' ada dengan izin akses penuh
const dbDir = path.join(__dirname, 'db');
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true, mode: 0o777 });
}

// Pastikan folder 'uploads' juga dibuat secara otomatis
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true, mode: 0o777 });
}

const dbPath = path.join(dbDir, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

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

    const adminUser = 'Versacy';
    const adminPass = '08556545';
    const hashedAdminPass = await bcrypt.hash(adminPass, 10);

    db.get("SELECT * FROM users WHERE username = ?", [adminUser], (err, row) => {
        if (!row) {
            db.run("INSERT INTO users (username, password, role) VALUES (?, ?, ?)", 
            [adminUser, hashedAdminPass, 'admin']);
        }
    });
});

module.exports = db;
