const express = require('express');
const multer = require('multer');
const path = require('path');
const dotenv = require('dotenv');
const Groq = require("groq-sdk");
const bcrypt = require('bcrypt'); // Tambahan untuk Auth
const nodemailer = require('nodemailer'); // Tambahan untuk Email
const session = require('express-session'); // Tambahan untuk Session

dotenv.config();
const app = express();
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const port = process.env.PORT || 3000;

// --- BAGIAN BARU: MIDDLEWARE & DATABASE ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Setup Session agar login tersimpan
app.use(session({
    secret: 'kunci-rahasia-llama4',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// Simulasi database user
let users = []; 

// FUNGSI BUAT ADMIN OTOMATIS SAAT SERVER JALAN
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

// --- BAGIAN BARU: AUTH ROUTES ---

app.post('/auth/register', async (req, res) => {
    try {
        const { email, password } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        users.push({ 
            email, 
            password: hashedPassword, 
            quota: 1, 
            isPremium: false 
        });
        res.json({ success: true, message: "Pendaftaran Berhasil! Jatah gratis: 1x Koreksi." });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/auth/login', async (req, res) => {
    const { email, password } = req.body;
    const user = users.find(u => u.email === email);
    if (user && await bcrypt.compare(password, user.password)) {
        req.session.userId = email; 
        // --- TAMBAHAN: KIRIM TOKEN SAAT LOGIN ---
        res.json({ 
            success: true, 
            token: user.isPremium ? "UNLIMITED" : user.quota 
        });
    } else {
        res.status(401).json({ success: false, message: "Email atau Password Salah!" });
    }
});

app.post('/auth/forgot-password', async (req, res) => {
    const { email } = req.body;
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    });

    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'Reset Password JAWABAN AI',
        text: `Halo, Anda meminta bantuan akses untuk email ${email}. Silakan gunakan kode sementara: 123456 atau hubungi admin Versacy.`
    };

    transporter.sendMail(mailOptions, (err) => {
        if (err) return res.status(500).json({ success: false, message: "Gagal kirim email" });
        res.json({ success: true, message: "Instruksi pemulihan telah dikirim ke email " + email });
    });
});

// --- ROUTE KHUSUS ADMIN TAMBAH TOKEN ---

app.post('/admin/tambah-token', (req, res) => {
    if (req.session.userId !== "Versacy") {
        return res.status(403).json({ success: false, message: "Akses Ditolak!" });
    }

    const { emailTarget, jumlahToken } = req.body;
    const user = users.find(u => u.email === emailTarget);

    if (user) {
        user.quota += parseInt(jumlahToken);
        res.json({ 
            success: true, 
            message: `Berhasil! ${jumlahToken} token ditambahkan ke ${emailTarget}. Total sekarang: ${user.quota}` 
        });
    } else {
        res.status(404).json({ success: false, message: "User tidak ditemukan!" });
    }
});

// --- LOGIKA KOREKSI DENGAN PEMBATASAN TOKEN ---

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

app.post('/ai/proses-koreksi', upload.array('foto'), async (req, res) => {
    try {
        if (!req.session.userId) return res.status(401).json({ success: false, message: "Silakan login dulu!" });

        const user = users.find(u => u.email === req.session.userId);

        // CEK TOKEN (1 Foto = 1 Token)
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
                        { 
                            "type": "text", 
                            "text": `Tugas Guru AI: Cari Nama Siswa (Jika tidak ada nama di lembar ini, tulis "KOSONG"). Deteksi tanda silang (X) pada pilihan A,B,C, atau D (Nomor 1-20). Bandingkan dengan kunci guru: ${JSON.stringify(kunciPG)}. Analisa essay dengan kunci: ${JSON.stringify(kunciES)}. Output format JSON: {"nama_siswa": "", "jawaban_pg_terdeteksi": {"1": "A"}, "essay_detail": [{"no": 1, "betul": true, "alasan": "..."}]}` 
                        },
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
                if (aiData.jawaban_pg_terdeteksi[n] === kunciPG[n]) {
                    pg_betul_list.push(n);
                }
            }

            let es_betul = 0;
            if (aiData.essay_detail) {
                aiData.essay_detail.forEach(e => { if(e.betul) es_betul++; });
            }

            results.push({
                nama: namaTerakhir,
                pg_betul: pg_betul_list.length,
                pg_total: Object.keys(kunciPG).length,
                pg_salah: Object.keys(kunciPG).length - pg_betul_list.length,
                pg_list_nomor: pg_betul_list.length > 0 ? pg_betul_list.join(", ") : "Tidak ada yang betul", 
                es_betul,
                es_total: Object.keys(kunciES).length,
                es_salah: Object.keys(kunciES).length - es_betul,
                es_detail: aiData.essay_detail || []
            });
        }

        // --- UPDATE TOKEN (1 foto = 1 token) ---
        if (!user.isPremium) {
            user.quota -= req.files.length;
        }

        // --- KIRIM RESPON DENGAN SISA TOKEN TERBARU (current_token) ---
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

app.listen(port, () => console.log(`Server Ready on Port ${port}`));
