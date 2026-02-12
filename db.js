const { Pool } = require('pg');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Koneksi Postgres (Gunakan DATABASE_URL dari Railway)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Tetap panggil SQLite lama untuk migrasi data
const dbPath = path.join(__dirname, 'db', 'database.sqlite');
const sqliteDb = new sqlite3.Database(dbPath);

module.exports = {
    query: (text, params) => pool.query(text, params),
    pool,
    sqliteDb
};
