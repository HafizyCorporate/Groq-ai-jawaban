require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const bcrypt = require('bcrypt');
const db = require('./db');
const koreksiRoute = require('./routes/koreksi');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Pengaturan Session
app.use(session({
    secret: 'te-az-ha-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        maxAge: 24 * 60 * 60 * 1000,
        secure: false 
    }
}));

// --- FIX CANNOT GET ---
// Menambahkan route root (/) agar otomatis membuka halaman login
app.get('/', (req, res) => {
    res.redirect('/login.html');
});

// API Login & Set Session
app.post('/auth/login', (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT * FROM users WHERE username = ?", [username], async (err, user) => {
        if (err || !user) return res.status(401).json({ error: "User tidak ditemukan!" });
        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(401).json({ error: "Password salah!" });
        
        req.session.user = { id: user.id, username: user.username, role: user.role };
        res.json({ success: true, user: { username: user.username, role: user.role } });
    });
});

// API Admin All Logs
app.get('/api/admin/all-logs', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).json({ error: "Akses ditolak!" });
    }
    db.all(`SELECT history_koreksi.*, users.username 
            FROM history_koreksi 
            JOIN users ON history_koreksi.user_id = users.id 
            ORDER BY created_at DESC`, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/auth/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login.html');
});

// Route AI dan Static Files
app.use('/ai', koreksiRoute);
app.use(express.static(path.join(__dirname, 'views')));

// PENGATURAN PORT 8080
const PORT = 8080; 
app.listen(PORT, '0.0.0.0', () => {
    console.log(`CekTugas AI Te Az Ha Online di port ${PORT}`);
});
