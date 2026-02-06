require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const bcrypt = require('bcrypt');
const db = require('./db');
const koreksiRoute = require('./routes/koreksi');

// Tambahkan Store untuk Session
const SQLiteStore = require('connect-sqlite3')(session);

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Pengaturan Session menggunakan SQLite (Agar tidak leak memory)
app.use(session({
    store: new SQLiteStore({
        db: 'database.sqlite', 
        dir: './db'
    }),
    secret: 'te-az-ha-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        maxAge: 24 * 60 * 60 * 1000, // 1 Hari
        secure: false 
    }
}));

// Route Root
app.get('/', (req, res) => {
    res.redirect('/login.html');
});

// API Login
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

// API Register
app.post('/auth/register', async (req, res) => {
    const { username, password } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        db.run("INSERT INTO users (username, password) VALUES (?, ?)", [username, hashedPassword], (err) => {
            if (err) return res.status(400).json({ error: "Username sudah ada!" });
            res.json({ success: true });
        });
    } catch (err) {
        res.status(500).json({ error: "Gagal mendaftar" });
    }
});

// Route lainnya tetap sama
app.use('/ai', koreksiRoute);
app.use(express.static(path.join(__dirname, 'views')));

const PORT = 8080; 
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server Te Az Ha Online di port ${PORT}`);
});
