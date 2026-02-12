const express = require('express'); 
const multer = require('multer');
const path = require('path');
const dotenv = require('dotenv');
const bcrypt = require('bcrypt'); 
const session = require('express-session'); 
const SibApiV3Sdk = require('sib-api-v3-sdk');
const { query, sqliteDb } = require('./db');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const fs = require('fs');

dotenv.config();
const app = express();
const port = process.env.PORT || 8080; 

// --- 1. PROSES PINDAH DATA (OTOMATIS & AMAN) ---
async function migrasiData() {
    try {
        await query(`
            CREATE TABLE IF NOT EXISTS users (
                email TEXT PRIMARY KEY,
                password TEXT NOT NULL,
                quota INTEGER DEFAULT 10,
                is_premium BOOLEAN DEFAULT FALSE,
                otp TEXT,
                role TEXT DEFAULT 'user'
            )
        `);

        // Cek apakah file db.json ada untuk migrasi
        if (fs.existsSync('db.json')) {
            const adapter = new FileSync('db.json');
            const dbLow = low(adapter);
            const usersLama = dbLow.get('users').value() || [];

            const cekUser = await query('SELECT COUNT(*) FROM users');
            if (parseInt(cekUser.rows[0].count) === 0 && usersLama.length > 0) {
                console.log("🚚 Memindahkan data dari LowDB ke PostgreSQL...");
                for (const u of usersLama) {
                    // Gunakan u.email atau u.username sebagai PRIMARY KEY di Postgres
                    const identifier = u.email || u.username; 
                    await query(
                        `INSERT INTO users (email, password, quota, is_premium, otp) 
                         VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
                        [identifier, u.password, u.quota, u.isPremium || false, u.otp]
                    );
                }
                console.log("✅ Berhasil memindahkan data user.");
            }
        }
        
        // Admin Versacy (Backup)
        const adminPass = await bcrypt.hash("08556545", 10);
        await query(`
            INSERT INTO users (email, password, quota, is_premium, role)
            VALUES ('Versacy', $1, 999999, true, 'admin')
            ON CONFLICT (email) DO NOTHING
        `, [adminPass]);

    } catch (e) { console.error("❌ Gagal migrasi:", e.message); }
}
migrasiData();

// --- 2. MIDDLEWARE & SESSION ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('trust proxy', 1);
app.use(session({
    name: 'gemini_session',
    secret: 'kunci-rahasia-gemini-vision',
    resave: true,
    saveUninitialized: true,
    cookie: { maxAge: 24 * 60 * 60 * 1000, secure: false, sameSite: 'lax' }
}));

const { prosesKoreksiLengkap } = require('./routes/koreksi');
const storage = multer.memoryStorage();
const upload = multer({ storage: storage, limits: { fileSize: 25 * 1024 * 1024 } });

// --- 3. AUTH ROUTES (SESUAI DENGAN HTML USERNAME) ---
app.post('/auth/register', async (req, res) => {
    try {
        // Menerima 'username' dari register.html kamu
        const identifier = req.body.email || req.body.username; 
        const { password } = req.body;
        
        if (!identifier || !password) return res.status(400).json({ success: false, error: "Data tidak lengkap" });

        const hashedPassword = await bcrypt.hash(password, 10);
        await query('INSERT INTO users (email, password, quota) VALUES ($1, $2, 10)', [identifier, hashedPassword]);
        res.json({ success: true, message: "Pendaftaran Berhasil!" });
    } catch (e) { 
        res.status(400).json({ success: false, error: "Username/Email sudah terdaftar!" }); 
    }
});

app.post('/auth/login', async (req, res) => {
    try {
        // Menerima 'username' dari login.html kamu
        const identifier = req.body.email || req.body.username;
        const { password } = req.body;

        const result = await query('SELECT * FROM users WHERE email = $1', [identifier]);
        const user = result.rows[0];

        if (user && await bcrypt.compare(password, user.password)) {
            req.session.userId = identifier;
            req.session.save(() => res.json({ success: true, token: user.is_premium ? "UNLIMITED" : user.quota }));
        } else {
            res.status(401).json({ success: false, error: "Username atau Password Salah!" });
        }
    } catch (e) { res.status(500).json({ success: false, error: "Terjadi kesalahan server" }); }
});

// --- 4. ADMIN & CORE AI ---
app.post('/admin/add-token', async (req, res) => {
    const { adminEmail, targetEmail, amount } = req.body;
    if (adminEmail !== "Versacy") return res.status(403).json({ success: false, message: "Bukan Admin" });
    
    await query('UPDATE users SET quota = quota + $1 WHERE email = $2', [parseInt(amount), targetEmail]);
    res.json({ success: true });
});

app.post('/ai/proses-koreksi', upload.array('foto'), async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ success: false, message: "Sesi Habis" });
    
    const userRes = await query('SELECT * FROM users WHERE email = $1', [req.session.userId]);
    const user = userRes.rows[0];

    if (!user.is_premium && user.quota < req.files.length) return res.json({ success: false, limitReached: true });

    let settings = {};
    try { settings = (typeof req.body.data === 'string') ? JSON.parse(req.body.data) : (req.body.data || {}); } 
    catch (e) { settings = { kunci_pg: {}, kunci_essay: {} }; }

    const results = await prosesKoreksiLengkap(req.files, settings, req.body.rumus_pg, req.body.rumus_es);

    if (!user.is_premium && results.length > 0) {
        await query('UPDATE users SET quota = GREATEST(0, quota - $1) WHERE email = $2', [req.files.length, req.session.userId]);
    }
    
    const finalUser = await query('SELECT quota, is_premium FROM users WHERE email = $1', [req.session.userId]);
    res.json({ 
        success: true, 
        data: results, 
        current_token: finalUser.rows[0].is_premium ? "UNLIMITED" : finalUser.rows[0].quota 
    });
});

app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'views', 'dashboard.html')));
app.get('/', (req, res) => res.redirect('/dashboard'));

app.listen(port, "0.0.0.0", () => console.log(`🚀 Server PostgreSQL siap di port ${port}`));
