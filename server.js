require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const bcrypt = require('bcrypt');
const db = require('./db');
const koreksiRoute = require('./routes/koreksi');
const SQLiteStore = require('connect-sqlite3')(session);

const app = express();

// Middleware agar server bisa membaca data dari form
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Pengaturan Session menggunakan database agar tidak "Memory Leak"
app.use(session({
    store: new SQLiteStore({ 
        db: 'sessions.sqlite', 
        dir: './db' 
    }),
    secret: 'te-az-ha-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// --- ROUTING HALAMAN UTAMA ---

// Mengarahkan link utama langsung ke Login
app.get('/', (req, res) => {
    res.redirect('/login.html');
});

// FIX CANNOT GET DASHBOARD: Mengarahkan /dashboard ke file dashboard.html
app.get('/dashboard', (req, res) => {
    if (!req.session.user) return res.redirect('/login.html');
    res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

// --- API AUTHENTICATION ---

// API Registrasi User Baru
app.post('/auth/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Isi semua data!" });

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        db.run("INSERT INTO users (username, password) VALUES (?, ?)", [username, hashedPassword], function(err) {
            if (err) {
                return res.status(400).json({ error: "Username sudah dipakai!" });
            }
            res.json({ success: true });
        });
    } catch (err) {
        res.status(500).json({ error: "Kesalahan sistem saat mendaftar." });
    }
});

// API Login
app.post('/auth/login', (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT * FROM users WHERE username = ?", [username], async (err, user) => {
        if (err || !user) return res.status(401).json({ error: "User tidak ditemukan!" });
        
        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(401).json({ error: "Password salah!" });
        
        // Simpan data ke session
        req.session.user = { id: user.id, username: user.username, role: user.role };
        res.json({ 
            success: true, 
            user: { username: user.username, role: user.role } 
        });
    });
});

// API Log untuk Admin Versacy
app.get('/api/admin/all-logs', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).json({ error: "Akses ditolak!" });
    }
    db.all(`SELECT history_koreksi.*, users.username 
            FROM history_koreksi 
            JOIN users ON history_koreksi.user_id = users.id 
            ORDER BY created_at DESC`, (err, rows) => {
        if (err) return res.status(500).json({ error: "Gagal mengambil data." });
        res.json(rows);
    });
});

app.get('/auth/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login.html');
});

// Menghubungkan ke Route AI dan folder Views
app.use('/ai', koreksiRoute);
app.use(express.static(path.join(__dirname, 'views')));

// Menjalankan server di Port 8080
const PORT = 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`=== SERVER TE AZ HA AKTIF ===`);
    console.log(`Link: http://0.0.0.0:${PORT}`);
});
