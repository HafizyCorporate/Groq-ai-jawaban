const express = require('express');
const router = express.Router();
const Groq = require("groq-sdk");
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

router.post('/proses-koreksi', async (req, res) => {
    try {
        const settings = JSON.parse(req.body.data);
        const results = await Promise.all(req.files.map(async (file) => {
            const base64Image = file.buffer.toString("base64");

            const response = await groq.chat.completions.create({
                "model": "meta-llama/llama-4-maverick-17b-128e-instruct",
                "messages": [
                    {
                        "role": "system",
                        "content": "Anda adalah mesin Jawaban AI. Tugas Anda mengekstrak Nama dan mengoreksi jawaban siswa."
                    },
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": `INSTRUKSI:
                                1. Cari Nama Siswa.
                                2. Koreksi PG kunci: ${JSON.stringify(settings.kunci_pg)}. (Hanya hitung yang ada di kunci).
                                3. Koreksi Essay kunci: ${JSON.stringify(settings.kunci_essay)}.
                                4. Hitung PG_BETUL, PG_SALAH, ESSAY_BETUL, ESSAY_SALAH.
                                5. Hitung SKOR_PG_HASIL dengan rumus: ${settings.rumus_pg}.
                                6. Hitung SKOR_ESSAY_HASIL dengan rumus: ${settings.rumus_essay}.
                                7. NILAI_AKHIR = SKOR_PG_HASIL + SKOR_ESSAY_HASIL.

                                OUTPUT WAJIB JSON:
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
                "temperature": 0.1,
                "response_format": { "type": "json_object" }
            });
            return JSON.parse(response.choices[0].message.content);
        }));
        res.json({ success: true, data: results });
    } catch (error) {
        console.error("AI Error:", error);
        res.status(500).json({ success: false, message: "AI gagal memproses gambar." });
    }
});

module.exports = router;
