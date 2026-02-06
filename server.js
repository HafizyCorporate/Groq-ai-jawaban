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
app.use(session({
    secret: 'te-az-ha-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// API Login
app.post('/auth/login', (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT * FROM users WHERE username = ?", [username], async (err, user) => {
        if (err || !user) return res.status(401).json({ error: "User tidak ditemukan!" });
        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(401).json({ error: "Password salah!" });
        
        // Simpan Role ke Session
        req.session.user = { id: user.id, username: user.username, role: user.role };
        res.json({ success: true, role: user.role });
    });
});

// API Khusus Admin: Melihat Semua Aktivitas User
app.get('/api/admin/all-logs', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).json({ error: "Akses ditolak!" });
    }
    db.all(`SELECT history_koreksi.*, users.username 
            FROM history_koreksi 
            JOIN users ON history_koreksi.user_id = users.id 
            ORDER BY created_at DESC`, (err, rows) => {
        res.json(rows);
    });
});

app.get('/auth/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login.html');
});

app.use('/ai', koreksiRoute);
app.use(express.static(path.join(__dirname, 'views')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server Admin Active on port ${PORT}`));
