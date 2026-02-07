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

// Simulasi database user (Ganti dengan SQLite jika ingin permanen)
let users = []; 

const storage = multer.memoryStorage();
const upload = multer({ storage: storage, limits: { fileSize: 20 * 1024 * 1024 } });

// --- BAGIAN BARU: AUTH ROUTES ---

// Route Daftar
app.post('/auth/register', async (req, res) => {
    try {
        const { email, password } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        users.push({ email, password: hashedPassword });
        res.json({ success: true, message: "Pendaftaran Berhasil!" });
    } catch (e) { res.status(500).json({ success: false }); }
});

// Route Login
app.post('/auth/login', async (req, res) => {
    const { email, password } = req.body;
    const user = users.find(u => u.email === email);
    if (user && await bcrypt.compare(password, user.password)) {
        req.session.userId = email; // Simpan session
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, message: "Email atau Password Salah!" });
    }
});

// Route Lupa Password (Kirim Email)
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
        text: 'Anda meminta reset password. Silakan gunakan kode sementara: 123456'
    };

    transporter.sendMail(mailOptions, (err) => {
        if (err) return res.status(500).json({ success: false, message: "Gagal kirim email" });
        res.json({ success: true, message: "Cek email anda!" });
    });
});

// --- KODE ASLI KAMU (TIDAK DIRUBAH) ---

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

// LOGIKA KOREKSI HYBRID
app.post('/ai/proses-koreksi', upload.array('foto'), async (req, res) => {
    try {
        const settings = JSON.parse(req.body.data);
        const kunciPG = settings.kunci_pg;
        const kunciES = settings.kunci_essay;

        const results = await Promise.all(req.files.map(async (file) => {
            const base64 = file.buffer.toString("base64");
            
            const response = await groq.chat.completions.create({
                "model": "meta-llama/llama-4-scout-17b-16e-instruct",
                "messages": [{
                    "role": "user",
                    "content": [
                        { 
                            "type": "text", 
                            "text": `Tugas Guru AI: Cari Nama Siswa. Deteksi tanda silang (X) MERAH pada pilihan A,B,C, atau D (Nomor 1-20). Bandingkan dengan kunci guru ini: ${JSON.stringify(kunciPG)}. Analisa essay dengan kunci: ${JSON.stringify(kunciES)}. Output format JSON: {"nama_siswa": "", "jawaban_pg_terdeteksi": {"1": "A"}, "skor_essay": {"1": true}}` 
                        },
                        { "type": "image_url", "image_url": { "url": `data:image/jpeg;base64,${base64}` } }
                    ]
                }],
                "response_format": { "type": "json_object" },
                "temperature": 0
            });

            const aiData = JSON.parse(response.choices[0].message.content);
            
            // Hitung manual di server
            let pg_betul = 0;
            let pg_total = Object.keys(kunciPG).length;
            for (let n in kunciPG) {
                if (aiData.jawaban_pg_terdeteksi[n] === kunciPG[n]) pg_betul++;
            }

            let es_betul = 0;
            let es_total = Object.keys(kunciES).length;
            for (let n in aiData.skor_essay) {
                if (aiData.skor_essay[n] === true) es_betul++;
            }

            return {
                nama: aiData.nama_siswa || "Tidak Terbaca",
                pg_betul, pg_total, pg_salah: pg_total - pg_betul,
                es_betul, es_total, es_salah: es_total - es_betul
            };
        }));
        res.json({ success: true, data: results });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/ai/hitung-rumus', (req, res) => {
    const { data, rumus_pg, rumus_es } = req.body;
    const hasil = data.map(s => {
        const hitung = (rumus, betul, total) => {
            try {
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
