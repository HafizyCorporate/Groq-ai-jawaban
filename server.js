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

// --- 0. KONFIGURASI API BREVO (MENGGUNAKAN SDK API) ---
const defaultClient = SibApiV3Sdk.ApiClient.instance;
const apiKey = defaultClient.authentications['api-key'];
apiKey.apiKey = process.env.BREVO_API_KEY; 
const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

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

        if (fs.existsSync('db.json')) {
            const adapter = new FileSync('db.json');
            const dbLow = low(adapter);
            const usersLama = dbLow.get('users').value() || [];

            const cekUser = await query('SELECT COUNT(*) FROM users');
            if (parseInt(cekUser.rows[0].count) === 0 && usersLama.length > 0) {
                console.log("🚚 Memindahkan data dari LowDB ke PostgreSQL...");
                for (const u of usersLama) {
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

// --- 3. AUTH ROUTES ---

// >>> FITUR BARU: KIRIM OTP REGISTRASI <<<
app.post('/auth/send-otp-register', async (req, res) => {
    try {
        const identifier = req.body.email || req.body.username;
        if (!identifier) return res.status(400).json({ success: false, error: "Email wajib diisi" });

        // Cek apakah user sudah terdaftar dan aktif
        const checkUser = await query('SELECT * FROM users WHERE email = $1', [identifier]);
        if (checkUser.rows.length > 0 && checkUser.rows[0].password !== 'PENDING') {
            return res.status(400).json({ success: false, error: "Email sudah terdaftar!" });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();

        // Simpan sementara user dengan status PENDING
        await query(`
            INSERT INTO users (email, password, otp, quota) 
            VALUES ($1, 'PENDING', $2, 10) 
            ON CONFLICT (email) DO UPDATE SET otp = $2`, 
            [identifier, otp]
        );

        const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
        sendSmtpEmail.subject = "Kode OTP Pendaftaran - Jawaban AI";
        sendSmtpEmail.htmlContent = `
            <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
                <h2 style="color: #2563eb;">Verifikasi Akun Baru</h2>
                <p>Gunakan kode OTP di bawah ini untuk menyelesaikan pendaftaran Anda:</p>
                <div style="font-size: 32px; font-weight: bold; color: #2563eb; letter-spacing: 5px; padding: 10px; background: #f3f4f6; display: inline-block;">
                    ${otp}
                </div>
                <p style="margin-top: 20px;">Kode ini bersifat rahasia.</p>
            </div>`;
        sendSmtpEmail.sender = { "name": "Admin Jawaban AI", "email": "azhardax94@gmail.com" };
        sendSmtpEmail.to = [{ "email": identifier }];

        await apiInstance.sendTransacEmail(sendSmtpEmail);
        res.json({ success: true, message: "OTP Terkirim ke Email!" });
    } catch (e) {
        res.status(500).json({ success: false, error: "Gagal mengirim OTP." });
    }
});

// >>> UPDATE: REGISTER DENGAN VERIFIKASI OTP <<<
app.post('/auth/register', async (req, res) => {
    try {
        const identifier = req.body.email || req.body.username; 
        const { password, otp } = req.body;

        if (!identifier || !password || !otp) return res.status(400).json({ success: false, error: "Data tidak lengkap" });

        // Verifikasi OTP
        const result = await query('SELECT * FROM users WHERE email = $1 AND otp = $2', [identifier, otp]);
        
        if (result.rowCount === 0) {
            return res.status(400).json({ success: false, error: "Kode OTP Salah!" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Update user: Set password asli dan hapus OTP
        await query(
            'UPDATE users SET password = $1, otp = NULL WHERE email = $2',
            [hashedPassword, identifier]
        );

        res.json({ success: true, message: "Pendaftaran Berhasil! Silakan Login." });
    } catch (e) { 
        res.status(400).json({ success: false, error: "Terjadi kesalahan pendaftaran." }); 
    }
});

// >>> UPDATE: LOGIN (Mencegah user PENDING masuk) <<<
app.post('/auth/login', async (req, res) => {
    try {
        const identifier = req.body.email || req.body.username;
        const { password } = req.body;
        const result = await query('SELECT * FROM users WHERE email = $1', [identifier]);
        const user = result.rows[0];

        // User harus ada, password harus cocok, dan tidak dalam status PENDING
        if (user && user.password !== 'PENDING' && await bcrypt.compare(password, user.password)) {
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
            sendSmtpEmail.htmlContent = `
                <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
                    <h2 style="color: #2563eb;">Halo!</h2>
                    <p>Anda telah meminta pengaturan ulang kata sandi. Gunakan kode OTP di bawah ini:</p>
                    <div style="font-size: 32px; font-weight: bold; color: #2563eb; letter-spacing: 5px; padding: 10px; background: #f3f4f6; display: inline-block;">
                        ${otp}
                    </div>
                    <p style="margin-top: 20px;">Kode ini bersifat rahasia. Jangan berikan kepada siapapun.</p>
                </div>`;
            sendSmtpEmail.sender = { "name": "Admin Jawaban AI", "email": "azhardax94@gmail.com" };
            sendSmtpEmail.to = [{ "email": identifier }];

            await apiInstance.sendTransacEmail(sendSmtpEmail);

            console.log(`🔑 OTP Terkirim ke ${identifier}: ${otp}`);
            res.json({ success: true, message: "KODE TERKIRIM! Cek kotak masuk atau spam email Anda." });
        } else {
            res.status(404).json({ success: false, message: "Email tidak terdaftar!" });
        }
    } catch (e) { 
        console.error("❌ Error API Brevo:", e.message);
        res.status(500).json({ success: false, message: "Gagal mengirim email." }); 
    }
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
        if (result.rowCount > 0) {
            res.json({ success: true, message: "Password Berhasil Diganti!" });
        } else {
            res.status(400).json({ success: false, message: "Kode OTP Salah!" });
        }
    } catch (e) { res.status(500).json({ success: false }); }
});

// >>> TAMBAHAN: FITUR TOPUP OTOMATIS VIA SAWERIA WEBHOOK (POSTGRES READY) <<<
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
                const result = await query(
                    'UPDATE users SET quota = quota + $1 WHERE LOWER(email) = $2 RETURNING quota', 
                    [tambahQuota, emailTarget]
                );

                if (result.rowCount > 0) {
                    console.log(`✅ [Saweria] +${tambahQuota} Quota untuk ${emailTarget} (Rp ${nominal}). Total: ${result.rows[0].quota}`);
                } else {
                    console.log(`❌ [Saweria] User ${emailTarget} tidak ditemukan di DB.`);
                }
            }
        }
        res.status(200).send('OK'); 
    } catch (e) {
        console.error("❌ Webhook Error:", e.message);
        res.status(500).send('Error');
    }
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
    res.json({ success: true, data: results, current_token: finalUser.rows[0].is_premium ? "UNLIMITED" : finalUser.rows[0].quota });
});

app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'views', 'dashboard.html')));
app.get('/', (req, res) => res.redirect('/dashboard'));

app.listen(port, "0.0.0.0", () => console.log(`🚀 Server PostgreSQL siap di port ${port}`));
