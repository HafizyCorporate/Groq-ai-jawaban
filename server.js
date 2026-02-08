const express = require('express');
const multer = require('multer');
const path = require('path');
const dotenv = require('dotenv');
const Groq = require("groq-sdk");
const bcrypt = require('bcrypt'); 
const session = require('express-session'); 

dotenv.config();
const app = express();
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const port = process.env.PORT || 8080; 

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

app.use(session({
    secret: 'kunci-rahasia-llama4',
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
const upload = multer({ storage: storage, limits: { fileSize: 20 * 1024 * 1024 } });

// --- AUTH ROUTES ---
app.post('/auth/register', async (req, res) => {
    try {
        const { email, password } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        users.push({ email, password: hashedPassword, quota: 1, isPremium: false, otp: null });
        res.json({ success: true, message: "Pendaftaran Berhasil! Jatah gratis: 1x Koreksi." });
    } catch (e) { 
        console.error("❌ Register Error:", e);
        res.status(500).json({ success: false }); 
    }
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
    } catch (e) {
        console.error("❌ Login Error:", e);
        res.status(500).json({ success: false });
    }
});

app.post('/auth/forgot-password', async (req, res) => {
    const { email } = req.body;
    const user = users.find(u => u.email === email);
    
    if (!user) {
        return res.status(404).json({ success: false, message: "Email tidak terdaftar!" });
    }

    const kodeOTP = Math.floor(100000 + Math.random() * 900000).toString();
    user.otp = kodeOTP;

    const rawKey = process.env.BREVO_API_KEY || "";
    const apiKey = rawKey.replace(/[^\x00-\x7F]/g, "").trim();

    if (!apiKey) {
        console.error("❌ ERROR: BREVO_API_KEY kosong di env Railway!");
        return res.status(500).json({ success: false, message: "Konfigurasi Email Belum Siap!" });
    }

    try {
        const response = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
                'accept': 'application/json',
                'api-key': apiKey,
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                sender: { name: "Gurubantuguru", email: "azhardax94@gmail.com".replace(/[^\x00-\x7F]/g, "").trim() },
                to: [{ email: email.trim() }],
                subject: '🔑 Kode Pemulihan Akun Jawaban AI',
                htmlContent: `<div style="padding:20px; border:1px solid #ddd; text-align:center;"><h1>${kodeOTP}</h1><p>Kode Pemulihan Anda</p></div>`
            })
        });

        if (response.ok) {
            console.log(`✅ OTP terkirim ke ${email}`);
            res.json({ success: true, message: "KODE TERKIRIM" });
        } else {
            res.status(500).json({ success: false, message: "Gagal mengirim email." });
        }
    } catch (err) {
        console.error("❌ Fetch Brevo Error:", err);
        res.status(500).json({ success: false, message: "Kesalahan server saat kirim email." });
    }
});

app.post('/auth/verify-otp', async (req, res) => {
    const { email, otp, newPassword } = req.body;
    const user = users.find(u => u.email === email.trim());

    if (user && user.otp === otp.trim() && user.otp !== null) {
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        user.password = hashedPassword;
        user.otp = null; 
        res.json({ success: true, message: "Berhasil! Password diperbarui." });
    } else {
        res.status(400).json({ success: false, message: "Kode OTP salah atau tidak berlaku!" });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

// --- CORE AI ROUTE (UPDATED) ---
app.post('/ai/proses-koreksi', upload.array('foto'), async (req, res) => {
    try {
        if (!req.session.userId) return res.status(401).json({ success: false, message: "Silakan login dulu!" });
        const user = users.find(u => u.email === req.session.userId);
        
        if (!user.isPremium && user.quota < req.files.length) {
            return res.json({ success: false, limitReached: true, message: "TOKEN HABIS" });
        }

        const settings = JSON.parse(req.body.data);
        const kunciPG = settings.kunci_pg; 
        const results = [];

        for (const file of req.files) {
            const base64 = file.buffer.toString("base64");
            const response = await groq.chat.completions.create({
                "model": "meta-llama/llama-4-scout-17b-16e-instruct",
                "messages": [{
                    "role": "user",
                    "content": [
                        { 
                            "type": "text", 
                            "text": `TUGAS: Koreksi Lembar Jawaban (LJK) dengan Akurasi Geometris Tinggi.
                            
                            INSTRUKSI PRE-PROCESSING & PENGLIHATAN:
                            1. Tingkatkan kontras visual secara internal. Bedakan antara bayangan kertas (noise) dengan coretan pulpen/pensil (input).
                            2. DETEKSI INTERSECTION (TITIK POTONG): Cari titik temu dua garis pada tanda silang (X). Jawaban sah adalah kotak di mana TITIK POTONG berada.
                            3. ABAIKAN OVERLAP GARIS: Jika ujung garis tanda silang keluar kotak dan masuk ke area opsi lain, JANGAN dianggap sebagai jawaban. Fokus hanya pada PUSAT silang.
                            4. KASUS KHUSUS (ANTI-SALAH):
                               - Jika No 1 berpusat di B tapi ujung garis menyentuh C, jawabannya MUTLAK B.
                               - Jika No 4 ada coretan di A dan opsi B bersih (hanya bayangan), jawabannya MUTLAK A.
                            5. VALIDASI: Gunakan analisis kepadatan tinta. Coretan sengaja siswa jauh lebih tebal dari bayangan kertas.

                            WAJIB JSON: 
                            {
                              "nama_siswa": "...", 
                              "jawaban_siswa": {"1": "A", "2": "C"},
                              "log_deteksi": {"1": "Pusat silang di B, garis nyasar ke C diabaikan", "4": "Coretan A tegas, opsi B bersih"}
                            }` 
                        },
                        { "type": "image_url", "image_url": { "url": `data:image/jpeg;base64,${base64}` } }
                    ]
                }],
                "response_format": { "type": "json_object" },
                "temperature": 0
            });
            
            const aiData = JSON.parse(response.choices[0].message.content);
            const jawabanSiswa = aiData.jawaban_siswa || {};
            const logAI = aiData.log_deteksi || {};
            
            let pgBetul = 0;
            let listNomorBetul = [];
            let rincianProses = [];

            Object.keys(kunciPG).forEach(nomor => {
                const jawabSiswa = (jawabanSiswa[nomor] || "KOSONG").toUpperCase();
                const jawabKunci = (kunciPG[nomor] || "").toUpperCase();
                const keterangan = logAI[nomor] || "Deteksi otomatis";

                if (jawabSiswa === jawabKunci && jawabKunci !== "") {
                    pgBetul++;
                    listNomorBetul.push(nomor);
                    rincianProses.push(`No ${nomor}: ✅ Benar (Siswa: ${jawabSiswa}, Info: ${keterangan})`);
                } else {
                    rincianProses.push(`No ${nomor}: ❌ Salah (Siswa: ${jawabSiswa}, Kunci: ${jawabKunci}, Info: ${keterangan})`);
                }
            });

            results.push({ 
                nama: aiData.nama_siswa || "Siswa", 
                pg_betul: pgBetul,
                nomor_pg_betul: listNomorBetul.length > 0 ? listNomorBetul.join(', ') : "KOSONG",
                log_detail: rincianProses 
            }); 
        }

        if (!user.isPremium) user.quota -= req.files.length;
        res.json({ success: true, data: results, current_token: user.isPremium ? "UNLIMITED" : user.quota });
    } catch (err) {
        console.error("❌ AI Process Error:", err);
        res.status(500).json({ success: false, message: "Gagal memproses gambar." });
    }
});

app.listen(port, "0.0.0.0", () => console.log(`🚀 Server Berjalan di Port ${port}`));
