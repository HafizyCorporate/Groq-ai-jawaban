const express = require('express');
const multer = require('multer');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();
const app = express();
const upload = multer();

// Import file router koreksi (File yang kamu kirim tadi)
const koreksiRouter = require('./routes/koreksi');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Membaca folder views untuk tampilan HTML
app.use(express.static(path.join(__dirname, 'views')));

// Arahkan halaman utama ke dashboard.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

// Jalankan sistem koreksi
app.use('/ai', upload.any(), koreksiRouter);

// Port sesuai permintaan kamu: 8080
const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server nyala di port ${PORT}`);
});
