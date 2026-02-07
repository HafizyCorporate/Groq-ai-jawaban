const express = require('express');
const router = express.Router();
const Groq = require("groq-sdk");
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// PROSES 1: Koreksi Gambar
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
                            "text": `TUGAS KOREKSI:
                            1. Nama: Ambil dari kertas, jangan mengarang.
                            2. PG: Kunci ${JSON.stringify(settings.kunci_pg)}.
                            3. Essay: Kunci ${JSON.stringify(settings.kunci_essay)}.
                            4. Essay Salah: Jelaskan singkat di bagian mana siswa salah (misal: Kurang lengkap, salah konsep, dll).
                            
                            OUTPUT JSON:
                            {
                                "nama": "...",
                                "total_pg_soal": ${totalPG},
                                "pg_betul": 0, "pg_salah": 0,
                                "essay_betul": 0, "essay_salah": 0,
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

// PROSES 2: Hitung Rumus Pembuat + Pembulatan Khusus
router.post('/hitung-rumus', async (req, res) => {
    const { data, rumus_pg, rumus_es } = req.body;
    
    const hasilHitung = data.map(s => {
        // Fungsi evaluasi rumus teks menjadi angka
        const hitung = (rumus, betul, total) => {
            try {
                // Ganti kata 'betul' dan 'total' dengan angka asli
                let ekspresi = rumus.toLowerCase().replace(/betul/g, betul).replace(/total/g, total);
                // Ganti kata 'poin' atau '%' jika ada agar tidak error
                ekspresi = ekspresi.replace(/poin|%|presentase/g, '');
                return eval(ekspresi);
            } catch (e) { return 0; }
        };

        const skorPG = hitung(rumus_pg, s.pg_betul, s.total_pg_soal);
        const skorES = hitung(rumus_es, s.essay_betul, 5);

        // LOGIKA PEMBULATAN SESUAI PERINTAH ANDA:
        // Dibawah .50 bulatkan ke .x (misal 3.214 jadi 3.2)
        // Diatas .50 bulatkan ke .y (misal 3.260 jadi 3.3)
        const bulatkan = (num) => {
            const factor = 10;
            const rest = (num * 100) % 10;
            if (rest < 5) return Math.floor(num * factor) / factor;
            return Math.ceil(num * factor) / factor;
        };

        const nilaiFinal = bulatkan(skorPG + skorES);

        return { ...s, nilai_akhir: nilaiFinal };
    });

    res.json({ success: true, hasil: hasilHitung });
});

module.exports = router;
