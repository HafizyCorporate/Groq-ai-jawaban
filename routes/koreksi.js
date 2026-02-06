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
                        "content": "Anda adalah mesin koreksi bernama Jawaban AI. Fokus pada Nama, PG (abaikan bekas hapusan), dan Essay."
                    },
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": `Koreksi lembar ini:
                                1. Nama Siswa.
                                2. PG Kunci: ${JSON.stringify(settings.kunci_pg)}. Pilih silang tertebal.
                                3. Essay Kunci: ${JSON.stringify(settings.kunci_essay)}.
                                4. Rumus PG: ${settings.rumus_pg}.
                                5. Rumus Essay: ${settings.rumus_essay}.
                                Hitung total akhir. Balas JSON format saja.`
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
        res.status(500).json({ success: false });
    }
});

module.exports = router;
