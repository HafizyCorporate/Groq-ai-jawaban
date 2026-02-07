const express = require('express');
const router = express.Router();
const Groq = require("groq-sdk");
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// TAHAP 1: KOREKSI FOTO (PG & Essay)
router.post('/proses-koreksi', async (req, res) => {
    try {
        const settings = JSON.parse(req.body.data);
        
        // Hanya ambil kunci yang diisi oleh pembuat (yang kosong dibuang)
        const kunciPG = Object.fromEntries(Object.entries(settings.kunci_pg).filter(([_, v]) => v !== ""));
        const kunciES = Object.fromEntries(Object.entries(settings.kunci_essay).filter(([_, v]) => v !== ""));

        const results = await Promise.all(req.files.map(async (file) => {
            const base64 = file.buffer.toString("base64");

            const response = await groq.chat.completions.create({
                "model": "meta-llama/llama-4-maverick-17b-128e-instruct",
                "messages": [{
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": `TUGAS: Koreksi lembar jawaban ini.
                            1. PG: Cocokkan silang siswa dengan Kunci: ${JSON.stringify(kunciPG)}. (Abaikan jika kunci tidak ada).
                            2. ESSAY: Periksa jawaban siswa dengan Kunci: ${JSON.stringify(kunciES)}. (Abaikan jika kunci tidak ada).
                            3. NAMA: Cari nama siswa di kertas.
                            
                            OUTPUT WAJIB JSON:
                            {
                                "nama": "...",
                                "pg_betul": 0, 
                                "pg_total": ${Object.keys(kunciPG).length},
                                "es_betul": 0,
                                "es_total": ${Object.keys(kunciES).length}
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

// TAHAP 2: HITUNG RUMUS (PG & Essay Masuk Sini)
router.post('/hitung-rumus', async (req, res) => {
    try {
        const { data, rumus_pg, rumus_es } = req.body;
        const finalResults = data.map(s => {
            const hitung = (rumus, betul, total) => {
                try {
                    if(!rumus) return 0;
                    // AI mengganti kata 'betul' dan 'total' dengan angka asli
                    let expr = rumus.toLowerCase()
                                    .replace(/betul/g, betul)
                                    .replace(/total/g, total)
                                    .replace(/x/g, '*');
                    expr = expr.replace(/[^0-9+\-*/().]/g, ''); 
                    return eval(expr) || 0;
                } catch (e) { return 0; }
            };

            const skorPG = hitung(rumus_pg, s.pg_betul, s.pg_total);
            const skorES = hitung(rumus_es, s.es_betul, s.es_total);

            // Pembulatan 1 Desimal (Sesuai Perintah: 3.21 -> 3.2 | 3.26 -> 3.3)
            const totalNilai = Math.round((skorPG + skorES) * 10) / 10;

            return { ...s, nilai_akhir: totalNilai };
        });
        res.json({ success: true, hasil: finalResults });
    } catch (err) { res.status(500).json({ success: false }); }
});

module.exports = router;
