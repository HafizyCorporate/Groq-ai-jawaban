const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');

const dbDir = path.join(__dirname, 'db');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir);

const db = new sqlite3.Database(path.join(dbDir, 'database.sqlite'));

db.serialize(async () => {
    // 1. Tabel User
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        role TEXT DEFAULT 'user'
    )`);

    // 2. Tabel History Koreksi
    db.run(`CREATE TABLE IF NOT EXISTS history_koreksi (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        kunci_pg TEXT,
        kriteria_essay TEXT,
        hasil_koreksi TEXT,
        skor_total INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 3. Menambahkan Admin Versacy secara otomatis
    const adminUser = 'Versacy';
    const adminPass = '08556545';
    const hashedAdminPass = await bcrypt.hash(adminPass, 10);

    db.get("SELECT * FROM users WHERE username = ?", [adminUser], (err, row) => {
        if (!row) {
            db.run("INSERT INTO users (username, password, role) VALUES (?, ?, ?)", 
            [adminUser, hashedAdminPass, 'admin'], (err) => {
                if (!err) console.log("Admin Versacy berhasil didaftarkan otomatis.");
            });
        }
    });
});

module.exports = db;
