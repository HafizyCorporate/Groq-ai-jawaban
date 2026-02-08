const express = require('express');
const multer = require('multer');
const path = require('path');
const dotenv = require('dotenv');
const Groq = require("groq-sdk");
const bcrypt = require('bcrypt'); 
const nodemailer = require('nodemailer'); 
const session = require('express-session'); 

dotenv.config();
const app = express();
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const port = process.env.PORT || 3000;

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
    const adminUser = "Versacy";
    const adminPass = "08556545";
    const hashedPassword = await bcrypt.hash(adminPass, 10);
    
    const cekAdmin = users.find(u => u.email === adminUser);
    if (!cekAdmin) {
        users.push({ 
            email: adminUser, 
            password: hashedPassword, 
            quota: 999999, 
            isPremium: true 
        });
        console.log("✅ Admin Versacy Berhasil Didaftarkan");
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
        users.push({ email, password: hashedPassword, quota: 1, isPremium: false });
        res.json({ success: true, message: "Pendaftaran Berhasil! Jatah gratis: 1x Koreksi." });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/auth/login', async (req, res) => {
    const { email, password } = req.body;
    const user = users.find(u => u.email === email);
    if (user && await bcrypt.compare(password, user.password)) {
        req.session.userId = email; 
        res.json({ success: true, token: user.isPremium ? "UNLIMITED" : user.quota });
    } else {
        res.status(401).json({ success: false, message: "Email atau Password Salah!" });
    }
});

// LOGIKA FORGOT PASSWORD - VERSI BREVO (JALUR ALTERNATIF PORT 2525)
app.post('/auth/forgot-password', async (req, res) => {
    const { email } = req.body;
    const userExists = users.find(u => u.email === email);
    
    if (!userExists) {
        return res.status(404).json({ success: false, message: "Email tidak terdaftar!" });
    }

    const cleanEmail = process.env.EMAIL_USER ? process.env.EMAIL_USER.trim() : "";
    const cleanPass = process.env.EMAIL_PASS ? process.env.EMAIL_PASS.trim() : "";

    // KONFIGURASI BREVO PORT 2525 (MENGATASI CONNECTION TIMEOUT)
    const transporter = nodemailer.createTransport({
        host: 'smtp-relay.brevo.com',
        port: 2525, 
        secure: false,
        auth: { 
            user: cleanEmail, 
            pass: cleanPass 
        },
        tls: {
            rejectUnauthorized: false
        }
    });

    const mailOptions = {
        from: `"JAWABAN AI" <${cleanEmail}>`,
        to: email,
        subject: '🔑 Kode Pemulihan Akun Jawaban AI',
        html: `
            <div style="max-width: 500px; margin: auto; font-family: sans-serif; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden;">
                <div style="background: linear-gradient(135deg, #2563eb, #7c3aed); padding: 30px; text-align: center; color: white;">
                    <h1 style="margin: 0; font-size: 24px;">Jawaban AI</h1>
                </div>
                <div style="padding: 30px; background: white; color: #1e293b;">
                    <p>Halo, <strong>${email}</strong>!</p>
                    <p>Gunakan kode keamanan di bawah ini untuk meriset password Anda:</p>
                    <div style="margin: 25px 0; padding: 20px; background: #f8fafc; border: 2px dashed #cbd5e1; border-radius: 12px; text-align: center;">
                        <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #2563eb;">123456</span>
                    </div>
                    <p style="font-size: 14px; color: #64748b;">Hubungi <b>Admin Versacy</b> jika Anda butuh bantuan.</p>
                </div>
            </div>
        `
    };

    transporter.sendMail(mailOptions, (err, info) => {
        if (err) {
            console.error("❌ ERROR BREVO:", err.message);
            return res.status(500).json({ 
                success: false, 
                message: "Koneksi Email Gagal! Cek Logs Railway." 
            });
        }
        console.log("✅ EMAIL TERKIRIM VIA BREVO:", info.response);
        res.json({ success: true, message: "Instruksi dikirim ke email " + email });
    });
});

app.post('/admin/tambah-token', (req, res) => {
    if (req.session.userId !== "Versacy") return res.status(403).json({ success: false });
    const { emailTarget, jumlahToken } = req.body;
    const user = users.find(u => u.email === emailTarget);
    if (user) {
        user.quota += parseInt(jumlahToken);
        res.json({ success: true, message: `Token ditambahkan ke ${emailTarget}` });
    } else {
        res.status(404).json({ success: false, message: "User tidak ditemukan!" });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

// --- BAGIAN KOREKSI AI ---
app.post('/ai/proses-koreksi', upload.array('foto'), async (req, res) => {
    try {
        if (!req.session.userId) return res.status(401).json({ success: false, message: "Silakan login dulu!" });
        const user = users.find(u => u.email === req.session.userId);

        if (!user.isPremium && user.quota < req.files.length) {
            return res.json({ 
                success: false, 
                limitReached: true, 
                message: "MAAF TOKEN ANDA HABIS\nsilahkan\nHubungi Admin\nWhatsapp 082240400388" 
            });
        }

        const settings = JSON.parse(req.body.data);
        const kunciPG = settings.kunci_pg;
        const kunciES = settings.kunci_essay;
        let namaTerakhir = "Tidak Terbaca"; 
        const results = [];

        for (const file of req.files) {
            const base64 = file.buffer.toString("base64");
            const response = await groq.chat.completions.create({
                "model": "meta-llama/llama-4-scout-17b-16e-instruct",
                "messages": [{
                    "role": "user",
                    "content": [
                        { "type": "text", "text": `Tugas Guru AI: Cari Nama Siswa. Deteksi tanda silang (X). Bandingkan dengan kunci guru: ${JSON.stringify(kunciPG)}. Analisa essay: ${JSON.stringify(kunciES)}. Output JSON: {"nama_siswa": "", "jawaban_pg_terdeteksi": {"1": "A"}, "essay_detail": [{"no": 1, "betul": true}]}` },
                        { "type": "image_url", "image_url": { "url": `data:image/jpeg;base64,${base64}` } }
                    ]
                }],
                "response_format": { "type": "json_object" },
                "temperature": 0
            });

            const aiData = JSON.parse(response.choices[0].message.content);
            if (aiData.nama_siswa && aiData.nama_siswa.toUpperCase() !== "KOSONG") {
                namaTerakhir = aiData.nama_siswa;
            }

            let pg_betul_list = [];
            for (let n in kunciPG) {
                if (aiData.jawaban_pg_terdeteksi && aiData.jawaban_pg_terdeteksi[n] === kunciPG[n]) {
                    pg_betul_list.push(parseInt(n));
                }
            }
            pg_betul_list.sort((a, b) => a - b);

            let es_betul_list = [];
            let es_betul_count = 0;
            if (aiData.essay_detail) {
                aiData.essay_detail.forEach(e => { 
                    if(e.betul) {
                        es_betul_count++;
                        es_betul_list.push(e.no);
                    }
                });
            }

            results.push({
                nama: namaTerakhir,
                pg_betul: pg_betul_list.length,
                pg_total: Object.keys(kunciPG).length,
                pg_salah: Object.keys(kunciPG).length - pg_betul_list.length,
                list_pg_betul: pg_betul_list,
                es_betul: es_betul_count,
                es_total: Object.keys(kunciES).length,
                list_es_betul: es_betul_list,
                es_detail: aiData.essay_detail || []
            });
        }

        if (!user.isPremium) user.quota -= req.files.length;

        res.json({ 
            success: true, 
            data: results, 
            current_token: user.isPremium ? "UNLIMITED" : user.quota 
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/ai/hitung-rumus', (req, res) => {
    const { data, rumus_pg, rumus_es } = req.body;
    const hasil = data.map(s => {
        const hitung = (rumus, betul, total) => {
            try {
                if(!rumus) return 0;
                let f = rumus.toLowerCase().replace(/betul/g, betul).replace(/total/g, total).replace(/x/g, '*');
                return eval(f.replace(/[^0-9+\-*/().]/g, '')) || 0;
            } catch (e) { return 0; }
        };
        const nPG = hitung(rumus_pg, s.pg_betul, s.pg_total);
        const nES = hitung(rumus_es, s.es_betul, s.es_total);
        return { ...s, nilai_akhir: Math.round((nPG + nES) * 10) / 10 };
    });
    res.json({ success: true, hasil });
});

app.listen(port, () => console.log(`🚀 Server Berjalan di Port ${port}`));
