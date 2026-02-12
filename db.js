const { Pool } = require('pg');
const bcrypt = require('bcrypt');
require('dotenv').config();

/**
 * KONFIGURASI POSTGRESQL
 * Menggunakan koneksi Pool agar lebih cepat dan efisien
 */
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false // Wajib aktif untuk layanan cloud seperti Railway
    }
});

/**
 * FUNGSI INISIALISASI DATABASE
 * Membuat tabel dan akun admin secara otomatis saat aplikasi dijalankan
 */
const initDb = async () => {
    try {
        // 1. Buat Tabel Users
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                quota INTEGER DEFAULT 10,
                is_premium BOOLEAN DEFAULT FALSE,
                role TEXT DEFAULT 'user'
            );
        `);

        // 2. Buat Tabel History Koreksi (Menggunakan JSONB agar performa Postgres maksimal)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS history_koreksi (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                kunci_pg JSONB,
                kriteria_essay JSONB,
                hasil_koreksi JSONB,
                skor_total NUMERIC,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        console.log("✅ Database PostgreSQL & Tabel Berhasil Disiapkan.");

        // 3. BUAT AKUN ADMIN DARI VARIABEL LINGKUNGAN (ENVIRONMENT VARIABLES)
        const adminUser = process.env.ADMIN_USERNAME;
        const adminPass = process.env.ADMIN_PASSWORD;

        if (adminUser && adminPass) {
            const checkAdmin = await pool.query("SELECT id FROM users WHERE username = $1", [adminUser]);
            
            if (checkAdmin.rowCount === 0) {
                const hashedAdminPass = await bcrypt.hash(adminPass, 10);
                await pool.query(
                    "INSERT INTO users (username, password, role, quota, is_premium) VALUES ($1, $2, $3, $4, $5)",
                    [adminUser, hashedAdminPass, 'admin', 999999, true]
                );
                console.log(`⭐ Akun Admin [${adminUser}] telah didaftarkan ke Database.`);
            }
        } else {
            console.log("ℹ️ Info: ADMIN_USERNAME/PASSWORD tidak ditemukan di Environment Variables. Melewati pembuatan admin.");
        }

    } catch (err) {
        console.error("❌ Gagal Inisialisasi Database:", err.message);
    }
};

// Jalankan fungsi saat script dipanggil
initDb();

module.exports = pool;
