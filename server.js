const express = require('express'); 
const multer = require('multer');
const path = require('path');
const dotenv = require('dotenv');
const bcrypt = require('bcrypt'); 
const session = require('express-session'); 
const SibApiV3Sdk = require('sib-api-v3-sdk'); 

dotenv.config();

// --- IMPORT DB HYBRID ---
const db = require('./db'); 

// --- PEMANGGILAN FILE KOREKSI.JS ---
const { prosesKoreksiLengkap } = require('./routes/koreksi');

const app = express();
const port = process.env.PORT || 8080; 

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Sesuai screenshot, file HTML ada di folder 'views'
app.use(express.static(path.join(__dirname, 'views')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// --- SESSION CONFIGURATION (HYBRID STORE) ---
app.set('trust proxy', 1); 
const sessionConfig = {
    name: 'gemini_session',
    secret: process.env.SESSION_SECRET || 'kunci-rahasia-gemini-vision',
    resave: false, 
    saveUninitialized: false,
    cookie: { 
        maxAge: 24 * 60 * 60 * 1000,
        secure: process.env.NODE_ENV === 'production', 
        sameSite: 'lax'
    }
};

if (process.env.DATABASE_URL) {
    const pgSession = require('connect-pg-simple')(session);
    sessionConfig.store = new pgSession({
        pool : db.pool, 
        tableName : 'session',
        createTableIfMissing: true
    });
}
app.use(session(sessionConfig));

const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage, 
    limits: { fileSize: 25 * 1024 * 1024 } 
});

// ==========================================
// 1. RUTE NAVIGASI (FIX CANNOT GET /)
// ==========================================

app.get('/', (req, res) => {
    // Jika sudah login (ada userId), lempar ke dashboard
    if (req.session.userId) return res.redirect('/dashboard');
    res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'register.html'));
});

app.get('/dashboard', (req, res) => {
    // Lindungi rute: jika belum login, kembalikan ke login
    if (!req.session.userId) return res.redirect('/');
    res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

// ==========================================
// 2. AUTH ROUTES
// ==========================================

app.post('/auth/register', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ success: false, message: "Data tidak lengkap" });
        
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Simpan ke kolom username sesuai db.js
        await db.query(
            "INSERT INTO users (username, password, tokens, role) VALUES (?, ?, ?, ?)",
            [email, hashedPassword, 10, 'user']
        );

        res.json({ success: true, message: "Pendaftaran Berhasil!" });
    } catch (e) { 
        console.error("Register Error:", e);
        res.status(500).json({ success: false, message: "Email sudah terdaftar." }); 
    }
});

app.post('/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await db.get("SELECT * FROM users WHERE username = ?", [email]);
        
        if (user && await bcrypt.compare(password, user.password)) {
            // Set session agar navigasi / berfungsi
            req.session.userId = user.id; 
            req.session.username = user.username;
            req.session.role = user.role;

            req.session.save(() => {
                res.json({ 
                    success: true, 
                    quota: user.role === 'admin' ? 9999 : (user.tokens || 0),
                    role: user.role 
                });
            });
        } else {
            res.status(401).json({ success: false, message: "Email atau Password Salah!" });
        }
    } catch (e) { 
        console.error("Login Error:", e);
        res.status(500).json({ success: false }); 
    }
});

// ==========================================
// 3. CORE AI ROUTE
// ==========================================

app.post('/ai/proses-koreksi', upload.array('foto'), async (req, res) => {
    try {
        if (!req.session.userId) return res.status(401).json({ success: false, message: "Login dahulu!" });
        
        const user = await db.get("SELECT * FROM users WHERE id = ?", [req.session.userId]);

        // Cek token (menggunakan nama kolom 'tokens' sesuai db.js terbaru kamu)
        if (user.role !== 'admin' && (user.tokens || 0) < req.files.length) {
            return res.json({ success: false, limitReached: true, message: "TOKEN HABIS" });
        }

        const results = await prosesKoreksiLengkap(req.files, req.body.data, req.body.rumus_pg, req.body.rumus_es);

        if (results && results.length > 0) {
            // Potong Token jika bukan admin
            if (user.role !== 'admin') {
                await db.query("UPDATE users SET tokens = tokens - ? WHERE id = ?", [req.files.length, user.id]);
            }

            // Simpan ke tabel history
            for (const item of results) {
                await db.query(
                    "INSERT INTO history (user_id, soal, jawaban, subject, level) VALUES (?, ?, ?, ?, ?)",
                    [user.id, item.soal || '', JSON.stringify(item), req.body.subject || 'Umum', req.body.level || '-']
                );
            }
        }

        res.json({ success: true, data: results });
    } catch (err) {
        console.error("AI Error:", err);
        res.status(500).json({ success: false });
    }
});

app.listen(port, "0.0.0.0", () => console.log(`🚀 Server Berjalan di Port ${port}`));
