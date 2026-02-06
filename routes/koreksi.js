const express = require('express');
const router = express.Router();
const multer = require('multer');
const { Groq } = require('groq-sdk');
const db = require('../db');

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage: storage });
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

router.post('/proses-koreksi', upload.array('foto_tugas', 5), async (req, res) => {
    try {
        const { rumus_nilai } = req.body;
        
        // Ambil Data dari Dashboard
        let kunciPG = {}; for (let i = 1; i <= 20; i++) { kunciPG[i] = req.body[`pg_${i}`]; }
        let kunciEssay = {}; for (let i = 1; i <= 10; i++) { kunciEssay[i] = req.body[`essay_${i}`]; }

        const instruksiAI = `
        Anda adalah Guru Pengoreksi Digital yang sangat teliti.
        
        TUGAS ANDA:
        1. PG: Cari tanda (X) di atas huruf A, B, C, D. Jika ada tanda samar dan tanda tebal, AMBIL YANG PALING TEBAL. Bandingkan dengan kunci ini: ${JSON.stringify(kunciPG)}.
        2. ESSAY: Bandingkan jawaban siswa dengan inti jawaban yang diketik pembuat soal: ${JSON.stringify(kunciEssay)}. Jika mengandung kata kunci yang sama, nyatakan BETUL.
        3. HITUNG: Gunakan rumus "${rumus_nilai}" (PG=total betul PG, Essay=total betul Essay).
        
        FORMAT OUTPUT HARUS JSON ARRAY:
        [{ "nama": "Nama Siswa", "pg_betul": 0, "pg_salah": 0, "essay_betul": 0, "essay_salah": 0, "nilai_akhir": 0 }]`;

        const response = await groq.chat.completions.create({
            messages: [
                { role: "system", content: "Hanya berikan JSON Array tanpa penjelasan." },
                { role: "user", content: instruksiAI }
            ],
            model: "llama-3.2-11b-vision-preview",
        });

        const hasil = JSON.parse(response.choices[0].message.content);

        // Simpan ke DB jika user login
        if (req.session.user) {
            hasil.forEach(s => {
                db.run(`INSERT INTO history_koreksi (user_id, hasil_koreksi, skor_total) VALUES (?, ?, ?)`, 
                [req.session.user.id, JSON.stringify(s), s.nilai_akhir]);
            });
        }

        res.json({ success: true, data: hasil });
    } catch (e) {
        res.status(500).json({ error: "Gagal memproses AI" });
    }
});

module.exports = router;
