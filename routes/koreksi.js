const Groq = require("groq-sdk");
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Gunakan exports.prosesKoreksi agar bisa dipanggil sebagai fungsi spesifik
exports.prosesKoreksi = async (req, res) => {
    try {
        // Cek input data
        if (!req.body.data) {
            return res.status(400).json({ success: false, message: "Konfigurasi kunci jawaban kosong" });
        }
        
        const settings = JSON.parse(req.body.data);
        
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ success: false, message: "Tidak ada gambar yang diunggah" });
        }

        const results = await Promise.all(req.files.map(async (file) => {
            const base64Image = file.buffer.toString("base64");

            // Pemanggilan Model Maverick 17B
            const response = await groq.chat.completions.create({
                "model": "meta-llama/llama-4-maverick-17b-128e-instruct",
                "messages": [
                    {
                        "role": "system",
                        "content": "Anda adalah asisten koreksi ujian profesional. Tugas Anda mengekstrak Nama dan mengoreksi jawaban dengan presisi tinggi."
                    },
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": `INSTRUKSI KOREKSI:
                                1. Cari NAMA SISWA di lembar soal.
                                2. Koreksi PG menggunakan kunci: ${JSON.stringify(settings.kunci_pg)}. 
                                   - Abaikan soal yang kuncinya kosong.
                                   - Jika ada coretan ganda, pilih yang paling hitam/tebal (abaikan bekas hapusan).
                                3. Koreksi ESSAY menggunakan kunci: ${JSON.stringify(settings.kunci_essay)}.
                                4. Hitung PG_BETUL, PG_SALAH, ESSAY_BETUL, ESSAY_SALAH.
                                5. Hitung Skor_PG dengan rumus: ${settings.rumus_pg}.
                                6. Hitung Skor_Essay dengan rumus: ${settings.rumus_essay}.
                                7. NILAI_AKHIR = Skor_PG + Skor_Essay.

                                BALAS HANYA DALAM FORMAT JSON:
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
        res.status(500).json({ success: false, message: "Gagal memproses gambar" });
    }
};
