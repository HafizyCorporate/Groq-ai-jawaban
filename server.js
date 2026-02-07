const express = require('express');
const multer = require('multer');
const path = require('path');
const dotenv = require('dotenv');

// Memuat variabel lingkungan dari file .env
dotenv.config();

const app = express();
const upload = multer();

// Import file router koreksi yang sudah kita buat sebelumnya
const koreksiRouter = require('./routes/koreksi');

// Middleware untuk memproses JSON dan form-data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Melayani file statis dari folder 'views' (untuk dashboard.html)
app.use(express.static(path.join(__dirname, 'views')));

// Route utama untuk menampilkan dashboard
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

// Menghubungkan endpoint /ai ke router koreksi
// Menggunakan upload.any() agar bisa menerima hingga 5 foto sekaligus
app.use('/ai', upload.any(), koreksiRouter);

// Konfigurasi Port 8080 sesuai permintaan Anda
// Railway akan memberikan port otomatis lewat process.env.PORT, jika tidak ada pakai 8080
const PORT = process.env.PORT || 8080;

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Mesin Jawaban AI berjalan lancar di port ${PORT}`);
});
