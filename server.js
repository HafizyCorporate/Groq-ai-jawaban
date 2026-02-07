const express = require('express');
const router = express.Router();
const Groq = require("groq-sdk");
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

router.post('/proses-koreksi', async (req, res) => {
    try {
        const settings = JSON.parse(req.body.data);
        const results = await Promise.all(req.files.map(async (file) => {
            const base64Image = file.buffer.toString("base64");
            const totalSoalPG = Object.keys(settings.kunci_pg).length;

            const response = await groq.chat.completions.create({
                "model": "meta-llama/llama-4-maverick-17b-128e-instruct",
                "messages": [
                    {
                        "role": "system",
                        "content": "Anda adalah Jawaban AI. Dilarang mengarang nama. Gunakan angka kaku dalam menghitung."
                    },
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": `INSTRUKSI KETAT:
                                1. CARI NAMA: Cari tulisan tangan nama. Jika kosong, tulis "Siswa Tanpa Nama". (JANGAN MENGARANG NAMA).
                                2. KOREKSI PG: Gunakan kunci ${JSON.stringify(settings.kunci_pg)}. Hanya hitung soal yang ada di kunci. Teliti silang paling tebal.
                                3. KOREKSI ESSAY: Gunakan kunci ${JSON.stringify(settings.kunci_essay)}.
                                4. HITUNG RUMUS:
                                   - Rumus PG: "${settings.rumus_pg}"
                                   - Rumus Essay: "${settings.rumus_essay}"
                                   - Definisikan kata "betul" sebagai jumlah jawaban benar.
                                   - Definisikan kata "total" sebagai angka ${totalSoalPG}.
                                
                                HASIL WAJIB JSON:
                                {
                                    "nama": "...",
                                    "pg_betul": 0, "pg_salah": 0, "skor_pg_hasil": 0,
                                    "essay_betul": 0, "essay_salah": 0, "skor_essay_hasil": 0,
                                    "nilai_akhir": 0
                                }`
                            },
                            {
                                "type": "image_url",
                                "image_url": { "url": `data:image/jpeg;base64,${base64Image}` }
                            }
                        ]
                    }
                ],
                "temperature": 0,
                "response_format": { "type": "json_object" }
            });
            return JSON.parse(response.choices[0].message.content);
        }));
        res.json({ success: true, data: results });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

module.exports = router;
