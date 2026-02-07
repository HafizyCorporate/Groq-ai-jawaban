const express = require('express');
const router = express.Router();
const Groq = require("groq-sdk");
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

router.post('/proses-koreksi', async (req, res) => {
    try {
        const settings = JSON.parse(req.body.data);
        const kunciPG = Object.fromEntries(Object.entries(settings.kunci_pg).filter(([_, v]) => v !== ""));
        
        // Cek jika tidak ada file yang diunggah
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ success: false, message: "Tidak ada foto" });
        }

        const results = await Promise.all(req.files.map(async (file) => {
            const base64 = file.buffer.toString("base64");

            const response = await groq.chat.completions.create({
                "model": "meta-llama/llama-3.2-11b-vision-preview",
                "messages": [{
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": `Tugas: Koreksi lembar soal ini.
                            1. Identifikasi Nama Siswa di bagian atas.
                            2. Cari tanda silang (X) berwarna MERAH. Jika ada coretan merah pada opsi (A, B, atau C), itulah jawaban siswa.
                            3. Bandingkan dengan Kunci Jawaban ini: ${JSON.stringify(kunciPG)}.
                            4. Hitung berapa yang cocok (betul).
                            
                            Output harus JSON murni:
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
        console.error("Error AI:", err);
        res.status(500).json({ success: false, message: err.message });
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
            return { ...s, nilai_akhir: Math.round((nPG + nES) * 10) / 10 };
        });
        res.json({ success: true, hasil: hasilFinal });
    } catch (err) { res.status(500).json({ success: false }); }
});

module.exports = router;
