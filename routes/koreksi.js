const Groq = require("groq-sdk");
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

exports.prosesKoreksi = async (req, res) => {
    try {
        const settings = JSON.parse(req.body.data);
        
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ success: false, message: "Unggah gambar terlebih dahulu" });
        }

        const results = await Promise.all(req.files.map(async (file) => {
            const base64Image = file.buffer.toString("base64");

            // Menggunakan Model Maverick 17B via Groq
            const response = await groq.chat.completions.create({
                "model": "meta-llama/llama-4-maverick-17b-128e-instruct",
                "messages": [
                    {
                        "role": "system",
                        "content": "Anda adalah pakar koreksi ujian. Tugas Anda mengekstrak data dari lembar jawaban dengan akurasi 100%."
                    },
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": `INSTRUKSI KHUSUS PEMERIKSAAN:
                                1. IDENTIFIKASI NAMA: Temukan nama siswa di lembar soal.
                                
                                2. KOREKSI PILIHAN GANDA (PG):
                                   - Gunakan Kunci ini: ${JSON.stringify(settings.kunci_pg)}.
                                   - PENTING: Periksa HANYA nomor yang ada di kunci tersebut. Jika kunci hanya soal 1-15, abaikan soal 16-20 meskipun siswa mengisinya.
                                   - DETEKSI PENGHAPUS: Jika ada dua silang (X) pada satu nomor, bandingkan kepekatannya. Pilih yang paling hitam/tebal sebagai jawaban sah. Yang pudar dianggap bekas hapusan.

                                3. KOREKSI ESSAY:
                                   - Gunakan Kunci ini: ${JSON.stringify(settings.kunci_essay)}.
                                   - Berikan poin jika jawaban siswa mengandung inti/kata kunci yang sesuai.

                                4. KALKULASI SKOR TERPISAH:
                                   - PG_BETUL & PG_SALAH: Hitung berdasarkan kunci.
                                   - ESSAY_BETUL & ESSAY_SALAH: Hitung berdasarkan kunci.
                                   - SKOR_PG: Terapkan rumus [${settings.rumus_pg}] (Ganti variabel 'PG' dengan jumlah benar).
                                   - SKOR_ESSAY: Terapkan rumus [${settings.rumus_essay}] (Ganti variabel 'Essay' dengan jumlah benar).
                                   - NILAI_AKHIR: Skor_PG + Skor_Essay.

                                FORMAT OUTPUT WAJIB JSON:
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
        res.status(500).json({ success: false, message: "AI Maverick gagal memproses" });
    }
};
