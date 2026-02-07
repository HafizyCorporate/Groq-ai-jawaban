const express = require('express');
const router = express.Router();
const Groq = require("groq-sdk");
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

router.post('/proses-koreksi', async (req, res) => {
    try {
        const settings = JSON.parse(req.body.data);
        
        // Ambil Kunci Jawaban yang Valid (Hapus yang kosong)
        const kunciPG = settings.kunci_pg;
        const kunciES = settings.kunci_essay;

        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ success: false, message: "Foto wajib diupload!" });
        }

        const results = await Promise.all(req.files.map(async (file) => {
            const base64 = file.buffer.toString("base64");

            // TAHAP 1: AI CUMA BACA JAWABAN (JANGAN HITUNG NILAI DULU)
            const response = await groq.chat.completions.create({
                "model": "llama-3.2-90b-vision-preview", // Wajib Vision agar bisa lihat coretan merah
                "messages": [{
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": `TUGAS VISION (PENTING):
                            1. Lihat gambar lembar ujian ini.
                            2. Baca "Nama Siswa" di bagian atas.
                            3. Deteksi pilihan ganda (Nomor 1 sd 20) yang disilang/dicoret warna MERAH atau HITAM.
                            4. Ekstrak jawaban siswa untuk setiap nomor.
                            
                            OUTPUT JSON MURNI:
                            {
                                "nama_siswa": "Teks nama yang terbaca",
                                "jawaban_terbaca": {
                                    "1": "A",
                                    "2": "C",
                                    "3": "B"
                                    ... (lanjutkan sesuai yang terlihat)
                                },
                                "essay_terbaca": "Ringkasan jawaban essay siswa jika ada"
                            }`
                        },
                        { "type": "image_url", "image_url": { "url": `data:image/jpeg;base64,${base64}` } }
                    ]
                }],
                "temperature": 0,
                "response_format": { "type": "json_object" }
            });

            const hasilAI = JSON.parse(response.choices[0].message.content);
            const jawabanSiswa = hasilAI.jawaban_terbaca || {};

            // TAHAP 2: CODINGAN YANG MENGHITUNG NILAI (LEBIH AKURAT DARI AI)
            let pg_betul = 0;
            let pg_total_kunci = 0;

            // Loop semua kunci jawaban yang dibuat Guru
            for (const [no, kunci] of Object.entries(kunciPG)) {
                if (kunci && kunci !== "") {
                    pg_total_kunci++;
                    // Bandingkan Jawaban AI (Upper) vs Kunci Guru (Upper)
                    const jwbSiswa = (jawabanSiswa[no] || "").toUpperCase();
                    const jwbGuru = kunci.toUpperCase();
                    
                    if (jwbSiswa === jwbGuru) {
                        pg_betul++;
                    }
                }
            }
            
            // Essay sementara kita anggap AI yang menilai kontennya (karena subjektif)
            // Atau untuk saat ini kita set manual/default dulu karena fokus ke PG
            const es_betul = 0; // Essay butuh logika semantik lain, fokus PG dulu biar ga 0

            return {
                nama: hasilAI.nama_siswa || "Tanpa Nama",
                pg_betul: pg_betul,
                pg_total: pg_total_kunci,
                es_betul: es_betul,
                es_total: 5,
                detail_jawaban: jawabanSiswa // Debugging: biar tau AI baca apa
            };
        }));

        res.json({ success: true, data: results });

    } catch (err) {
        console.error("Error Backend:", err);
        res.status(500).json({ success: false, message: "Gagal memproses. Coba foto lebih jelas." });
    }
});

// Router Rumus (Tetap Sama)
router.post('/hitung-rumus', async (req, res) => {
    try {
        const { data, rumus_pg, rumus_es } = req.body;
        const hasilFinal = data.map(s => {
            const hitung = (rumus, betul, total) => {
                if(!rumus) return 0;
                try {
                    let f = rumus.toLowerCase().replace(/betul/g, betul).replace(/total/g, total).replace(/x/g, '*');
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
