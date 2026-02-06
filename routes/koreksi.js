const express = require('express');
const router = express.Router();
const Groq = require("groq-sdk");

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Rute: /ai/proses-koreksi
router.post('/proses-koreksi', async (req, res) => {
    try {
        if (!req.body.data) return res.status(400).json({ success: false, message: "Konfigurasi kosong" });
        const settings = JSON.parse(req.body.data);
        
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ success: false, message: "Gambar tidak ditemukan" });
        }

        const results = await Promise.all(req.files.map(async (file) => {
            const base64Image = file.buffer.toString("base64");

            // Menggunakan Model Maverick 17B
            const response = await groq.chat.completions.create({
                "model": "meta-llama/llama-4-maverick-17b-128e-instruct",
                "messages": [
                    {
                        "role": "system",
                        "content": "Anda adalah asisten koreksi ujian profesional. Tugas Anda mengekstrak Nama dan mengoreksi jawaban dengan akurasi maksimal."
                    },
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": `INSTRUKSI KOREKSI:
                                1. NAMA: Cari nama siswa di lembar soal.
                                2. PG (Pilihan Ganda): Koreksi menggunakan kunci ${JSON.stringify(settings.kunci_pg)}. 
                                   - Penting: Abaikan nomor yang tidak ada di kunci. 
                                   - Jika ada dua silang, pilih yang paling hitam pekat (abaikan bekas hapusan pudar).
                                3. ESSAY: Koreksi menggunakan kunci ${JSON.stringify(settings.kunci_essay)}.
                                4. KALKULASI:
                                   - Skor_PG = Hitung jumlah PG benar dengan rumus: ${settings.rumus_pg}.
                                   - Skor_Essay = Hitung jumlah Essay benar dengan rumus: ${settings.rumus_essay}.
                                   - Nilai_Akhir = Skor_PG + Skor_Essay.

                                KELUARKAN HANYA JSON:
                                {
                                    "nama": "...",
                                    "pg_betul": 0, "pg_salah": 0,
                                    "essay_betul": 0, "essay_salah": 0,
                                    "skor_pg_hasil": 0, "skor_essay_hasil": 0,
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
        console.error("Maverick Error:", error);
        res.status(500).json({ success: false, message: "AI Maverick gagal memproses gambar" });
    }
});

module.exports = router;
