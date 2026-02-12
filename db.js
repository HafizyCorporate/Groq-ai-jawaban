const { Pool } = require('pg');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt');
require('dotenv').config();

let db;
const isCloud = process.env.DATABASE_URL;

if (isCloud) {
  // ==========================================
  // 1. MODE POSTGRESQL (RAILWAY)
  // ==========================================
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  const convertQuery = (query) => {
    let index = 1;
    return query.replace(/\?/g, () => `$${index++}`);
  };

  db = {
    pool: pool,
    query: (text, params) => pool.query(convertQuery(text), params),
    run: (query, params, callback) => {
      pool.query(convertQuery(query), params, (err, res) => { if (callback) callback(err, res); });
    },
    all: (query, params, callback) => {
      pool.query(convertQuery(query), params, (err, res) => { if (callback) callback(err, res ? res.rows : []); });
    },
    get: (query, params, callback) => {
      pool.query(convertQuery(query), params, (err, res) => { if (callback) callback(err, res ? res.rows[0] : null); });
    }
  };

  // --- INISIALISASI TABEL & KOLOM OTOMATIS ---
  async function initDatabase() {
    try {
      // Buat Tabel Users Dasar
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          username TEXT UNIQUE,
          password TEXT,
          role TEXT DEFAULT 'user'
        );
      `);

      // TAMBAHKAN KOLOM TOKENS JIKA BELUM ADA
      await pool.query(`
        DO $$ 
        BEGIN 
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='tokens') THEN
            ALTER TABLE users ADD COLUMN tokens INTEGER DEFAULT 10;
          END IF;
        END $$;
      `);

      // Buat Tabel History
      await pool.query(`
        CREATE TABLE IF NOT EXISTS history (
          id SERIAL PRIMARY KEY,
          user_id INTEGER,
          soal TEXT,
          jawaban TEXT,
          subject TEXT,
          level TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Pastikan Admin Versacy terdaftar
      const hashedPass = await bcrypt.hash('08556545', 10);
      const adminQuery = `
        INSERT INTO users (username, password, role, tokens) 
        VALUES ('Versacy', $1, 'admin', 9999) 
        ON CONFLICT (username) DO UPDATE SET role = 'admin', tokens = 9999;
      `;
      await pool.query(adminQuery, [hashedPass]);
      
      console.log("✅ JAWABAN AI: Database & Kolom User Berhasil Disiapkan.");
    } catch (err) {
      console.error("❌ JAWABAN AI PostgreSQL Init Error:", err);
    }
  }
  initDatabase();

} else {
  // ==========================================
  // 2. MODE SQLITE (LOKAL)
  // ==========================================
  const dbPath = path.join(__dirname, "database.db");
  const sqliteDb = new sqlite3.Database(dbPath);
  
  db = {
    query: (text, params) => {
      return new Promise((resolve, reject) => {
        sqliteDb.all(text, params, (err, rows) => { if (err) reject(err); else resolve({ rows, rowCount: rows.length }); });
      });
    },
    run: (query, params, callback) => sqliteDb.run(query, params, callback),
    all: (query, params, callback) => sqliteDb.all(query, params, callback),
    get: (query, params, callback) => sqliteDb.get(query, params, callback)
  };

  sqliteDb.serialize(() => {
    sqliteDb.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, 
      username TEXT UNIQUE, 
      password TEXT, 
      role TEXT DEFAULT 'user', 
      tokens INTEGER DEFAULT 10
    )`);
  });
  console.log("✅ JAWABAN AI: Menggunakan Mode Lokal.");
}

module.exports = db;
