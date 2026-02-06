const express = require('express');
const multer = require('multer');
const path = require('path');

const app = express();

// Konfigurasi Multer (Memory)
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Middleware Dasar
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Folder Views & Public
app.use(express.static(path.join(__dirname, 'views')));
app.use(express.static(path.join(__dirname, 'public')));

// IMPORT ROUTER DARI FOLDER routes/
const koreksiRoute = require('./routes/koreksi');

// PASANG ROUTER (Pastikan upload.array ada di sini)
app.use('/ai', upload.array('foto_tugas'), koreksiRoute);

// Route Dashboard
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

// Port 8080 khusus Railway
const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Maverick Server Active on Port ${PORT}`);
});
