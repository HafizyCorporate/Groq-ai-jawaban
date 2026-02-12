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

// --- 0. KONFIGURASI API BREVO ---
const defaultClient = SibApiV3Sdk.ApiClient.instance;
const apiKey = defaultClient.authentications['api-key'];
apiKey.apiKey = process.env.BREVO_API_KEY; 
const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

// --- 1. PROSES MIGRASI DATA (TIDAK BOLEH HILANG) ---
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

        // Migrasi dari db.json (LowDB) jika ada
        if (fs.existsSync('db.json')) {
            const adapter = new FileSync('db.json');
            const dbLow = low(adapter);
            const usersLama = dbLow.get('users').value() || [];
            for (let u of usersLama) {
                const pass = u.password || await bcrypt.hash('123456', 10);
                await query('INSERT INTO users (email, password, quota) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', 
                [u.email, pass, u.quota || 10]);
            }
        }
        
        // Migrasi dari SQLite jika ada
        if (sqliteDb) {
            sqliteDb.all("SELECT * FROM users", [], async (err, rows) => {
                if (!err && rows) {
                    for (let r of rows) {
                        await query('INSERT INTO users (email, password, quota) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', 
                        [r.email, r.password, r.quota]);
                    }
                }
            });
        }
    } catch(e) { console.log("Migrasi Selesai/Skip."); }
}
migrasiData();

// --- 2. MIDDLEWARE ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public')); 
app.use(session({
    secret: 'jawaban-ai-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } 
}));

// --- 3. ROUTING VIEWS (SESUAI REQUEST ANDA) ---
app.get('/', (req, res) => {
    if (req.session.userId) return res.redirect('/dashboard');
    res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

app.get('/dashboard', (req, res) => {
    if (!req.session.userId) return res.redirect('/');
    res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

// --- 4. API AUTHENTICATION (LENGKAP: LOGIN, REG, FORGET) ---

app.post('/auth/register', async (req, res) => {
    const { email, password } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        await query('INSERT INTO users (email, password, quota) VALUES ($1, $2, 10)', [email.trim(), hashedPassword]);
        res.json({ success: true });
    } catch (e) { res.status(400).json({ success: false, message: "Email sudah ada!" }); }
});

app.post('/auth/login', async (req, res) => {
    const { email, password } = req.body;
    const result = await query('SELECT * FROM users WHERE email = $1', [email.trim()]);
    if (result.rows.length > 0) {
        const user = result.rows[0];
        if (await bcrypt.compare(password, user.password)) {
            req.session.userId = user.email;
            return res.json({ success: true, token: user.quota, is_premium: user.is_premium });
        }
    }
    res.status(401).json({ success: false, message: "Email/Password salah" });
});

// FITUR LUPA PASSWORD (BREVO)
app.post('/auth/forgot-password', async (req, res) => {
    const { email } = req.body;
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    try {
        const result = await query('UPDATE users SET otp = $1 WHERE email = $2 RETURNING *', [otp, email.trim()]);
        if (result.rows.length === 0) return res.status(404).json({ success: false, message: "Email tidak ditemukan" });

        await apiInstance.sendTransacEmail({
            sender: { email: "admin@jawabanai.com", name: "Jawaban AI" },
            to: [{ email: email.trim() }],
            subject: "Kode OTP Lupa Password",
            textContent: `Kode OTP Anda adalah: ${otp}`
        });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/auth/reset-password', async (req, res) => {
    const { email, otp, newPassword } = req.body;
    const result = await query('SELECT * FROM users WHERE email = $1 AND otp = $2', [email.trim(), otp.trim()]);
    if (result.rows.length > 0) {
        const hashed = await bcrypt.hash(newPassword, 10);
        await query('UPDATE users SET password = $1, otp = NULL WHERE email = $2', [hashed, email.trim()]);
        return res.json({ success: true });
    }
    res.status(400).json({ success: false, message: "Kode OTP Salah" });
});

// --- 5. FITUR ADMIN & SAWERIA ---
app.post('/admin/add-token', async (req, res) => {
    const { adminEmail, targetEmail, amount } = req.body;
    // Cek apakah yang akses adalah admin Versacy
    if (adminEmail !== 'Versacy') return res.status(403).json({ success: false });
    
    try {
        await query('UPDATE users SET quota = quota + $1 WHERE email = $2', [parseInt(amount), targetEmail.trim()]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

// --- 6. PROSES KOREKSI AI ---
const upload = multer({ storage: multer.memoryStorage() });
const { prosesKoreksiLengkap } = require('./routes/koreksi');

app.post('/ai/proses-koreksi', upload.array('foto'), async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ success: false, message: "Sesi Habis" });
    
    const userRes = await query('SELECT * FROM users WHERE email = $1', [req.session.userId]);
    const user = userRes.rows[0];

    if (!user.is_premium && user.quota < req.files.length) {
        return res.json({ success: false, limitReached: true, message: "Token Habis" });
    }

    let settings = {};
    try { 
        settings = (typeof req.body.data === 'string') ? JSON.parse(req.body.data) : (req.body.data || {}); 
    } catch (e) { settings = {}; }

    const results = await prosesKoreksiLengkap(req.files, settings, req.body.rumus_pg, req.body.rumus_es);

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

app.listen(port, () => console.log(`Server running on port ${port}`));
