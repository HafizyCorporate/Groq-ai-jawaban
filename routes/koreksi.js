const express = require('express');
const router = express.Router();
const Groq = require("groq-sdk");
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// PROSES 1: KOREKSI GAMBAR
router.post('/proses-koreksi', async (req, res) => {
    try {
        const settings = JSON.parse(req.body.data);
        const results = await Promise.all(req.files.map(async (file) => {
            const base64 = file.buffer.toString("base64");
            const totalPG = Object.keys(settings.kunci_pg).length;

            const response = await groq.chat.completions.create({
                "model": "meta-llama/llama-4-maverick-17b-128e-instruct",
                "messages": [{
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": `TUGAS: Periksa lembar jawaban ini.
                            1. NAMA: Cari nama di kertas. Jika tidak ada tulis "Siswa Tanpa Nama". (JANGAN NGARANG).
                            2. PG: Bandingkan silang/coretan (merah/hitam) dengan Kunci: ${JSON.stringify(settings.kunci_pg)}.
                            3. ESSAY: Gunakan Kunci: ${JSON.stringify(settings.kunci_essay)}. Jika tidak ada essay di gambar, beri skor 0.
                            4. DETAIL: Jelaskan singkat jika essay salah.
                            
                            HASIL WAJIB JSON:
                            {
                                "nama": "...",
                                "pg_betul": 0, "pg_salah": 0, "total_pg_soal": ${totalPG},
                                "essay_betul": 0, "essay_salah": 0, "total_essay_soal": 5,
                                "penjelasan_essay_salah": "..."
                            }`
                        },
                        { "type": "image_url", "image_url": { "url": `data:image/jpeg;base64,${base64}` } }
                    ]
                }],
                "temperature": 0,
                "response_format": { "type": "json_object" }
            });
            return JSON.parse(response.choices[0].message.content);
        }));
        res.json({ success: true, data: results });
    } catch (err) { res.status(500).json({ success: false }); }
});

// PROSES 2: HITUNG RUMUS & PEMBULATAN KHUSUS
router.post('/hitung-rumus', async (req, res) => {
    try {
        const { data, rumus_pg, rumus_es } = req.body;
        const hasil = data.map(s => {
            const evalRumus = (rumus, betul, total) => {
                try {
                    let expr = rumus.toLowerCase().replace(/betul/g, betul).replace(/total/g, total);
                    expr = expr.replace(/[^0-9+\-*/().]/g, ''); 
                    return eval(expr) || 0;
                } catch (e) { return 0; }
            };

            const skPG = evalRumus(rumus_pg, s.pg_betul, s.total_pg_soal);
            const skES = evalRumus(rumus_es, s.essay_betul, 5);

            // PEMBULATAN KHUSUS: < .50 turun, >= .50 naik ke 0.1 terdekat
            const bulatkan = (n) => {
                const step = (n * 100) % 10;
                return step < 5 ? Math.floor(n * 10) / 10 : Math.ceil(n * 10) / 10;
            };

            return { ...s, nilai_akhir: bulatkan(skPG + skES) };
        });
        res.json({ success: true, hasil });
    } catch (err) { res.status(500).json({ success: false }); }
});

module.exports = router;
