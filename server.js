const express = require('express'); 
const multer = require('multer');
const path = require('path');
const dotenv = require('dotenv');
const bcrypt = require('bcrypt'); 
const session = require('express-session'); 
const SibApiV3Sdk = require('sib-api-v3-sdk'); // Tambahan: Brevo SDK

// --- DATABASE FILE (LOWDB) ---
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const adapter = new FileSync('db.json');
const db = low(adapter);

// Inisialisasi Database Default jika file kosong
db.defaults({ users: [] }).write();

// --- PEMANGGILAN FILE KOREKSI.JS ---
const { prosesKoreksiLengkap } = require('./routes/koreksi');

dotenv.config();

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

// PERBAIKAN SESSION: Tambahkan proxy dan name agar lebih stabil di Railway/Mobile
app.set('trust proxy', 1); 
app.use(session({
    name: 'gemini_session',
    secret: 'kunci-rahasia-gemini-vision',
    resave: true, // Diubah ke true agar sesi tidak mudah hilang saat idle
    saveUninitialized: true,
    cookie: { 
        maxAge: 24 * 60 * 60 * 1000,
        secure: false, // Set ke false karena Railway biasanya handle SSL di tingkat proxy
        sameSite: 'lax'
    }
}));

// Simulasi database diganti ke Lowdb agar permanen
async function initAdmin() {
    try {
        const adminUser = "Versacy";
        const adminPass = "08556545";
        
        // Cek admin di database file
        const cekAdmin = db.get('users').find({ email: adminUser }).value();
        
        if (!cekAdmin) {
            const hashedPassword = await bcrypt.hash(adminPass, 10);
            db.get('users').push({ 
                email: adminUser, 
                password: hashedPassword, 
                quota: 999999, 
                isPremium: true,
                otp: null 
            }).write();
            console.log("✅ Admin Versacy Berhasil Didaftarkan ke Database");
        }
    } catch (e) {
        console.error("❌ Gagal init admin:", e);
    }
}
initAdmin();

const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage, 
    limits: { fileSize: 25 * 1024 * 1024 } 
});

// --- AUTH ROUTES ---
app.post('/auth/register', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ success: false, message: "Data tidak lengkap" });
        
        const cekUser = db.get('users').find({ email }).value();
        if (cekUser) return res.status(400).json({ success: false, message: "Email sudah terdaftar!" });

        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Simpan permanen
        db.get('users').push({ 
            email, 
            password: hashedPassword, 
            quota: 10, 
            isPremium: false, 
            otp: null 
        }).write();

        res.json({ success: true, message: "Pendaftaran Berhasil! Jatah gratis: 10x Koreksi." });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = db.get('users').find({ email }).value();
        
        if (user && await bcrypt.compare(password, user.password)) {
            req.session.userId = email; 
            // Paksa simpan session sebelum kirim respon
            req.session.save((err) => {
                if(err) return res.status(500).json({ success: false });
                res.json({ success: true, token: user.isPremium ? "UNLIMITED" : user.quota });
            });
        } else {
            res.status(401).json({ success: false, message: "Email atau Password Salah!" });
        }
    } catch (e) { res.status(500).json({ success: false }); }
});

// --- FITUR LUPA PASSWORD (BREVO API) ---
app.post('/auth/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        const user = db.get('users').find({ email }).value();

        if (!user) {
            return res.status(404).json({ success: false, message: "Email tidak terdaftar!" });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        db.get('users').find({ email }).assign({ otp: otp }).write();

        const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
        // EDIT NAMA: Menjadi Guru Bantu Guru AI
        sendSmtpEmail.subject = "Kode OTP Reset Password - Guru Bantu Guru AI";
        sendSmtpEmail.htmlContent = `<html><body><h3>Halo,</h3><p>Kode OTP Anda adalah: <b>${otp}</b></p><p>Gunakan kode ini untuk meriset password Anda.</p></body></html>`;
        sendSmtpEmail.sender = { "name": "Guru Bantu Guru AI", "email": "azhardax94@gmail.com" };
        sendSmtpEmail.to = [{ "email": email }];

        await apiInstance.sendTransacEmail(sendSmtpEmail);
        res.json({ success: true, message: "Kode OTP telah dikirim ke email." });
    } catch (error) {
        console.error("Brevo Error:", error);
        res.status(500).json({ success: false, message: "Gagal mengirim email." });
    }
});

app.post('/auth/reset-password', async (req, res) => {
    try {
        const { email, otp, newPassword } = req.body;
        const user = db.get('users').find({ email }).value();

        if (user && user.otp === otp) {
            const hashedPassword = await bcrypt.hash(newPassword, 10);
            db.get('users').find({ email }).assign({ password: hashedPassword, otp: null }).write();
            res.json({ success: true, message: "Password berhasil diperbarui!" });
        } else {
            res.status(400).json({ success: false, message: "Kode OTP salah!" });
        }
    } catch (e) { res.status(500).json({ success: false }); }
});

// ==========================================
// --- FITUR ADMIN: TAMBAH TOKEN (PERMANEN) ---
// ==========================================
app.post('/admin/add-token', async (req, res) => {
    try {
        const { adminEmail, targetEmail, amount } = req.body;

        if (adminEmail !== "Versacy") {
            return res.status(403).json({ success: false, message: "Anda bukan Admin!" });
        }

        const user = db.get('users').find({ email: targetEmail }).value();
        if (!user) {
            return res.status(404).json({ success: false, message: "User tujuan tidak ditemukan!" });
        }

        // Update token di database file
        const newQuota = (user.quota || 0) + parseInt(amount);
        db.get('users').find({ email: targetEmail }).assign({ quota: newQuota }).write();
        
        console.log(`💎 Admin menambah ${amount} token ke ${targetEmail}`);
        res.json({ success: true, message: `Berhasil! Total token ${targetEmail} sekarang: ${newQuota}` });

    } catch (e) {
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

// --- CORE AI ROUTE ---
app.post('/ai/proses-koreksi', upload.array('foto'), async (req, res) => {
    req.setTimeout(60000); // Ditambah jadi 60 detik karena Gemini 3 butuh waktu mikir

    try {
        if (!req.session.userId) return res.status(401).json({ success: false, message: "Sesi habis, silakan login ulang!" });
        if (!req.files || req.files.length === 0) return res.status(400).json({ success: false, message: "Mohon unggah foto!" });

        const user = db.get('users').find({ email: req.session.userId }).value();
        if (!user) return res.status(404).json({ success: false, message: "User tidak ditemukan" });

        if (!user.isPremium && user.quota < req.files.length) {
            return res.json({ success: false, limitReached: true, message: "TOKEN HABIS" });
        }

        // PERBAIKAN: Parsing data yang lebih aman agar Kunci Jawaban tidak hilang/kosong
        let settings = {};
        try {
            settings = (typeof req.body.data === 'string') ? JSON.parse(req.body.data) : (req.body.data || {});
        } catch (e) {
            console.error("Gagal parse settings:", e);
            settings = { kunci_pg: {}, kunci_essay: {} };
        }

        const r_pg = req.body.rumus_pg || "betul * 1"; 
        const r_es = req.body.rumus_es || "betul * 1"; 

        const results = await prosesKoreksiLengkap(req.files, settings, r_pg, r_es);

        if (results.length > 0 && results[0].nama.includes("GAGAL")) {
            return res.status(500).json({ success: false, message: "AI gagal membaca gambar." });
        }

        // Kurangi kuota di database file
        if (!user.isPremium && results.length > 0) {
            const currentQuota = db.get('users').find({ email: req.session.userId }).value().quota;
            const updatedQuota = Math.max(0, currentQuota - req.files.length);
            db.get('users').find({ email: req.session.userId }).assign({ quota: updatedQuota }).write();
        }

        const finalUser = db.get('users').find({ email: req.session.userId }).value();
        res.json({ 
            success: true, 
            data: results, 
            current_token: finalUser.isPremium ? "UNLIMITED" : finalUser.quota 
        });

    } catch (err) {
        console.error("❌ AI Global Error:", err);
        res.status(500).json({ success: false, message: "Waktu tunggu habis atau terjadi gangguan." });
    }
});

app.listen(port, "0.0.0.0", () => console.log(`🚀 Server Berjalan di Port ${port}`));
