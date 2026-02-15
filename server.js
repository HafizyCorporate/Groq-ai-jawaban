const express = require('express'); 
const multer = require('multer');
const path = require('path');
const dotenv = require('dotenv');
const bcrypt = require('bcrypt'); 
const session = require('express-session'); 
const SibApiV3Sdk = require('sib-api-v3-sdk');
const { query } = require('./db'); 
const fs = require('fs');

// --- TAMBAHAN SECURITY PACKAGES ---
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

dotenv.config();
const app = express();
const port = process.env.PORT || 8080; 

// --- 0.A CONFIG ANTI-HACKER (HELMET & RATE LIMIT) ---
app.use(helmet({
    contentSecurityPolicy: false, // Agar script eksternal dashboard tetap jalan
    frameguard: { action: 'deny' } // Anti-Clickjacking
}));

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 Menit
    max: 10, // Max 10 percobaan per IP
    message: { success: false, message: "Terlalu banyak percobaan. Tunggu 15 menit." }
});

// --- 0.B KONFIGURASI API BREVO (SENDER UPDATED) ---
const defaultClient = SibApiV3Sdk.ApiClient.instance;
const apiKey = defaultClient.authentications['api-key'];
apiKey.apiKey = process.env.BREVO_API_KEY; 
const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

// --- 1. PROSES MIGRASI DATA (TETAP) ---
async function migrasiData() {
    try {
        await query(`
            CREATE TABLE IF NOT EXISTS users (
                email TEXT PRIMARY KEY,
                password TEXT NOT NULL,
                quota INTEGER DEFAULT 10,
                is_premium BOOLEAN DEFAULT FALSE,
                otp TEXT,
                otp_expiry TIMESTAMP,
                role TEXT DEFAULT 'user'
            )
        `);
        await query(`
            CREATE TABLE IF NOT EXISTS history (
                id SERIAL PRIMARY KEY,
                email TEXT,
                nama_siswa TEXT,
                mapel TEXT,
                nilai_akhir INTEGER,
                waktu TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log("✅ Database & Table Ready.");
    } catch(e) { console.log("⚠️ Migrasi Error/Skip:", e.message); }
}
migrasiData();

// --- 2. MIDDLEWARE ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public'))); 
app.set('views', path.join(__dirname, 'views'));

app.use(session({
    secret: 'jawaban-ai-secret-key-super-secure',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        httpOnly: true, // Anti-maling script (XSS)
        maxAge: 24 * 60 * 60 * 1000 
    } 
}));

// --- 3. ROUTING VIEWS (DITAMBAHKAN RUTE REGISTER) ---
app.get('/', (req, res) => {
    if (req.session.userId) return res.redirect('/dashboard');
    res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

// Rute untuk menampilkan halaman daftar akun
app.get('/register', (req, res) => {
    if (req.session.userId) return res.redirect('/dashboard');
    res.sendFile(path.join(__dirname, 'views', 'register.html'));
});

app.get('/dashboard', (req, res) => {
    if (!req.session.userId) return res.redirect('/');
    res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

// --- 4. API AUTHENTICATION ---
app.get('/auth/user-session', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ success: false });
    try {
        const result = await query('SELECT email, quota, is_premium FROM users WHERE email = $1', [req.session.userId]);
        if (result.rows.length > 0) {
            res.json({ 
                success: true, 
                email: result.rows[0].email, 
                token: result.rows[0].quota, 
                is_premium: result.rows[0].is_premium 
            });
        } else res.status(404).json({ success: false });
    } catch (e) { res.status(500).json({ success: false }); }
});

// --- OTP REGISTER (LOGIKA UPDATED + EMAIL UPDATED) ---
app.post('/auth/send-otp-register', authLimiter, async (req, res) => {
    const { email } = req.body;
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = new Date(Date.now() + 5 * 60000); 

    try {
        const check = await query('SELECT * FROM users WHERE email = $1', [email]);
        if (check.rows.length > 0 && check.rows[0].password !== 'PENDING') {
            return res.status(400).json({ success: false, error: "Email sudah terdaftar!" });
        }

        await query(`
            INSERT INTO users (email, password, otp, otp_expiry, quota) 
            VALUES ($1, 'PENDING', $2, $3, 10)
            ON CONFLICT (email) DO UPDATE SET otp = $2, otp_expiry = $3`, 
            [email.trim(), otp, expiry]
        );

        const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
        sendSmtpEmail.subject = "Kode OTP Registrasi Jawaban AI";
        sendSmtpEmail.htmlContent = `<html><body><h2>Kode OTP Anda: ${otp}</h2><p>Berlaku 5 menit.</p></body></html>`;
        
        sendSmtpEmail.sender = { "name": "Admin Jawaban AI", "email": "azhardax94@gmail.com" };
        sendSmtpEmail.to = [{ "email": email }];

        await apiInstance.sendTransacEmail(sendSmtpEmail);
        res.json({ success: true });
    } catch (e) {
        console.error("OTP Error:", e);
        res.status(500).json({ success: false, error: "Gagal mengirim email OTP" });
    }
});

// --- REGISTER VERIFIKASI OTP (TETAP) ---
app.post('/auth/register', authLimiter, async (req, res) => {
    const { email, password, otp } = req.body;
    try {
        const result = await query('SELECT otp, otp_expiry FROM users WHERE email = $1', [email.trim()]);
        const user = result.rows[0];

        if (!user || user.otp !== otp || new Date() > new Date(user.otp_expiry)) {
            return res.status(400).json({ success: false, error: "OTP Salah atau Kadaluarsa!" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        await query('UPDATE users SET password = $1, otp = NULL, otp_expiry = NULL WHERE email = $2', [hashedPassword, email.trim()]);
        
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, message: "Gagal mendaftar" }); }
});

// --- LUPA PASSWORD (SENDER UPDATED) ---
app.post('/auth/forgot-password', authLimiter, async (req, res) => {
    const { email } = req.body;
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = new Date(Date.now() + 5 * 60000);

    try {
        const result = await query('SELECT * FROM users WHERE email = $1', [email.trim()]);
        if (result.rows.length === 0) return res.json({ success: false, message: "Email tidak ditemukan!" });

        await query('UPDATE users SET otp = $1, otp_expiry = $2 WHERE email = $3', [otp, expiry, email.trim()]);

        const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
        sendSmtpEmail.subject = "Kode Reset Password Jawaban AI";
        sendSmtpEmail.htmlContent = `<html><body><h2>Kode Reset: ${otp}</h2></body></html>`;
        
        sendSmtpEmail.sender = { "name": "Admin Jawaban AI", "email": "azhardax94@gmail.com" };
        sendSmtpEmail.to = [{ "email": email }];

        await apiInstance.sendTransacEmail(sendSmtpEmail);
        res.json({ success: true });
    } catch(e) {
        res.status(500).json({ success: false, message: "Gagal kirim email" });
    }
});

app.post('/auth/reset-password', authLimiter, async (req, res) => {
    const { email, otp, newPassword } = req.body;
    try {
        const result = await query('SELECT otp, otp_expiry FROM users WHERE email = $1', [email.trim()]);
        const user = result.rows[0];
        if (!user || user.otp !== otp || new Date() > new Date(user.otp_expiry)) {
            return res.json({ success: false, message: "OTP Salah/Expired" });
        }
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await query('UPDATE users SET password = $1, otp = NULL, otp_expiry = NULL WHERE email = $2', [hashedPassword, email.trim()]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ success: false }); }
});

app.post('/auth/login', authLimiter, async (req, res) => {
    const { email, password } = req.body;
    const result = await query('SELECT * FROM users WHERE email = $1', [email.trim()]);
    if (result.rows.length > 0) {
        const user = result.rows[0];
        if (user.password === 'PENDING') return res.status(401).json({ success: false, message: "Akun belum diverifikasi OTP!" });
        if (await bcrypt.compare(password, user.password)) {
            req.session.userId = user.email;
            return res.json({ success: true, token: user.quota, is_premium: user.is_premium });
        }
    }
    res.status(401).json({ success: false, message: "Email/Password salah" });
});

app.get('/auth/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- 5. ADMIN & SAWERIA WEBHOOK (TETAP) ---
app.post('/admin/inject-token', async (req, res) => {
    const isAdmin = ['Versacy', 'admin@jawabanai.com'].includes(req.session.userId);
    if (!isAdmin) return res.status(403).json({ success: false, message: "Unauthorized" });
    const { email, amount } = req.body;
    try {
        await query('UPDATE users SET quota = quota + $1 WHERE email = $2', [parseInt(amount), email.trim()]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/webhook/saweria', async (req, res) => {
    const { amount_raw, msg } = req.body;
    let tokenBonus = 0;
    if (amount_raw >= 100000) tokenBonus = 350;
    else if (amount_raw >= 50000) tokenBonus = 150;
    else if (amount_raw >= 25000) tokenBonus = 60;
    else if (amount_raw >= 10000) tokenBonus = 22;
    else if (amount_raw >= 5000) tokenBonus = 10;
    if (tokenBonus > 0 && msg) {
        try {
            const emailTarget = msg.includes('|') ? msg.split('|')[1].trim() : msg.trim();
            await query('UPDATE users SET quota = quota + $1 WHERE email = $2', [tokenBonus, emailTarget]);
            console.log(`✅ Token berhasil ditambah ke ${emailTarget} via Saweria`);
        } catch (e) { console.error("Saweria Webhook Error:", e); }
    }
    res.status(200).send('OK');
});

// --- 6. HISTORY API (TETAP) ---
app.post('/ai/save-history', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ success: false });
    const { data } = req.body;
    try {
        for (let item of data) {
            await query('INSERT INTO history (email, nama_siswa, mapel, nilai_akhir) VALUES ($1, $2, $3, $4)', [req.session.userId, item.nama_siswa, item.mapel, item.nilai_akhir]);
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.get('/ai/get-history', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ success: false });
    try {
        const result = await query('SELECT id,nama_siswa, mapel, nilai_akhir, waktu FROM history WHERE email = $1 ORDER BY id DESC', [req.session.userId]);
        res.json({ success: true, data: result.rows });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.delete('/ai/delete-history-siswa', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ success: false });
    const { id } = req.body;
    try {
        await query('DELETE FROM history WHERE email = $1 AND id = $2', [req.session.userId, id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

// --- 7. PROSES KOREKSI AI (TETAP) ---
const upload = multer({ storage: multer.memoryStorage() });
const { prosesKoreksiLengkap } = require('./routes/koreksi');

app.post('/ai/proses-koreksi', upload.array('foto'), async (req, res) => {
    try {
        if (!req.session.userId) return res.status(401).json({ success: false, message: "Sesi Habis" });
        const userRes = await query('SELECT quota, is_premium FROM users WHERE email = $1', [req.session.userId]);
        const user = userRes.rows[0];
        if (!user.is_premium && user.quota <= 0) return res.json({ success: false, limitReached: true, message: "Token Habis!" });

        if (req.files && req.files.length > 0) {
            req.files.sort((a, b) => a.originalname.localeCompare(b.originalname, undefined, { numeric: true, sensitivity: 'base' }));
        }

        let kunciPG = {}, kunciEssay = {};
        try {
            kunciPG = req.body.kunci_pg ? JSON.parse(req.body.kunci_pg) : {};
            kunciEssay = req.body.kunci_essay ? JSON.parse(req.body.kunci_essay) : {};
        } catch (e) {}

        const rawResults = await prosesKoreksiLengkap(req.files, { kunci_pg: kunciPG, kunci_essay: kunciEssay }, req.body.r_pg, req.body.r_essay);

        let mergedResults = [];
        let currentStudent = null;
        rawResults.forEach((item) => {
            const isNewStudent = item.nama !== null;
            if (!isNewStudent && currentStudent) {
                currentStudent.pg_betul += (item.pg_betul || 0);
                currentStudent.essay_betul += (item.essay_betul || 0);
                if (item.list_hasil_pg) currentStudent.list_hasil_pg = [...(currentStudent.list_hasil_pg || []), ...item.list_hasil_pg];
                currentStudent.is_merged = true; 
            } else {
                if (currentStudent) mergedResults.push(currentStudent);
                item.nama = item.nama || "Siswa " + (mergedResults.length + 1);
                item.is_merged = false;
                currentStudent = item;
            }
        });
        if (currentStudent) mergedResults.push(currentStudent);

        const totalSiswa = mergedResults.filter(r => r.nama !== "ERROR SCAN" && r.nama !== "GAGAL SCAN").length;
        if (totalSiswa > 0 && !user.is_premium) {
            if (user.quota < totalSiswa) return res.json({ success: false, limitReached: true, message: "Token kurang." });
            await query('UPDATE users SET quota = GREATEST(0, quota - $1) WHERE email = $2', [totalSiswa, req.session.userId]);
        }
        
        const finalUser = await query('SELECT quota, is_premium FROM users WHERE email = $1', [req.session.userId]);
        res.json({ success: true, data: mergedResults, current_token: finalUser.rows[0].is_premium ? '∞' : finalUser.rows[0].quota });
    } catch (error) {
        res.status(500).json({ success: false, message: "Error: " + error.message });
    }
});

app.listen(port, () => console.log(`🚀 Server Secure & OTP aktif di port ${port}`));
