const express = require('express');
const multer = require('multer');
const path = require('path');

const app = express();

// 1. Import Controller
// Pastikan letak file ada di: controllers/koreksi.js
const koreksiController = require('./controllers/koreksi');

// 2. Setup Multer (Memory Storage)
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 15 * 1024 * 1024 } // Limit 15MB
});

// 3. Middleware Dasar
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Sajikan file statis dari folder 'public' atau 'views'
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'views')));

// Rute Dashboard Utama
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

/**
 * 4. ROUTE PROSES (Sesuai instruksi koreksi)
 */
app.post('/ai/proses-koreksi', upload.array('foto_tugas'), (req, res) => {
    try {
        koreksiController.prosesKoreksi(req, res);
    } catch (err) {
        console.error("Route Error:", err);
        res.status(500).json({ success: false, message: "Terjadi kesalahan pada server." });
    }
});

/**
 * 5. KONFIGURASI PORT (Railway Friendly)
 * Menggunakan 8080 sebagai default jika process.env.PORT kosong
 */
const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`
    =========================================
    ✅ SERVER MAVERICK BERHASIL JALAN
    🌐 URL: http://localhost:${PORT}
    📡 Port Production: ${PORT}
    =========================================
    `);
});
