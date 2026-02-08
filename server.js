const express = require('express'); 
const multer = require('multer');
const path = require('path');
const dotenv = require('dotenv');
const bcrypt = require('bcrypt'); 
const session = require('express-session'); 

// --- PEMANGGILAN FILE KOREKSI.JS (Menggunakan Gemini 3/2.5) ---
const { prosesKoreksiLengkap } = require('./routes/koreksi');

dotenv.config();
const app = express();
const port = process.env.PORT || 8080; 

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

app.use(session({
    secret: 'kunci-rahasia-gemini-vision',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

let users = []; 

async function initAdmin() {
    try {
        const adminUser = "Versacy";
        const adminPass = "08556545";
        const hashedPassword = await bcrypt.hash(adminPass, 10);
        
        const cekAdmin = users.find(u => u.email === adminUser);
        if (!cekAdmin) {
            users.push({ 
                email: adminUser, 
                password: hashedPassword, 
                quota: 999999, 
                isPremium: true,
                otp: null 
            });
            console.log("✅ Admin Versacy Berhasil Didaftarkan");
        }
    } catch (e) {
        console.error("❌ Gagal init admin:", e);
    }
}
initAdmin();

const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage, 
    limits: { fileSize: 25 * 1024 * 1024 } // Kapasitas 25MB agar gambar LJK jernih
});

// --- AUTH ROUTES ---
app.post('/auth/register', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ success: false, message: "Data tidak lengkap" });
        const hashedPassword = await bcrypt.hash(password, 10);
        users.push({ email, password: hashedPassword, quota: 1, isPremium: false, otp: null });
        res.json({ success: true, message: "Pendaftaran Berhasil! Jatah gratis: 1x Koreksi." });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = users.find(u => u.email === email);
        if (user && await bcrypt.compare(password, user.password)) {
            req.session.userId = email; 
            res.json({ success: true, token: user.isPremium ? "UNLIMITED" : user.quota });
        } else {
            res.status(401).json({ success: false, message: "Email atau Password Salah!" });
        }
    } catch (e) { res.status(500).json({ success: false }); }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

// --- CORE AI ROUTE (Sistem Koreksi LJK Gemini) ---
app.post('/ai/proses-koreksi', upload.array('foto'), async (req, res) => {
    req.setTimeout(300000); // Timeout 5 menit untuk proses AI yang berat

    try {
        if (!req.session.userId) return res.status(401).json({ success: false, message: "Silakan login dulu!" });
        
        // --- TAMBAHAN: Validasi keberadaan file agar tidak crash ---
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ success: false, message: "Mohon unggah foto LJK terlebih dahulu!" });
        }

        const user = users.find(u => u.email === req.session.userId);
        if (!user) return res.status(404).json({ success: false, message: "User tidak ditemukan" });

        if (!user.isPremium && user.quota < req.files.length) {
            return res.json({ success: false, limitReached: true, message: "TOKEN HABIS" });
        }

        const settings = JSON.parse(req.body.data || "{}");
        const r_pg = req.body.rumus_pg || "betul * 1"; 
        const r_es = req.body.rumus_es || "betul * 1"; 

        // Pemanggilan fungsi di koreksi.js yang sudah menggunakan Gemini 3/2.5
        const results = await prosesKoreksiLengkap(req.files, settings, r_pg, r_es);

        // --- TAMBAHAN: Cek jika AI mengembalikan error (seperti kuota habis) ---
        if (results.length > 0 && results[0].nama.includes("Error")) {
            return res.status(500).json({ 
                success: false, 
                message: "AI sedang sibuk atau kuota harian habis.",
                detail: results[0].log_detail[0]
            });
        }

        if (!user.isPremium && results.length > 0) {
            user.quota = Math.max(0, user.quota - req.files.length);
        }

        res.json({ 
            success: true, 
            data: results, 
            current_token: user.isPremium ? "UNLIMITED" : user.quota 
        });

    } catch (err) {
        // --- TAMBAHAN: Log error yang lebih detail ---
        console.error("❌ AI Global Error:", err);
        res.status(500).json({ 
            success: false, 
            message: "Terjadi kesalahan pada sistem AI.",
            error_code: err.message 
        });
    }
});

app.listen(port, "0.0.0.0", () => console.log(`🚀 Server Berjalan di Port ${port}`));
