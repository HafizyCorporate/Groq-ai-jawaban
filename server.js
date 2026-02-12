const express = require('express'); 
const multer = require('multer');
const path = require('path');
const dotenv = require('dotenv');
const bcrypt = require('bcrypt'); 
const session = require('express-session'); 
const SibApiV3Sdk = require('sib-api-v3-sdk');
const { query, sqliteDb } = require('./db'); // Menggunakan db.js baru
const low = require('lowdb'); // Untuk baca data lama sekali saja
const FileSync = require('lowdb/adapters/FileSync');

dotenv.config();
const app = express();
const port = process.env.PORT || 8080; 

// --- FUNGSI MIGRASI OTOMATIS (AGAR DATA TIDAK HILANG) ---
async function migrateData() {
    try {
        // 1. Buat Tabel Users di Postgres
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

        // 2. Migrasi dari LowDB (db.json)
        const adapter = new FileSync('db.json');
        const dbLow = low(adapter);
        const usersLama = dbLow.get('users').value() || [];
        
        const cekUser = await query('SELECT COUNT(*) FROM users');
        if (parseInt(cekUser.rows[0].count) === 0 && usersLama.length > 0) {
            console.log("🚚 Memindahkan data User dari JSON ke Postgres...");
            for (const u of usersLama) {
                await query(
                    `INSERT INTO users (email, password, quota, is_premium, otp, role) 
                     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
                    [u.email, u.password, u.quota, u.isPremium || false, u.otp, u.email === 'Versacy' ? 'admin' : 'user']
                );
            }
            console.log("✅ User berhasil dipindahkan!");
        }

        // 3. Tambahkan Admin Default jika belum ada
        const adminPass = await bcrypt.hash("08556545", 10);
        await query(`
            INSERT INTO users (email, password, quota, is_premium, role)
            VALUES ('Versacy', $1, 999999, true, 'admin')
            ON CONFLICT (email) DO NOTHING
        `, [adminPass]);

    } catch (err) { console.error("❌ Gagal Migrasi:", err); }
}
migrateData();

// --- KONFIGURASI EXPRESS ---
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

// --- AUTH ROUTES (POSTGRES VERSION) ---
app.post('/auth/register', async (req, res) => {
    try {
        const { email, password } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        await query(
            'INSERT INTO users (email, password, quota) VALUES ($1, $2, 10)',
            [email, hashedPassword]
        );
        res.json({ success: true, message: "Pendaftaran Berhasil!" });
    } catch (e) { 
        res.status(400).json({ success: false, message: "Email sudah ada atau error." }); 
    }
});

app.post('/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const result = await query('SELECT * FROM users WHERE email = $1', [email]);
        const user = result.rows[0];

        if (user && await bcrypt.compare(password, user.password)) {
            req.session.userId = email;
            req.session.save(() => {
                res.json({ success: true, token: user.is_premium ? "UNLIMITED" : user.quota });
            });
        } else {
            res.status(401).json({ success: false, message: "Email/Password Salah!" });
        }
    } catch (e) { res.status(500).json({ success: false }); }
});

// --- ADMIN & AI PROCESS (POSTGRES VERSION) ---
app.post('/admin/add-token', async (req, res) => {
    const { adminEmail, targetEmail, amount } = req.body;
    if (adminEmail !== "Versacy") return res.status(403).json({ success: false });

    await query('UPDATE users SET quota = quota + $1 WHERE email = $2', [parseInt(amount), targetEmail]);
    res.json({ success: true, message: "Token berhasil ditambah!" });
});

app.post('/ai/proses-koreksi', upload.array('foto'), async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ success: false });

    const userRes = await query('SELECT * FROM users WHERE email = $1', [req.session.userId]);
    const user = userRes.rows[0];

    if (!user.is_premium && user.quota < req.files.length) {
        return res.json({ success: false, limitReached: true });
    }

    const results = await prosesKoreksiLengkap(req.files, JSON.parse(req.body.data || "{}"), req.body.rumus_pg, req.body.rumus_es);

    if (!user.is_premium) {
        await query('UPDATE users SET quota = GREATEST(0, quota - $1) WHERE email = $2', [req.files.length, req.session.userId]);
    }

    const finalUser = await query('SELECT quota, is_premium FROM users WHERE email = $1', [req.session.userId]);
    res.json({ success: true, data: results, current_token: finalUser.rows[0].is_premium ? "UNLIMITED" : finalUser.rows[0].quota });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'views', 'dashboard.html')));
app.listen(port, "0.0.0.0", () => console.log(`🚀 Server on port ${port}`));
