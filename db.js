const { Pool } = require('pg');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt');
require('dotenv').config();

let db;
const isCloud = process.env.DATABASE_URL;

if (isCloud) {
  // --- MODE POSTGRESQL (RAILWAY / PRODUCTION) ---
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  // Fungsi pembantu untuk konversi ? ke $1, $2 (agar kode server.js tetap konsisten)
  const convertQuery = (query) => {
    let index = 1;
    return query.replace(/\?/g, () => `$${index++}`);
  };

  db = {
    // Digunakan oleh session store di server.js
    pool: pool, 
    query: (text, params) => pool.query(convertQuery(text), params),
    // Method callback untuk mendukung kode lama kamu
    run: (query, params, callback) => {
      pool.query(convertQuery(query), params, (err, res) => { 
        if (callback) callback(err, res); 
      });
    },
    all: (query, params, callback) => {
      pool.query(convertQuery(query), params, (err, res) => { 
        if (callback) callback(err, res ? res.rows : []); 
      });
    },
    get: (query, params, callback) => {
      pool.query(convertQuery(query), params, (err, res) => { 
        if (callback) callback(err, res ? res.rows[0] : null); 
      });
    }
  };

  // Inisialisasi Database Cloud
  async function initPg() {
    try {
      // 1. Tabel Users
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          username TEXT UNIQUE NOT NULL,
          email TEXT UNIQUE,
          password TEXT NOT NULL,
          quota INTEGER DEFAULT 10,
          is_premium BOOLEAN DEFAULT FALSE,
          role TEXT DEFAULT 'user',
          otp TEXT
        )
      `);

      // 2. Tabel History (Selaras dengan kebutuhan Soal AI kamu)
      await pool.query(`
        CREATE TABLE IF NOT EXISTS history (
          id SERIAL PRIMARY KEY,
          user_id INTEGER,
          soal TEXT,
          jawaban TEXT,
          subject TEXT,
          level TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      console.log("✅ PostgreSQL Ready: Tabel & Admin Versacy sedang dicek.");

      // 3. Admin Versacy Otomatis (Gunakan password dari file kamu)
      const adminPass = '08556545';
      const hashedPass = await bcrypt.hash(adminPass, 10);
      
      await pool.query(`
        INSERT INTO users (username, password, role, quota, is_premium) 
        VALUES ('Versacy', $1, 'admin', 999999, true) 
        ON CONFLICT (username) DO UPDATE SET role = 'admin', quota = 999999;
      `, [hashedPass]);

      console.log("⭐ Admin Versacy siap di Cloud.");
    } catch (err) {
      console.error("❌ PG Init Error:", err.message);
    }
  }
  initPg();

} else {
  // --- MODE SQLITE (LOKAL / DEVELOPMENT) ---
  const dbPath = path.join(__dirname, 'database.sqlite');
  const sqliteDb = new sqlite3.Database(dbPath);

  db = {
    // SQLite tidak butuh konversi $1, ia menggunakan ? secara native
    query: (text, params) => {
      return new Promise((resolve, reject) => {
        const cmd = text.trim().toUpperCase();
        if (cmd.startsWith("SELECT")) {
          sqliteDb.all(text, params, (err, rows) => {
            if (err) reject(err);
            else resolve({ rows, rowCount: rows.length });
          });
        } else {
          sqliteDb.run(text, params, function(err) {
            if (err) reject(err);
            else resolve({ rowCount: this.changes, rows: [] });
          });
        }
      });
    },
    run: (query, params, callback) => sqliteDb.run(query, params, callback),
    all: (query, params, callback) => sqliteDb.all(query, params, callback),
    get: (query, params, callback) => sqliteDb.get(query, params, callback)
  };

  sqliteDb.serialize(() => {
    sqliteDb.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE,
      password TEXT NOT NULL,
      quota INTEGER DEFAULT 10,
      is_premium BOOLEAN DEFAULT FALSE,
      role TEXT DEFAULT 'user',
      otp TEXT
    )`);
    
    sqliteDb.run(`CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      soal TEXT,
      jawaban TEXT,
      subject TEXT,
      level TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    console.log("✅ SQLite Ready: Mode Lokal Aktif.");
  });
}

module.exports = db;
