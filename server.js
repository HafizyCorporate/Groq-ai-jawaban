const express = require('express');
const multer = require('multer');
const path = require('path');
const dotenv = require('dotenv');
const Groq = require("groq-sdk");

// 1. Inisialisasi
dotenv.config();
const app = express();
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const port = process.env.PORT || 3000;

// 2. Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// 3. Setup Multer (Memory Storage agar cepat di Railway)
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 15 * 1024 * 1024 } // Limit 15MB
});

// 4. Route Utama (Halaman Dashboard)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

// 5. API PROSES KOREKSI AI (LOGIKA HYBRID + LLAMA 4 SCOUT)
app.post('/ai/proses-koreksi', upload.array('foto'), async (req, res) => {
    try {
        const settings = JSON.parse(req.body.data);
        const kunciPG = settings.kunci_pg;
        const kunciES = settings.kunci_essay;

        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ success: false, message: "Foto belum diupload" });
        }

        const results = await Promise.all(req.files.map(async (file) => {
            const base64 = file.buffer.toString("base64");
            
            // PERINTAH KHUSUS KE MODEL LLAMA 4 SCOUT
            const response = await groq.chat.completions.create({
                "model": "meta-llama/llama-4-scout-17b-16e-instruct",
                "messages": [{
                    "role": "user",
                    "content": [
                        { 
                            "type": "text", 
                            "text": `TUGAS GURU AI:
                            1. Identifikasi Nama Siswa di kertas ujian.
                            2. Lihat tanda silang (X) atau coretan berwarna MERAH pada pilihan A, B, C, atau D (Nomor 1-20).
                            3. Ekstrak jawaban tersebut ke dalam format JSON.
                            4. Bandingkan secara semantik jawaban Essay siswa dengan kunci: ${JSON.stringify(kunciES)}.
                            
                            DATA PEMBANDING (KUNCI PG): ${JSON.stringify(kunciPG)}
                            
                            OUTPUT WAJIB JSON:
                            {
                                "nama_siswa": "NAMA_DI_SINI",
                                "jawaban_pg_siswa": {"1": "A", "2": "C"},
                                "analisa_essay": {"1": true, "2": false}
                            }` 
                        },
                        { "type": "image_url", "image_url": { "url": `data:image/jpeg;base64,${base64}` } }
                    ]
                }],
                "temperature": 0,
                "response_format": { "type": "json_object" }
            });

            const aiData = JSON.parse(response.choices[0].message.content);
            
            // VALIDASI & PERHITUNGAN (Server Side - Biar gak 0)
            let pg_betul = 0;
            let pg_total = Object.keys(kunciPG).length || 20;
            
            for (let no in kunciPG) {
                if (kunciPG[no] && aiData.jawaban_pg_siswa[no]) {
                    if (aiData.jawaban_pg_siswa[no].toUpperCase() === kunciPG[no].toUpperCase()) {
                        pg_betul++;
                    }
                }
            }

            let es_betul = 0;
            let es_total = Object.keys(kunciES).length || 5;
            for (let no in aiData.analisa_essay) {
                if (aiData.analisa_essay[no] === true) es_betul++;
            }

            // Kembalikan objek data lengkap untuk dirender di HTML
            return {
                nama: aiData.nama_siswa || "Tidak Terbaca",
                pg_betul: pg_betul,
                pg_total: pg_total,
                pg_salah: pg_total - pg_betul,
                es_betul: es_betul,
                es_total: es_total,
                es_salah: es_total - es_betul
            };
        }));

        res.json({ success: true, data: results });

    } catch (err) {
        console.error("AI Error:", err.message);
        res.status(500).json({ success: false, message: "Kesalahan Model Llama 4: " + err.message });
    }
});

// 6. API HITUNG RUMUS & LAPORAN
app.post('/ai/hitung-rumus', (req, res) => {
    try {
        const { data, rumus_pg, rumus_es } = req.body;
        
        const hasilFinal = data.map(s => {
            const hitung = (rumus, betul, total) => {
                if (!rumus) return 0;
                try {
                    // Membersihkan dan mengevaluasi rumus
                    let f = rumus.toLowerCase()
                                 .replace(/betul/g, betul)
                                 .replace(/total/g, total)
                                 .replace(/x/g, '*');
                    // Hanya izinkan karakter matematika
                    f = f.replace(/[^0-9+\-*/().]/g, ''); 
                    return eval(f) || 0;
                } catch (e) { return 0; }
            };

            const nilaiPG = hitung(rumus_pg, s.pg_betul, s.pg_total);
            const nilaiES = hitung(rumus_es, s.es_betul, s.es_total);
            
            return { 
                ...s, 
                nilai_akhir: Math.round((nilaiPG + nilaiES) * 10) / 10 
            };
        });

        res.json({ success: true, hasil: hasilFinal });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

// 7. Start Server
app.listen(port, () => {
    console.log(`--- SERVER JAWABAN AI READY ---`);
    console.log(`Model: Llama 4 Scout 17B`);
    console.log(`Port: ${port}`);
});
