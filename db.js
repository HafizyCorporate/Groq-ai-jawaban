const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false // Wajib false untuk Railway/Heroku/Supabase
    },
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

// Cek koneksi saat awal start
pool.connect((err, client, release) => {
    if (err) {
        console.error('❌ Error fatal koneksi Database:', err.message);
    } else {
        console.log('✅ Terhubung ke Database PostgreSQL');
        release();
    }
});

module.exports = {
    query: (text, params) => pool.query(text, params),
    pool
};
