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
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // 1 Hari
}));

// --- LOGIKA AUTH (LOGIN & DAFTAR) ---

// Daftar Akun Baru
app.post('/auth/register', async (req, res) => {
    const { username, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    
    db.run("INSERT INTO users (username, password, role) VALUES (?, ?, ?)", 
    [username, hashedPassword, 'user'], (err) => {
        if (err) return res.status(400).json({ error: "Username sudah terpakai!" });
        res.json({ success: true });
    });
});

// Login
app.post('/auth/login', (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT * FROM users WHERE username = ?", [username], async (err, user) => {
        if (err || !user) return res.status(401).json({ error: "User tidak ditemukan!" });
        
        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(401).json({ error: "Password salah!" });

        req.session.user = { id: user.id, username: user.username, role: user.role };
        res.json({ success: true });
    });
});

// Logout
app.get('/auth/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login.html');
});

// Cek Sesi (Middleware Proteksi)
const authWall = (req, res, next) => {
    if (!req.session.user) return res.redirect('/login.html');
    next();
};

// Route Dashboard & AI (Hanya bisa dibuka jika sudah login)
app.get('/dashboard', authWall, (req, res) => {
    res.sendFile(path.join(__dirname, 'views/dashboard.html'));
});
app.use('/ai', authWall, koreksiRoute);

// Statis Folder
app.use(express.static(path.join(__dirname, 'views')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server Te Az Ha berjalan di port ${PORT}`));
