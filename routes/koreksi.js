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
                        "content": "Anda adalah mesin Jawaban AI. Fokus pada Nama, PG (abaikan bekas hapusan pudar), dan Essay sesuai kunci yang diberikan saja."
                    },
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": `INSTRUKSI KERJA JAWABAN AI:
                                1. Ekstrak Nama Murid.
                                2. Periksa PG dengan Kunci: ${JSON.stringify(settings.kunci_pg)}. 
                                   - Teliti bekas penghapus! Hanya hitung silang yang paling HITAM dan TEBAL.
                                   - Abaikan nomor soal yang tidak ada di kunci ini.
                                3. Periksa Essay dengan Kunci: ${JSON.stringify(settings.kunci_essay)}.
                                4. Hitung PG_BETUL, PG_SALAH, ESSAY_BETUL, ESSAY_SALAH.
                                5. Gunakan Rumus PG: ${settings.rumus_pg} & Rumus Essay: ${settings.rumus_essay}.
                                6. Nilai_Akhir = Hasil Skor PG + Hasil Skor Essay.
                                BALAS HANYA JSON.`
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
        console.error("Maverick Error:", error);
        res.status(500).json({ success: false });
    }
});

module.exports = router;
