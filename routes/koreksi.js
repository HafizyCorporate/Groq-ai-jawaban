const express = require('express');
const router = express.Router();
const Groq = require("groq-sdk");
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

router.post('/proses-koreksi', async (req, res) => {
    try {
        const settings = JSON.parse(req.body.data);
        const kunciPG = Object.fromEntries(Object.entries(settings.kunci_pg).filter(([_, v]) => v !== ""));
        
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ success: false, message: "Foto belum dipilih!" });
        }

        const results = await Promise.all(req.files.map(async (file) => {
            const base64 = file.buffer.toString("base64");

            const response = await groq.chat.completions.create({
                // MENGGUNAKAN MODEL LLAMA 4 MAVERICK SESUAI PERMINTAAN
                "model": "meta-llama/llama-4-maverick-17b-128e-instruct",
                "messages": [{
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": `TUGAS KOREKSI: 
                            1. Cari Nama Siswa di bagian atas kertas.
                            2. Deteksi tanda silang (X) atau coretan berwarna MERAH pada pilihan jawaban.
                            3. Bandingkan dengan Kunci PG: ${JSON.stringify(kunciPG)}.
                            4. Bandingkan dengan Kunci Essay: ${JSON.stringify(settings.kunci_essay)}.
                            
                            WAJIB BERIKAN OUTPUT JSON:
                            {
                                "nama": "Nama Siswa",
                                "pg_betul": 0,
                                "pg_total": ${Object.keys(kunciPG).length},
                                "es_betul": 0,
                                "es_total": 5
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
    } catch (err) {
        console.error("Gagal pake Llama 4:", err);
        res.status(500).json({ success: false, message: "Model Llama 4 gagal merespon." });
    }
});

router.post('/hitung-rumus', async (req, res) => {
    try {
        const { data, rumus_pg, rumus_es } = req.body;
        const hasilFinal = data.map(s => {
            const hitung = (rumus, betul, total) => {
                if(!rumus) return 0;
                try {
                    let f = rumus.toLowerCase()
                                .replace(/betul/g, betul)
                                .replace(/total/g, total)
                                .replace(/x/g, '*');
                    f = f.replace(/[^0-9+\-*/().]/g, ''); 
                    return eval(f) || 0;
                } catch (e) { return 0; }
            };

            const nPG = hitung(rumus_pg, s.pg_betul, s.pg_total);
            const nES = hitung(rumus_es, s.es_betul, s.es_total);
            // Pembulatan 1 angka di belakang koma
            return { ...s, nilai_akhir: Math.round((nPG + nES) * 10) / 10 };
        });
        res.json({ success: true, hasil: hasilFinal });
    } catch (err) { res.status(500).json({ success: false }); }
});

module.exports = router;
