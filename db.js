const { Pool } = require('pg');
require('dotenv').config(); // Memastikan env terbaca

// 1. KONEKSI POSTGRESQL (Utama)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { 
        rejectUnauthorized: false // Wajib untuk hosting Cloud (Supabase/Neon/Render/Heroku)
    },
    // Pengamanan Koneksi (Penting agar server tidak hang)
    max: 20,               // Maksimal user konek bersamaan
    idleTimeoutMillis: 30000, // Putus koneksi jika nganggur 30 detik
    connectionTimeoutMillis: 2000, // Batas waktu tunggu
});

// Log error jika database putus tiba-tiba
pool.on('error', (err) => {
    console.error('❌ Database Error (Unexpected):', err);
});

module.exports = {
    query: (text, params) => pool.query(text, params),
    pool
};
