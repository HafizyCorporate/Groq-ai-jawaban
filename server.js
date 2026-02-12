const express = require('express'); 
const multer = require('multer');
const path = require('path');
const dotenv = require('dotenv');
const bcrypt = require('bcrypt'); 
const session = require('express-session'); 
const pgSession = require('connect-pg-simple')(session); // Tambahan untuk session di Postgres
const SibApiV3Sdk = require('sib-api-v3-sdk'); 

dotenv.config();

// --- IMPORT KONEKSI POSTGRESQL (GANTI LOWDB) ---
const pool = require('./db'); 

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

// PERBAIKAN SESSION: Menggunakan PostgreSQL Store agar session tidak hilang saat server restart
app.set('trust proxy', 1); 
app.use(session({
    store: new pgSession({
        pool : pool,
        tableName : 'session'
    }),
    name: 'gemini_session',
    secret: process.env.SESSION_SECRET || 'kunci-rahasia-gemini-vision',
    resave: false, 
    saveUninitialized: false,
    cookie: { 
        maxAge: 24 * 60 * 60 * 1000,
        secure: false, 
        sameSite: 'lax'
    }
}));

const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage, 
    limits: { fileSize: 25 * 1024 * 1024 } 
});

// --- AUTH ROUTES (POSTGRESQL) ---
app.post('/auth/register', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ success: false, message: "Data tidak lengkap" });
        
        const hashedPassword = await bcrypt.hash(password, 10);
        
        await pool.query(
            "INSERT INTO users (username, password, quota, is_premium) VALUES ($1, $2, $3, $4)",
            [email, hashedPassword, 10, false]
        );

        res.json({ success: true, message: "Pendaftaran Berhasil! Jatah gratis: 10x Koreksi." });
    } catch (e) { 
        if (e.code === '23505') return res.status(400).json({ success: false, message: "Email sudah terdaftar!" });
        res.status(500).json({ success: false }); 
    }
});

app.post('/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const result = await pool.query("SELECT * FROM users WHERE username = $1", [email]);
        const user = result.rows[0];
        
        if (user && await bcrypt.compare(password, user.password)) {
            req.session.userId = user.username; 
            req.session.save((err) => {
                if(err) return res.status(500).json({ success: false });
                res.json({ success: true, token: user.is_premium ? "UNLIMITED" : user.quota });
            });
        } else {
            res.status(401).json({ success: false, message: "Email atau Password Salah!" });
        }
    } catch (e) { res.status(500).json({ success: false }); }
});

// --- FITUR LUPA PASSWORD (POSTGRESQL + BREVO) ---
app.post('/auth/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        const result = await pool.query("SELECT * FROM users WHERE username = $1", [email]);
        const user = result.rows[0];

        if (!user) {
            return res.status(404).json({ success: false, message: "Email tidak terdaftar!" });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        // Simpan OTP ke kolom password sementara atau kolom OTP jika Anda sudah menambahkannya di db.js
        await pool.query("UPDATE users SET otp = $1 WHERE username = $2", [otp, email]);

        const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
        sendSmtpEmail.subject = "Kode OTP Reset Password - Guru Bantu Guru AI";
        sendSmtpEmail.htmlContent = `<html><body><h3>Halo,</h3><p>Kode OTP Anda adalah: <b>${otp}</b></p></body></html>`;
        sendSmtpEmail.sender = { "name": "Guru Bantu Guru AI", "email": "azhardax94@gmail.com" };
        sendSmtpEmail.to = [{ "email": email }];

        await apiInstance.sendTransacEmail(sendSmtpEmail);
        res.json({ success: true, message: "Kode OTP telah dikirim ke email." });
    } catch (error) {
        res.status(500).json({ success: false, message: "Gagal mengirim email." });
    }
});

app.post('/auth/reset-password', async (req, res) => {
    try {
        const { email, otp, newPassword } = req.body;
        const result = await pool.query("SELECT * FROM users WHERE username = $1 AND otp = $2", [email, otp]);

        if (result.rowCount > 0) {
            const hashedPassword = await bcrypt.hash(newPassword, 10);
            await pool.query("UPDATE users SET password = $1, otp = NULL WHERE username = $2", [hashedPassword, email]);
            res.json({ success: true, message: "Password berhasil diperbarui!" });
        } else {
            res.status(400).json({ success: false, message: "Kode OTP salah!" });
        }
    } catch (e) { res.status(500).json({ success: false }); }
});

// --- FITUR ADMIN: TAMBAH TOKEN (POSTGRESQL) ---
app.post('/admin/add-token', async (req, res) => {
    try {
        const { adminEmail, targetEmail, amount } = req.body;

        if (adminEmail !== "Versacy") {
            return res.status(403).json({ success: false, message: "Anda bukan Admin!" });
        }

        const result = await pool.query("UPDATE users SET quota = quota + $1 WHERE username = $2 RETURNING quota", [parseInt(amount), targetEmail]);
        
        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, message: "User tujuan tidak ditemukan!" });
        }

        res.json({ success: true, message: `Berhasil! Total token sekarang: ${result.rows[0].quota}` });
    } catch (e) {
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

// --- CORE AI ROUTE (POSTGRESQL) ---
app.post('/ai/proses-koreksi', upload.array('foto'), async (req, res) => {
    req.setTimeout(60000); 

    try {
        if (!req.session.userId) return res.status(401).json({ success: false, message: "Sesi habis, silakan login ulang!" });
        
        const result = await pool.query("SELECT * FROM users WHERE username = $1", [req.session.userId]);
        const user = result.rows[0];

        if (!user) return res.status(404).json({ success: false, message: "User tidak ditemukan" });

        if (!user.is_premium && user.quota < req.files.length) {
            return res.json({ success: false, limitReached: true, message: "TOKEN HABIS" });
        }

        let settings = {};
        try {
            settings = (typeof req.body.data === 'string') ? JSON.parse(req.body.data) : (req.body.data || {});
        } catch (e) {
            settings = { kunci_pg: {}, kunci_essay: {} };
        }

        const results = await prosesKoreksiLengkap(req.files, settings, req.body.rumus_pg || "betul * 1", req.body.rumus_es || "betul * 1");

        if (results.length > 0 && results[0].nama.includes("GAGAL")) {
            return res.status(500).json({ success: false, message: "AI gagal membaca gambar." });
        }

        // Kurangi kuota di PostgreSQL
        let finalQuota = user.quota;
        if (!user.is_premium && results.length > 0) {
            const updateRes = await pool.query(
                "UPDATE users SET quota = GREATEST(0, quota - $1) WHERE username = $2 RETURNING quota",
                [req.files.length, req.session.userId]
            );
            finalQuota = updateRes.rows[0].quota;
        }

        res.json({ 
            success: true, 
            data: results, 
            current_token: user.is_premium ? "UNLIMITED" : finalQuota 
        });

    } catch (err) {
        console.error("❌ AI Global Error:", err);
        res.status(500).json({ success: false, message: "Gangguan sistem." });
    }
});

app.listen(port, "0.0.0.0", () => console.log(`🚀 Server Berjalan di Port ${port}`));
