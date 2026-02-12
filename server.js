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

// --- 1. PROSES PINDAH DATA & PERBAIKAN STRUKTUR DB (TAMBALAN OTOMATIS) ---
async function migrasiData() {
    try {
        // A. Buat Tabel Dasar jika belum ada
        await query(`
            CREATE TABLE IF NOT EXISTS users (
                email TEXT PRIMARY KEY,
                password TEXT NOT NULL,
                quota INTEGER DEFAULT 10,
                is_premium BOOLEAN DEFAULT FALSE,
                role TEXT DEFAULT 'user'
            )
        `);

        // --- TAMBALAN KRUSIAL: Memaksa penambahan kolom jika belum ada ---
        console.log("🛠️ Mengecek dan menambal struktur kolom database...");
        await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS device_id TEXT`);
        await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE`);
        await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS otp TEXT`);

        // C. Pindah data dari LowDB ke PostgreSQL
        if (fs.existsSync('db.json')) {
            const adapter = new FileSync('db.json');
            const dbLow = low(adapter);
            const usersLama = dbLow.get('users').value() || [];

            const cekUser = await query('SELECT COUNT(*) FROM users');
            if (parseInt(cekUser.rows[0].count) === 0 && usersLama.length > 0) {
                console.log("🚚 Memindahkan data dari LowDB ke PostgreSQL...");
                for (const u of usersLama) {
                    const identifier = (u.email || u.username || "").toLowerCase(); 
                    if(!identifier) continue;
                    await query(
                        `INSERT INTO users (email, password, quota, is_premium, is_verified) 
                         VALUES ($1, $2, $3, $4, TRUE) ON CONFLICT DO NOTHING`,
                        [identifier, u.password, u.quota || 10, u.isPremium || false]
                    );
                }
            }
        }
        
        // D. Pastikan Admin Terdaftar & Terverifikasi
        const adminPass = await bcrypt.hash("08556545", 10);
        await query(`
            INSERT INTO users (email, password, quota, is_premium, role, is_verified)
            VALUES ('Adminganteng', $1, 999999, true, 'admin', true)
            ON CONFLICT (email) DO UPDATE SET role = 'admin', is_verified = true
        `, [adminPass]);

        console.log("✅ Database Sinkron, Kolom Tambahan Tersedia, & Admin Siap.");

    } catch (e) { 
        console.error("❌ Gagal migrasi:", e.message); 
    }
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

// --- 3. AUTH ROUTES ---

app.post('/auth/register', async (req, res) => {
    try {
        const identifier = (req.body.email || req.body.username).toLowerCase(); 
        const { password, deviceId } = req.body;
        
        if (!identifier || !password || !deviceId) return res.status(400).json({ success: false, error: "Data tidak lengkap" });

        const checkDevice = await query('SELECT COUNT(*) as total FROM users WHERE device_id = $1', [deviceId]);
        if (parseInt(checkDevice.rows[0].total) >= 2) {
            return res.status(403).json({ success: false, error: "Limit perangkat tercapai! (Maks 2 akun)" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const otp = Math.floor(100000 + Math.random() * 900000).toString();

        await query(`
            INSERT INTO users (email, password, quota, device_id, otp, is_verified) 
            VALUES ($1, $2, 10, $3, $4, FALSE)
            ON CONFLICT (email) DO UPDATE SET otp = $4, password = $2, device_id = $3
        `, [identifier, hashedPassword, deviceId, otp]);

        const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
        sendSmtpEmail.subject = "Verifikasi Pendaftaran - Jawaban AI";
        sendSmtpEmail.htmlContent = `<h3>Kode OTP Pendaftaran Anda: ${otp}</h3><p>Masukkan kode ini untuk mengaktifkan akun.</p>`;
        sendSmtpEmail.sender = { "name": "Admin Jawaban AI", "email": "azhardax94@gmail.com" };
        sendSmtpEmail.to = [{ "email": identifier }];
        await apiInstance.sendTransacEmail(sendSmtpEmail);

        res.json({ success: true, message: "KODE OTP TERKIRIM! Cek email Anda." });
    } catch (e) { res.status(400).json({ success: false, error: "Gagal mendaftar!" }); }
});

app.post('/auth/verify-register', async (req, res) => {
    try {
        const { email, otp } = req.body;
        const result = await query(
            'UPDATE users SET is_verified = TRUE, otp = NULL WHERE LOWER(email) = $1 AND otp = $2 RETURNING *',
            [email.toLowerCase(), otp]
        );
        if (result.rowCount > 0) {
            res.json({ success: true, message: "Verifikasi Berhasil! Silakan Login." });
        } else {
            res.status(400).json({ success: false, message: "Kode OTP Salah!" });
        }
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/auth/login', async (req, res) => {
    try {
        const identifier = (req.body.email || req.body.username).toLowerCase();
        const { password } = req.body;
        const result = await query('SELECT * FROM users WHERE email = $1', [identifier]);
        const user = result.rows[0];

        if (user && await bcrypt.compare(password, user.password)) {
            if (!user.is_verified) return res.status(401).json({ success: false, error: "Akun belum diverifikasi! Cek email." });
            
            req.session.userId = identifier;
            req.session.save(() => res.json({ success: true, token: user.is_premium ? "UNLIMITED" : user.quota }));
        } else {
            res.status(401).json({ success: false, error: "Username atau Password Salah!" });
        }
    } catch (e) { res.status(500).json({ success: false, error: "Terjadi kesalahan server" }); }
});

app.post('/auth/forgot-password', async (req, res) => {
    try {
        const identifier = req.body.email || req.body.username;
        const otp = Math.floor(100000 + Math.random() * 900000).toString(); 
        const result = await query('UPDATE users SET otp = $1 WHERE email = $2 RETURNING *', [otp, identifier]);
        
        if (result.rowCount > 0) {
            const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
            sendSmtpEmail.subject = "Kode OTP Reset Password - Jawaban AI";
            sendSmtpEmail.htmlContent = `<div style="font-family: Arial; padding: 20px;"><h2>OTP: ${otp}</h2></div>`;
            sendSmtpEmail.sender = { "name": "Admin Jawaban AI", "email": "azhardax94@gmail.com" };
            sendSmtpEmail.to = [{ "email": identifier }];
            await apiInstance.sendTransacEmail(sendSmtpEmail);
            res.json({ success: true, message: "KODE TERKIRIM!" });
        } else {
            res.status(404).json({ success: false, message: "Email tidak terdaftar!" });
        }
    } catch (e) { res.status(500).json({ success: false, message: "Gagal mengirim email." }); }
});

app.post('/auth/reset-password', async (req, res) => {
    try {
        const identifier = req.body.email || req.body.username;
        const { otp, newPassword } = req.body;
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        const result = await query(
            'UPDATE users SET password = $1, otp = NULL WHERE email = $2 AND otp = $3 RETURNING *',
            [hashedPassword, identifier, otp]
        );
        if (result.rowCount > 0) res.json({ success: true, message: "Password Berhasil Diganti!" });
        else res.status(400).json({ success: false, message: "Kode OTP Salah!" });
    } catch (e) { res.status(500).json({ success: false }); }
});

// WEBHOOK SAWERIA
app.post('/ai/saweria-webhook', async (req, res) => {
    try {
        const payload = req.body.data ? req.body.data : req.body;
        const nominal = payload.amount_raw; 
        const pesan = payload.message || ""; 
        const regexEmail = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
        const match = pesan.match(regexEmail);

        if (match) {
            const emailTarget = match[0].toLowerCase().trim();
            let tambahQuota = 0;
            if (nominal >= 100000) tambahQuota = 280;
            else if (nominal >= 50000) tambahQuota = 120;
            else if (nominal >= 20000) tambahQuota = 45;
            else if (nominal >= 10000) tambahQuota = 22;
            else if (nominal >= 5000) tambahQuota = 10;

            if (tambahQuota > 0) {
                await query('UPDATE users SET quota = quota + $1 WHERE LOWER(email) = $2', [tambahQuota, emailTarget]);
            }
        }
        res.status(200).send('OK'); 
    } catch (e) { res.status(500).send('Error'); }
});

// ADMIN & CORE AI
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
    res.json({ success: true, data: results, current_token: finalUser.rows[0].is_premium ? "UNLIMITED" : finalUser.rows[0].quota });
});

app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'views', 'dashboard.html')));
app.get('/', (req, res) => res.redirect('/dashboard'));

app.listen(port, "0.0.0.0", () => console.log(`🚀 Server PostgreSQL siap di port ${port}`));
