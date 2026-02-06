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

// Cek jumlah penggunaan untuk limit gratis
app.get('/api/cek-limit', (req, res) => {
    if (!req.session.user) return res.json({ limit: 0 });
    db.get("SELECT COUNT(*) as total FROM history_koreksi WHERE user_id = ?", [req.session.user.id], (err, row) => {
        res.json({ total: row.total });
    });
});

app.post('/auth/register', async (req, res) => {
    const { username, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    db.run("INSERT INTO users (username, password) VALUES (?, ?)", [username, hashedPassword], (err) => {
        if (err) return res.status(400).json({ error: "Username terpakai!" });
        res.json({ success: true });
    });
});

app.post('/auth/login', (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT * FROM users WHERE username = ?", [username], async (err, user) => {
        if (err || !user) return res.status(401).json({ error: "User tidak ditemukan!" });
        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(401).json({ error: "Password salah!" });
        req.session.user = { id: user.id, username: user.username };
        res.json({ success: true });
    });
});

app.get('/auth/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login.html');
});

app.use('/ai', koreksiRoute);
app.use(express.static(path.join(__dirname, 'views')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server Te Az Ha Online di port ${PORT}`));
