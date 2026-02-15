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

// --- 1. PROSES MIGRASI DATA (DIPERBARUI UNTUK OTP) ---
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

// --- FITUR BARU: OTP REGISTER ---
app.post('/auth/send-otp-register', async (req, res) => {
    const { email } = req.body;
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = new Date(Date.now() + 5 * 60000); // 5 menit

    try {
        const check = await query('SELECT * FROM users WHERE email = $1', [email]);
        if (check.rows.length > 0 && check.rows[0].password !== 'PENDING') {
            return res.status(400).json({ success: false, error: "Email sudah terdaftar!" });
        }

        // Simpan OTP (Upsert: Insert jika baru, Update jika ada tapi status PENDING)
        await query(`
            INSERT INTO users (email, password, otp, otp_expiry, quota) 
            VALUES ($1, 'PENDING', $2, $3, 10)
            ON CONFLICT (email) DO UPDATE SET otp = $2, otp_expiry = $3`, 
            [email.trim(), otp, expiry]
        );

        const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
        sendSmtpEmail.subject = "Kode OTP Pendaftaran Jawaban AI";
        sendSmtpEmail.htmlContent = `<html><body><h2>Kode OTP Anda: ${otp}</h2><p>Berlaku 5 menit. Jangan berikan kode ini kepada siapapun.</p></body></html>`;
        sendSmtpEmail.sender = { "name": "Jawaban AI", "email": "admin@jawabanai.com" };
        sendSmtpEmail.to = [{ "email": email }];

        await apiInstance.sendTransacEmail(sendSmtpEmail);
        res.json({ success: true });
    } catch (e) {
        console.error("OTP Error:", e);
        res.status(500).json({ success: false, error: "Gagal mengirim email OTP" });
    }
});

// --- MODIFIKASI REGISTER: VERIFIKASI OTP ---
app.post('/auth/register', async (req, res) => {
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

// --- FITUR BARU: LUPA PASSWORD ---
app.post('/auth/forgot-password', async (req, res) => {
    const { email } = req.body;
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = new Date(Date.now() + 5 * 60000);

    try {
        const result = await query('SELECT * FROM users WHERE email = $1', [email.trim()]);
        if (result.rows.length === 0) return res.json({ success: false, message: "Email tidak ditemukan!" });

        await query('UPDATE users SET otp = $1, otp_expiry = $2 WHERE email = $3', [otp, expiry, email.trim()]);

        const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
        sendSmtpEmail.subject = "Kode Reset Password Jawaban AI";
        sendSmtpEmail.htmlContent = `<html><body><h2>Kode Reset: ${otp}</h2><p>Gunakan kode ini untuk mereset password Anda.</p></body></html>`;
        sendSmtpEmail.sender = { "name": "Jawaban AI", "email": "admin@jawabanai.com" };
        sendSmtpEmail.to = [{ "email": email }];

        await apiInstance.sendTransacEmail(sendSmtpEmail);
        res.json({ success: true });
    } catch(e) {
        res.status(500).json({ success: false, message: "Gagal kirim email" });
    }
});

app.post('/auth/reset-password', async (req, res) => {
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
    } catch(e) {
        res.status(500).json({ success: false });
    }
});

app.post('/auth/login', async (req, res) => {
    const { email, password } = req.body;
    const result = await query('SELECT * FROM users WHERE email = $1', [email.trim()]);
    if (result.rows.length > 0) {
        const user = result.rows[0];
        // Pastikan akun sudah aktif (password bukan PENDING)
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
            'SELECT id,nama_siswa, mapel, nilai_akhir, waktu FROM history WHERE email = $1 ORDER BY id DESC', 
            [req.session.userId]
        );
        res.json({ success: true, data: result.rows });
    } catch (e) { res.status(500).json({ success: false }); }
});

// API UNTUK MENGHAPUS RIWAYAT PER SISWA
app.delete('/ai/delete-history-siswa', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ success: false });
    const { id } = req.body;
    try {
        await query('DELETE FROM history WHERE email = $1 AND id = $2', [req.session.userId, id]);
        res.json({ success: true });
    } catch (e) { 
        console.error("Gagal hapus siswa:", e);
        res.status(500).json({ success: false }); 
    }
});

// --- 7. PROSES KOREKSI AI (UPDATED: PENGGABUNGAN MULTI-PAGE & PARSING) ---
const upload = multer({ storage: multer.memoryStorage() });
const { prosesKoreksiLengkap } = require('./routes/koreksi');

app.post('/ai/proses-koreksi', upload.array('foto'), async (req, res) => {
    try {
        if (!req.session.userId) return res.status(401).json({ success: false, message: "Sesi Habis" });
        
        const userRes = await query('SELECT quota, is_premium FROM users WHERE email = $1', [req.session.userId]);
        const user = userRes.rows[0];
        
        // Cek Kuota di awal (opsional, tapi lebih baik biar gak buang resource AI kalau kuota habis)
        if (!user.is_premium && user.quota <= 0) {
            return res.json({ success: false, limitReached: true, message: "Token Habis!" });
        }

        // --- PARSING JSON KUNCI JAWABAN ---
        let kunciPG = {};
        let kunciEssay = {};
        try {
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

        // 1. Panggil fungsi koreksi AI untuk SEMUA file yang diupload
        const rawResults = await prosesKoreksiLengkap(req.files, settings, r_pg, r_essay);

               // 2. LOGIKA PENGGABUNGAN (VERSI TERBAIK)
        let mergedResults = [];
        let currentStudent = null;

        rawResults.forEach((item) => {
            // Siswa dianggap baru HANYA jika ada nama (bukan null)
            // Pastikan koreksi.js mengirim 'nama: null' jika AI tidak ketemu nama
            const isNewStudent = item.nama !== null;

            if (!isNewStudent && currentStudent) {
                // GABUNGKAN KE SISWA SEBELUMNYA
                currentStudent.pg_betul += (item.pg_betul || 0);
                currentStudent.essay_betul += (item.essay_betul || 0);
                
                // Gabungkan array hasil PG untuk visualisasi kotak-kotak
                if (item.list_hasil_pg) {
                    currentStudent.list_hasil_pg = [...(currentStudent.list_hasil_pg || []), ...item.list_hasil_pg];
                }
                currentStudent.is_merged = true; 
            } else {
                // SIMPAN SISWA SEBELUMNYA JIKA ADA
                if (currentStudent) mergedResults.push(currentStudent);
                
                // BERI NAMA OTOMATIS JIKA KOSONG (Siswa 1, Siswa 2, dst)
                item.nama = item.nama || "Siswa " + (mergedResults.length + 1);
                item.is_merged = false;
                currentStudent = item;
            }
        });

        if (currentStudent) mergedResults.push(currentStudent);


        // Jangan lupa masukkan siswa terakhir yang sedang diproses
        if (currentStudent) mergedResults.push(currentStudent);

        // 3. Hitung Token Berdasarkan Jumlah SISWA (mergedResults), BUKAN jumlah file
        const totalSiswa = mergedResults.filter(r => r.nama !== "ERROR SCAN" && r.nama !== "GAGAL SCAN").length;

        if (totalSiswa > 0 && !user.is_premium) {
            // Cek lagi apakah kuota cukup untuk jumlah siswa yang terdeteksi
            if (user.quota < totalSiswa) {
                 return res.json({ success: false, limitReached: true, message: `Token kurang. Butuh ${totalSiswa}, sisa ${user.quota}.` });
            }

            await query(
                'UPDATE users SET quota = GREATEST(0, quota - $1) WHERE email = $2', 
                [totalSiswa, req.session.userId]
            );
        }
        
        const finalUser = await query('SELECT quota, is_premium FROM users WHERE email = $1', [req.session.userId]);
        res.json({ 
            success: true, 
            data: mergedResults, 
            current_token: finalUser.rows[0].is_premium ? '∞' : finalUser.rows[0].quota 
        });

    } catch (error) {
        console.error("❌ Koreksi Error:", error);
        res.status(500).json({ success: false, message: "Terjadi kesalahan internal pada AI: " + error.message });
    }
});

app.listen(port, () => console.log(`🚀 Server Jawaban AI aktif di port ${port}`));
