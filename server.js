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

// --- 1. PROSES MIGRASI DATA ---
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

        // TAMBAHAN: Tabel History
        await query(`
            CREATE TABLE IF NOT EXISTS history (
                id SERIAL PRIMARY KEY,
                email TEXT,
                nama_siswa TEXT,
                mapel TEXT,
                waktu TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        if (fs.existsSync('db.json')) {
            const adapter = new FileSync('db.json');
            const dbLow = low(adapter);
            const usersLama = dbLow.get('users').value() || [];
            for (let u of usersLama) {
                const pass = u.password || await bcrypt.hash('123456', 10);
                await query('INSERT INTO users (email, password, quota) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [u.email, pass, u.quota || 10]);
            }
        }
        if (sqliteDb) {
            sqliteDb.all("SELECT * FROM users", [], async (err, rows) => {
                if (!err && rows) {
                    for (let r of rows) {
                        await query('INSERT INTO users (email, password, quota) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [r.email, r.password, r.quota]);
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
        } else {
            res.status(404).json({ success: false });
        }
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
    if (adminEmail !== 'Versacy') return res.status(403).json({ success: false });
    try {
        await query('UPDATE users SET quota = quota + $1 WHERE email = $2', [parseInt(amount), targetEmail.trim()]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/webhook/saweria', async (req, res) => {
    const { amount_raw, customer_email, msg } = req.body;
    let tokenBonus = 0;
    if (amount_raw >= 100000) tokenBonus = 300;
    else if (amount_raw >= 50000) tokenBonus = 125;
    else if (amount_raw >= 20000) tokenBonus = 50;
    else if (amount_raw >= 10000) tokenBonus = 22;
    else if (amount_raw >= 5000) tokenBonus = 10;

    if (tokenBonus > 0) {
        try {
            const emailTarget = (customer_email || msg || "").trim();
            if (emailTarget) {
                const result = await query('UPDATE users SET quota = quota + $1 WHERE email = $2 RETURNING email', [tokenBonus, emailTarget]);
                if (result.rows.length > 0) {
                    return res.status(200).send('Success');
                }
            }
        } catch (e) { console.error("[Saweria Error]", e); }
    }
    res.status(200).send('Processed');
});

// --- 6. API HISTORY ---
app.get('/ai/history', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ success: false });
    try {
        const result = await query(
            'SELECT nama_siswa, mapel, waktu FROM history WHERE email = $1 ORDER BY waktu DESC LIMIT 10', 
            [req.session.userId]
        );
        res.json({ success: true, history: result.rows });
    } catch (e) { res.status(500).json({ success: false }); }
});

// --- 7. PROSES KOREKSI AI ---
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
        settings = {
            kunci_pg: req.body.kunci_pg ? JSON.parse(req.body.kunci_pg) : {},
            kunci_essay: req.body.kunci_essay ? JSON.parse(req.body.kunci_essay) : {}
        };
    } catch (e) { settings = { kunci_pg: {}, kunci_essay: {} }; }

    const results = await prosesKoreksiLengkap(req.files, settings, req.body.rumus_pg, req.body.rumus_es);

    // SIMPAN KE HISTORY & POTONG KUOTA
    if (results.length > 0) {
        for (let r of results) {
            await query(
                'INSERT INTO history (email, nama_siswa, mapel) VALUES ($1, $2, $3)',
                [req.session.userId, r.nama || 'Tanpa Nama', req.body.mapel || 'Ujian']
            );
        }

        if (!user.is_premium) {
            await query('UPDATE users SET quota = GREATEST(0, quota - $1) WHERE email = $2', [req.files.length, req.session.userId]);
        }
    }
    
    const finalUser = await query('SELECT quota, is_premium FROM users WHERE email = $1', [req.session.userId]);
    res.json({ 
        success: true, 
        data: results, 
        current_token: finalUser.rows[0].is_premium ? 'UNLIMITED' : finalUser.rows[0].quota 
    });
});

app.listen(port, () => console.log(`Server running on port ${port}`));
