const express = require('express');
const router = express.Router();
const Groq = require("groq-sdk");
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

router.post('/proses-koreksi', async (req, res) => {
    try {
        const settings = JSON.parse(req.body.data);
        const kunciPG = Object.fromEntries(Object.entries(settings.kunci_pg).filter(([_, v]) => v !== ""));
        const kunciES = Object.fromEntries(Object.entries(settings.kunci_essay).filter(([_, v]) => v !== ""));

        const results = await Promise.all(req.files.map(async (file) => {
            const base64 = file.buffer.toString("base64");

            const response = await groq.chat.completions.create({
                "model": "meta-llama/llama-3.2-11b-vision-preview", // Pastikan pakai model Vision
                "messages": [{
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": `INSTRUKSI KETAT:
                            1. Lihat gambar lembar soal ini. Cari tanda silang (X) atau coretan berwarna MERAH pada pilihan jawaban A, B, atau C.
                            2. Bandingkan pilihan yang disilang siswa dengan Kunci PG berikut: ${JSON.stringify(kunciPG)}.
                            3. Periksa jawaban tertulis untuk Essay dan bandingkan dengan Kunci Essay: ${JSON.stringify(kunciES)}.
                            4. Cari nama siswa di bagian atas kertas.
                            
                            HASIL HARUS JSON:
                            {
                                "nama": "Nama Siswa yang ditemukan",
                                "pg_betul": (jumlah kecocokan PG),
                                "pg_total": ${Object.keys(kunciPG).length},
                                "es_betul": (jumlah kecocokan Essay),
                                "es_total": ${Object.keys(kunciES).length}
                            }`
                        },
                        { "type": "image_url", "image_url": { "url": `data:image/jpeg;base64,${base64}` } }
                    ]
                }],
                "temperature": 0.1, // Suhu rendah agar AI lebih teliti/kaku
                "response_format": { "type": "json_object" }
            });
            return JSON.parse(response.choices[0].message.content);
        }));
        res.json({ success: true, data: results });
    } catch (err) { res.status(500).json({ success: false }); }
});

router.post('/hitung-rumus', async (req, res) => {
    try {
        const { data, rumus_pg, rumus_es } = req.body;
        const finalResults = data.map(s => {
            const hitung = (rumus, betul, total) => {
                try {
                    if(!rumus) return 0;
                    let expr = rumus.toLowerCase()
                                    .replace(/betul/g, betul)
                                    .replace(/total/g, total)
                                    .replace(/x/g, '*');
                    expr = expr.replace(/[^0-9+\-*/().]/g, ''); 
                    return eval(expr) || 0;
                } catch (e) { return 0; }
            };

            const nPG = hitung(rumus_pg, s.pg_betul, s.pg_total);
            const nES = hitung(rumus_es, s.es_betul, s.es_total);
            return { ...s, nilai_akhir: Math.round((nPG + nES) * 10) / 10 };
        });
        res.json({ success: true, hasil: finalResults });
    } catch (err) { res.status(500).json({ success: false }); }
});

module.exports = router;
