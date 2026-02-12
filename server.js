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

// --- AUTH ROUTES ---
app.post('/auth/register', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ success: false, message: "Data tidak lengkap" });
        
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Menggunakan ? yang akan di-convert db.js menjadi $1 dst
        await db.query(
            "INSERT INTO users (username, password, quota, role) VALUES (?, ?, ?, ?)",
            [email, hashedPassword, 10, 'user']
        );

        res.json({ success: true, message: "Pendaftaran Berhasil!" });
    } catch (e) { 
        console.error("Register Error:", e);
        res.status(500).json({ success: false, message: "User sudah ada atau error sistem." }); 
    }
});

app.post('/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await db.get("SELECT * FROM users WHERE username = ?", [email]);
        
        if (user && await bcrypt.compare(password, user.password)) {
            req.session.userId = user.id; 
            req.session.username = user.username;
            req.session.role = user.role;

            req.session.save(() => {
                res.json({ 
                    success: true, 
                    quota: user.is_premium ? "UNLIMITED" : user.quota,
                    role: user.role 
                });
            });
        } else {
            res.status(401).json({ success: false, message: "Email atau Password Salah!" });
        }
    } catch (e) { 
        res.status(500).json({ success: false }); 
    }
});

// --- CORE AI ROUTE + SAVE TO HISTORY ---
app.post('/ai/proses-koreksi', upload.array('foto'), async (req, res) => {
    try {
        if (!req.session.userId) return res.status(401).json({ success: false, message: "Login dahulu!" });
        
        const user = await db.get("SELECT * FROM users WHERE id = ?", [req.session.userId]);

        if (!user.is_premium && user.quota < req.files.length) {
            return res.json({ success: false, limitReached: true, message: "TOKEN HABIS" });
        }

        const results = await prosesKoreksiLengkap(req.files, req.body.data, req.body.rumus_pg, req.body.rumus_es);

        // UPDATE QUOTA & SAVE HISTORY
        if (results && results.length > 0) {
            // Potong Quota
            if (!user.is_premium) {
                await db.query("UPDATE users SET quota = quota - ? WHERE id = ?", [req.files.length, user.id]);
            }

            // Simpan ke tabel history (Agar bisa dilihat admin/user nanti)
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

// --- ADMIN ROUTES ---
app.get('/admin/users', async (req, res) => {
    if (req.session.role !== 'admin') return res.status(403).send("Forbidden");
    const users = await db.all("SELECT id, username, quota, role, is_premium FROM users", []);
    res.json(users);
});

app.listen(port, "0.0.0.0", () => console.log(`🚀 Server Berjalan di Port ${port}`));
