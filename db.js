const { Pool } = require('pg');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// 1. KONEKSI POSTGRESQL (Utama)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// 2. SETUP SQLITE (Hanya untuk ambil data lama)
const dbDir = path.join(__dirname, 'db');
const dbPath = path.join(dbDir, 'database.sqlite');

// Pastikan folder 'db' ada agar SQLite tidak error saat mencoba membuka file
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

// Buka koneksi SQLite hanya jika filenya ada
let sqliteDb = null;
if (fs.existsSync(dbPath)) {
    sqliteDb = new sqlite3.Database(dbPath, (err) => {
        if (err) console.log("ℹ️ SQLite lama tidak ditemukan/tidak bisa dibuka, melewati...");
        else console.log("📂 Terhubung ke SQLite lama untuk migrasi.");
    });
}

module.exports = {
    query: (text, params) => pool.query(text, params),
    pool,
    sqliteDb // Jika null, berarti data lama sudah tidak ada/tidak perlu dimigrasi
};
