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

// Folder 'views' sebagai tempat HTML dan aset statis agar tampilan TIDAK BERUBAH
app.use(express.static(path.join(__dirname, 'views')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// --- SESSION CONFIGURATION ---
app.set('trust proxy', 1);
const sessionConfig = {
    name: 'jawaban_ai_session',
    secret: process.env.SESSION_SECRET || 'kunci-rahasia-jawaban-ai',
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
// 1. RUTE NAVIGASI (Sesuai Struktur Views Kamu)
// ==========================================

app.get('/', (req, res) => {
    if (req.session.userId) return res.redirect('/dashboard');
    res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

// Tambahkan rute eksplisit agar link di HTML tidak error
app.get('/login.html', (req, res) => res.redirect('/'));
app.get('/register.html', (req, res) => res.sendFile(path.join(__dirname, 'views', 'register.html')));

app.get('/dashboard', (req, res) => {
    if (!req.session.userId) return res.redirect('/');
    res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

// ==========================================
// 2. AUTH ROUTES (Disesuaikan dengan input 'username' di HTML)
// ==========================================

app.post('/auth/register', async (req, res) => {
    try {
        const { username, password } = req.body; // Menggunakan username sesuai register.html
        if (!username || !password) return res.status(400).json({ success: false, error: "Data tidak lengkap" });
        
        const hashedPassword = await bcrypt.hash(password, 10);
        
        await db.query(
            "INSERT INTO users (username, password, tokens, role) VALUES (?, ?, ?, ?)",
            [username, hashedPassword, 10, 'user']
        );

        res.json({ success: true, message: "Pendaftaran JAWABAN AI Berhasil!" });
    } catch (e) { 
        console.error("Register Error:", e);
        res.status(500).json({ success: false, error: "Username sudah terdaftar." }); 
    }
});

app.post('/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body; // Menggunakan username sesuai login.html
        const user = await db.get("SELECT * FROM users WHERE LOWER(username) = LOWER(?)", [username]);
        
        if (user && await bcrypt.compare(password, user.password)) {
            req.session.userId = user.id; 
            req.session.username = user.username;
            req.session.role = user.role;

            req.session.save(() => {
                res.json({ 
                    success: true, 
                    token: user.role === 'admin' ? 9999 : (user.tokens || 0),
                    role: user.role 
                });
            });
        } else {
            res.status(401).json({ success: false, error: "Username atau Password Salah!" });
        }
    } catch (e) { 
        console.error("Login Error:", e);
        res.status(500).json({ success: false, error: "Kesalahan Server" }); 
    }
});

// ==========================================
// 3. CORE AI ROUTE (Proses JAWABAN AI)
// ==========================================

app.post('/ai/proses-koreksi', upload.array('foto'), async (req, res) => {
    try {
        if (!req.session.userId) return res.status(401).json({ success: false, message: "Login dahulu!" });
        
        const user = await db.get("SELECT * FROM users WHERE id = ?", [req.session.userId]);

        if (user.role !== 'admin' && (user.tokens || 0) < req.files.length) {
            return res.json({ success: false, limitReached: true, message: "TOKEN JAWABAN AI HABIS" });
        }

        const results = await prosesKoreksiLengkap(req.files, req.body.data, req.body.rumus_pg, req.body.rumus_es);

        if (results && results.length > 0) {
            if (user.role !== 'admin') {
                await db.query("UPDATE users SET tokens = tokens - ? WHERE id = ?", [req.files.length, user.id]);
            }

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

// Fitur Admin untuk kirim token (Sesuai di dashboard.html kamu)
app.post('/admin/add-token', async (req, res) => {
    try {
        if (req.session.role !== 'admin') return res.status(403).json({ success: false, message: "Forbidden" });
        const { targetEmail, amount } = req.body;
        
        const result = await db.query("UPDATE users SET tokens = tokens + ? WHERE username = ?", [amount, targetEmail]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

// Logout
app.get('/auth/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
});

app.listen(port, "0.0.0.0", () => {
    console.log(`🚀 JAWABAN AI Berjalan di Port ${port}`);
});
