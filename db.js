const express = require('express'); 
const multer = require('multer');
const path = require('path');
const dotenv = require('dotenv');
const bcrypt = require('bcrypt'); 
const session = require('express-session'); 
const SibApiV3Sdk = require('sib-api-v3-sdk'); 

dotenv.config();

// --- IMPORT DB HYBRID ---
// Gunakan nama 'db' agar konsisten dengan ekspor di db.js
const db = require('./db'); 

// --- PEMANGGILAN FILE KOREKSI.JS ---
const { prosesKoreksiLengkap } = require('./routes/koreksi');

// --- KONFIGURASI BREVO API ---
const defaultClient = SibApiV3Sdk.ApiClient.instance;
const apiKey = defaultClient.authentications['api-key'];
apiKey.apiKey = process.env.BREVO_API_KEY; 
const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

const app = express();
const port = process.env.PORT || 8080; 

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

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

// Gunakan pgSession HANYA jika di Cloud (PostgreSQL)
if (process.env.DATABASE_URL) {
    const pgSession = require('connect-pg-simple')(session);
    sessionConfig.store = new pgSession({
        pool : db.pool, // db.pool diambil dari ekspor db.js mode postgres
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

// --- AUTH ROUTES ---
app.post('/auth/register', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ success: false, message: "Data tidak lengkap" });
        
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Gunakan db.query (Hybrid)
        await db.query(
            "INSERT INTO users (username, password, quota, is_premium, role) VALUES (?, ?, ?, ?, ?)",
            [email, hashedPassword, 10, false, 'user']
        );

        res.json({ success: true, message: "Pendaftaran Berhasil! Jatah gratis: 10x Koreksi." });
    } catch (e) { 
        console.error("Register Error:", e);
        res.status(500).json({ success: false, message: "Email mungkin sudah terdaftar." }); 
    }
});

app.post('/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        // Gunakan db.get untuk mengambil satu baris data
        const user = await db.get("SELECT * FROM users WHERE username = ?", [email]);
        
        if (user && await bcrypt.compare(password, user.password)) {
            req.session.userId = user.id; 
            req.session.username = user.username;
            req.session.role = user.role;

            req.session.save((err) => {
                if(err) return res.status(500).json({ success: false });
                res.json({ success: true, token: user.is_premium ? "UNLIMITED" : user.quota });
            });
        } else {
            res.status(401).json({ success: false, message: "Email atau Password Salah!" });
        }
    } catch (e) { 
        console.error("Login Error:", e);
        res.status(500).json({ success: false }); 
    }
});

// --- FITUR ADMIN: TAMBAH TOKEN ---
app.post('/admin/add-token', async (req, res) => {
    try {
        const { targetEmail, amount } = req.body;

        if (req.session.role !== 'admin') {
            return res.status(403).json({ success: false, message: "Anda bukan Admin!" });
        }

        const result = await db.query(
            "UPDATE users SET quota = quota + ? WHERE username = ?", 
            [parseInt(amount), targetEmail]
        );
        
        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, message: "User tidak ditemukan!" });
        }

        res.json({ success: true, message: "Berhasil menambahkan token." });
    } catch (e) {
        console.error("Admin Add Token Error:", e);
        res.status(500).json({ success: false });
    }
});

// --- CORE AI ROUTE ---
app.post('/ai/proses-koreksi', upload.array('foto'), async (req, res) => {
    try {
        if (!req.session.userId) return res.status(401).json({ success: false, message: "Silakan login ulang!" });
        
        const user = await db.get("SELECT id, is_premium, quota FROM users WHERE id = ?", [req.session.userId]);

        if (!user.is_premium && user.quota < req.files.length) {
            return res.json({ success: false, limitReached: true, message: "TOKEN HABIS" });
        }

        // Jalankan proses koreksi (Logika AI kamu)
        const results = await prosesKoreksiLengkap(req.files, req.body.data, req.body.rumus_pg, req.body.rumus_es);

        // Update kuota jika bukan premium
        if (!user.is_premium && results.length > 0) {
            await db.query(
                "UPDATE users SET quota = quota - ? WHERE id = ?",
                [req.files.length, user.id]
            );
        }

        res.json({ success: true, data: results });

    } catch (err) {
        console.error("AI Error:", err);
        res.status(500).json({ success: false });
    }
});

app.listen(port, "0.0.0.0", () => console.log(`🚀 Server Berjalan di Port ${port}`));
