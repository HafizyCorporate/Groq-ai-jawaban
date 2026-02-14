const express = require('express'); 
const multer = require('multer');
const path = require('path');
const dotenv = require('dotenv');
const bcrypt = require('bcrypt'); 
const session = require('express-session'); 
const SibApiV3Sdk = require('sib-api-v3-sdk');
const { query } = require('./db'); // Pastikan koneksi DB sesuai
const fs = require('fs');

dotenv.config();
const app = express();
const port = process.env.PORT || 8080; 

// --- 0. KONFIGURASI API BREVO (TETAP) ---
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
    secret: 'jawaban-ai-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } 
}));

// --- 3. ROUTING VIEWS ---
app.get('/', (req, res) => {
    if (req.session.userId) return res.redirect('/dashboard');
    res.sendFile(path.join(__dirname, 'views', 'login.html'));
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

app.get('/auth/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- 5. ADMIN & SAWERIA WEBHOOK (TETAP SESUAI ASLI) ---
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

// --- 6. HISTORY API ---
app.post('/ai/save-history', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ success: false });
    const { data } = req.body;
    try {
        for (let item of data) {
            await query(
                'INSERT INTO history (email, nama_siswa, mapel, nilai_akhir) VALUES ($1, $2, $3, $4)',
                [req.session.userId, item.nama_siswa, item.mapel, item.nilai_akhir]
            );
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.get('/ai/get-history', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ success: false });
    try {
        const result = await query(
            'SELECT nama_siswa, mapel, nilai_akhir, waktu FROM history WHERE email = $1 ORDER BY id DESC', 
            [req.session.userId]
        );
        res.json({ success: true, data: result.rows });
    } catch (e) { res.status(500).json({ success: false }); }
});

// --- 7. PROSES KOREKSI AI (FIXED SYNC) ---
const upload = multer({ storage: multer.memoryStorage() });
const { prosesKoreksiLengkap } = require('./routes/koreksi');

app.post('/ai/proses-koreksi', upload.array('foto'), async (req, res) => {
    try {
        if (!req.session.userId) return res.status(401).json({ success: false, message: "Sesi Habis" });
        
        const userRes = await query('SELECT quota, is_premium FROM users WHERE email = $1', [req.session.userId]);
        const user = userRes.rows[0];
        
        if (!user.is_premium && user.quota < req.files.length) {
            return res.json({ success: false, limitReached: true, message: "Token Tidak Mencukupi" });
        }

        // --- TAMBAHAN: PARSING JSON AGAR MENJADI OBJECT ---
        let kunciPG = {};
        let kunciEssay = {};
        
        try {
            // Mengubah string JSON dari frontend menjadi Object Javascript
            kunciPG = req.body.kunci_pg ? JSON.parse(req.body.kunci_pg) : {};
            kunciEssay = req.body.kunci_essay ? JSON.parse(req.body.kunci_essay) : {};
        } catch (parseError) {
            console.error("⚠️ Error Parsing Kunci Jawaban:", parseError);
        }

        let settings = {
            kunci_pg: kunciPG,
            kunci_essay: kunciEssay
        };

        const r_pg = req.body.r_pg;
        const r_essay = req.body.r_essay;

        // Panggil fungsi koreksi dengan data yang sudah di-parse
        const results = await prosesKoreksiLengkap(req.files, settings, r_pg, r_essay);

        const totalBerhasil = results.filter(r => r.nama !== "ERROR SCAN" && r.nama !== "GAGAL SCAN").length;

        if (totalBerhasil > 0 && !user.is_premium) {
            await query(
                'UPDATE users SET quota = GREATEST(0, quota - $1) WHERE email = $2', 
                [totalBerhasil, req.session.userId]
            );
        }
        
        const finalUser = await query('SELECT quota, is_premium FROM users WHERE email = $1', [req.session.userId]);
        res.json({ 
            success: true, 
            data: results, 
            current_token: finalUser.rows[0].is_premium ? '∞' : finalUser.rows[0].quota 
        });

    } catch (error) {
        console.error("❌ Koreksi Error:", error);
        res.status(500).json({ success: false, message: "Terjadi kesalahan internal pada AI: " + error.message });
    }
});

app.listen(port, () => console.log(`🚀 Server Jawaban AI aktif di port ${port}`));
