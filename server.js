require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const bcrypt = require('bcrypt');
const db = require('./db');
const koreksiRoute = require('./routes/koreksi');
const SQLiteStore = require('connect-sqlite3')(session);

const app = express();

// Middleware wajib agar server bisa baca data dari form HTML
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    store: new SQLiteStore({ db: 'sessions.sqlite', dir: './db' }),
    secret: 'te-az-ha-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// Route Utama
app.get('/', (req, res) => res.redirect('/login.html'));

// API REGISTER (PASTIKAN INI ADA)
app.post('/auth/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Data tidak lengkap" });

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        db.run("INSERT INTO users (username, password) VALUES (?, ?)", [username, hashedPassword], function(err) {
            if (err) {
                console.error("DB Register Error:", err.message);
                return res.status(400).json({ error: "Username sudah digunakan atau masalah database." });
            }
            res.json({ success: true });
        });
    } catch (err) {
        console.error("Server Register Error:", err);
        res.status(500).json({ error: "Terjadi kesalahan pada sistem server." });
    }
});

// API LOGIN
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

app.get('/auth/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login.html');
});

// Koneksi ke route AI dan file statis
app.use('/ai', koreksiRoute);
app.use(express.static(path.join(__dirname, 'views')));

// PORT 8080 sesuai permintaan
const PORT = 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`Running on port ${PORT}`));
