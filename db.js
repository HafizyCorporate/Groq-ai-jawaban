const { Pool } = require('pg');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Koneksi ke PostgreSQL Railway
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Tetap akses SQLite lama untuk ambil data riwayat jika perlu
const dbPath = path.join(__dirname, 'db', 'database.sqlite');
const sqliteDb = new sqlite3.Database(dbPath);

module.exports = {
    query: (text, params) => pool.query(text, params),
    pool,
    sqliteDb
};
