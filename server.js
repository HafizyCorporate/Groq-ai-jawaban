const express = require('express');
const multer = require('multer');
const path = require('path');
const dotenv = require('dotenv');

// 1. Load variabel lingkungan dari file .env (Isinya API KEY Groq)
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// 2. Middleware Dasar
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Mengatur folder 'public' untuk file statis seperti CSS atau JS tambahan
app.use(express.static(path.join(__dirname, 'public')));

// 3. Konfigurasi Multer (Penyimpanan Foto sementara di RAM)
// Kita gunakan .array('foto') karena user bisa upload banyak file sekaligus
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 } // Limit 10MB per foto
});

// 4. Import Route Koreksi
// Pastikan kamu punya file di: routes/koreksi.js
const koreksiRoute = require('./routes/koreksi');

// 5. Daftarkan Route dengan Prefix /ai
// Middleware upload diletakkan di sini agar req.files terbaca di routes/koreksi.js
app.use('/ai', upload.array('foto'), koreksiRoute);

// 6. Route Navigasi Utama
// Mengarahkan halaman awal langsung ke tampilan dashboard
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

// 7. Error Handling sederhana
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Terjadi kesalahan pada server!');
});

// 8. Menjalankan Server
app.listen(port, () => {
    console.log('==============================================');
    console.log(`🚀 JAWABAN AI SERVER AKTIF!`);
    console.log(`🌐 Akses di: http://localhost:${port}`);
    console.log('==============================================');
});
