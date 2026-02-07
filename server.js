const express = require('express');
const multer = require('multer');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();
const app = express();
const upload = multer();

// Import Router Koreksi
const koreksiRouter = require('./routes/koreksi');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'views')));

// Halaman Utama
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

// Menghubungkan ke file routes/koreksi.js
app.use('/ai', upload.any(), koreksiRouter);

// Set Port 8080 sesuai permintaan Anda
const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server Jawaban AI Berjalan di Port ${PORT}`);
});
