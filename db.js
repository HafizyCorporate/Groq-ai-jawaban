const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

/**
 * DATABASE CONFIGURATION - TE AZ HA
 * File ini mengelola koneksi SQLite dan pembuatan tabel otomatis.
 */

// 1. Memastikan folder 'db' tersedia (Penting untuk deploy di Railway)
const dbDir = path.join(__dirname, 'db');
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir);
}

// 2. Inisialisasi Koneksi Database
const dbPath = path.join(dbDir, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error("Gagal menyambung ke Database SQLite:", err.message);
    } else {
        console.log("Koneksi Database SQLite Berhasil.");
    }
});

// 3. Pembuatan Tabel Secara Sinkron
db.serialize(() => {
    /**
     * Tabel history_koreksi:
     * Menyimpan data user, kunci jawaban yang diinput pembuat, 
     * serta hasil analisis cerdas dari Llama-4 Scout.
     */
    db.run(`CREATE TABLE IF NOT EXISTS history_koreksi (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        kunci_pg TEXT,
        kriteria_essay TEXT,
        hasil_koreksi TEXT,
        skor_total INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
        if (err) {
            console.error("Gagal membuat tabel history_koreksi:", err.message);
        } else {
            console.log("Tabel history_koreksi siap digunakan.");
        }
    });

    /**
     * Tabel history (Untuk backup/log umum jika diperlukan)
     */
    db.run(`CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        soal TEXT,
        jawaban TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// 4. Export database agar bisa dipanggil di routes/koreksi.js dan server.js
module.exports = db;
