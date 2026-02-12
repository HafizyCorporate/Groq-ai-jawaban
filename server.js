const express = require('express'); 
const multer = require('multer');
const path = require('path');
const dotenv = require('dotenv');
const bcrypt = require('bcrypt'); 
const session = require('express-session'); 
const SibApiV3Sdk = require('sib-api-v3-sdk');
const { query } = require('./db'); // Pastikan db.js sudah benar
const fs = require('fs');

dotenv.config();
const app = express();
const port = process.env.PORT || 8080; 

// --- MIDDLEWARE ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public')); 
app.use(session({
    secret: 'jawaban-ai-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } 
}));

// --- 1. ROUTING HALAMAN (FOLDER VIEWS) ---

// Cek Sesi: Jika buka '/' tapi sudah login, lari ke dashboard. Jika belum, ke login.
app.get('/', (req, res) => {
    if (req.session.userId) return res.redirect('/dashboard');
    res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

// Proteksi Dashboard: Tidak bisa dibuka kalau belum login
app.get('/dashboard', (req, res) => {
    if (!req.session.userId) return res.redirect('/');
    res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});


// --- 2. API AUTHENTICATION ---

app.post('/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await query('SELECT * FROM users WHERE email = $1', [email]);
        if (result.rows.length > 0) {
            const user = result.rows[0];
            if (await bcrypt.compare(password, user.password)) {
                req.session.userId = user.email; // Simpan sesi
                return res.json({ 
                    success: true, 
                    token: user.quota, 
                    is_premium: user.is_premium 
                });
            }
        }
        res.status(401).json({ success: false, message: "Email/Password Salah" });
    } catch (e) { res.status(500).json({ success: false }); }
});

// Logout: Hapus sesi dan balik ke login
app.get('/auth/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});


// --- 3. FITUR TOKEN & SAWERIA (ADMIN) ---

// Ini adalah endpoint yang dipanggil dari Dashboard Admin untuk konfirmasi Saweria
app.post('/admin/add-token', async (req, res) => {
    const { adminEmail, targetEmail, amount } = req.body;
    
    // Keamanan sederhana: Hanya admin "Versacy" yang bisa tambah token
    if (adminEmail !== 'Versacy') {
        return res.status(403).json({ success: false, message: "Bukan Admin!" });
    }

    try {
        await query('UPDATE users SET quota = quota + $1 WHERE email = $2', [parseInt(amount), targetEmail]);
        res.json({ success: true, message: `Berhasil tambah ${amount} token ke ${targetEmail}` });
    } catch (e) {
        res.status(500).json({ success: false, message: "Gagal update database" });
    }
});


// --- 4. PROSES KOREKSI AI (PENGURANGAN TOKEN) ---
const upload = multer({ storage: multer.memoryStorage() });
const { prosesKoreksiLengkap } = require('./koreksi');

app.post('/ai/proses-koreksi', upload.array('foto'), async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ success: false, message: "Sesi Habis" });
    
    const userRes = await query('SELECT * FROM users WHERE email = $1', [req.session.userId]);
    const user = userRes.rows[0];

    // Cek Token
    if (!user.is_premium && user.quota < req.files.length) {
        return res.json({ success: false, limitReached: true, message: "Token Habis" });
    }

    let settings = {};
    try { settings = JSON.parse(req.body.data); } catch (e) { settings = {}; }

    // Jalankan AI
    const results = await prosesKoreksiLengkap(req.files, settings);

    // Potong Token jika bukan premium
    if (!user.is_premium && results.length > 0) {
        await query('UPDATE users SET quota = GREATEST(0, quota - $1) WHERE email = $2', [req.files.length, req.session.userId]);
    }

    const finalUser = await query('SELECT quota, is_premium FROM users WHERE email = $1', [req.session.userId]);
    res.json({ 
        success: true, 
        data: results, 
        current_token: finalUser.rows[0].is_premium ? 'UNLIMITED' : finalUser.rows[0].quota 
    });
});

app.listen(port, () => console.log(`Server jalan di port ${port}`));
