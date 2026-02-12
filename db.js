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

  // Bungkus pool agar kompatibel dengan pemanggilan di server.js
  db = {
    query: (text, params) => pool.query(text, params),
    // Method tambahan agar konsisten
    get: async (text, params) => {
      const res = await pool.query(text, params);
      return res.rows[0];
    },
    all: async (text, params) => {
      const res = await pool.query(text, params);
      return res.rows;
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
          password TEXT NOT NULL,
          quota INTEGER DEFAULT 10,
          is_premium BOOLEAN DEFAULT FALSE,
          role TEXT DEFAULT 'user',
          otp TEXT
        )
      `);

      // 2. Tabel History Koreksi (JSONB)
      await pool.query(`
        CREATE TABLE IF NOT EXISTS history_koreksi (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          kunci_pg JSONB,
          kriteria_essay JSONB,
          hasil_koreksi JSONB,
          skor_total NUMERIC,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      console.log("✅ PostgreSQL Ready: Tabel & History berhasil diselaraskan.");

      // 3. Admin Otomatis dari ENV (Opsional)
      const adminUser = process.env.ADMIN_USERNAME;
      const adminPass = process.env.ADMIN_PASSWORD;

      if (adminUser && adminPass) {
        const checkAdmin = await pool.query("SELECT id FROM users WHERE username = $1", [adminUser]);
        if (checkAdmin.rowCount === 0) {
          const hashedPass = await bcrypt.hash(adminPass, 10);
          await pool.query(
            "INSERT INTO users (username, password, role, quota, is_premium) VALUES ($1, $2, 'admin', 999999, true)",
            [adminUser, hashedPass]
          );
          console.log(`⭐ Akun Admin [${adminUser}] disiapkan.`);
        }
      }
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
    get: (text, params) => new Promise((resolve, reject) => {
      sqliteDb.get(text, params, (err, row) => err ? reject(err) : resolve(row));
    })
  };

  sqliteDb.serialize(() => {
    sqliteDb.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      quota INTEGER DEFAULT 10,
      is_premium BOOLEAN DEFAULT FALSE,
      role TEXT DEFAULT 'user',
      otp TEXT
    )`);
    
    sqliteDb.run(`CREATE TABLE IF NOT EXISTS history_koreksi (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      kunci_pg TEXT,
      kriteria_essay TEXT,
      hasil_koreksi TEXT,
      skor_total REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    console.log("✅ SQLite Ready: Mode Lokal Aktif.");
  });
}

module.exports = db;
