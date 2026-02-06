const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const db = require("../db");
const Groq = require("groq-sdk");

const router = express.Router();
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const upload = multer({ dest: path.join(__dirname, "../uploads/") });

router.post("/koreksi-essay", upload.single("foto_jawaban"), async (req, res) => {
  try {
    // 1. Cek Sesi User
    if (!req.session.user) return res.status(401).json({ error: "Silakan login." });

    const { kunci_jawaban } = req.body;
    if (!req.file) return res.status(400).json({ error: "Foto jawaban tidak ditemukan." });

    // 2. Siapkan Payload Gambar ke Llama-4-Scout
    const base64Image = fs.readFileSync(req.file.path, { encoding: 'base64' });
    const contentPayload = [
      { 
        type: "text", 
        text: `Tugas: Koreksi jawaban essay siswa berdasarkan Kunci Jawaban berikut: "${kunci_jawaban}".
               
               Instruksi:
               - Identifikasi tulisan tangan pada gambar.
               - Berikan skor (0-100) berdasarkan kebenaran materi.
               - Berikan analisis singkat dan saran perbaikan (feedback).
               
               Format Output WAJIB JSON:
               {
                 "skor": 85,
                 "analisis": "Analisis materi",
                 "feedback": "Saran untuk siswa"
               }` 
      },
      {
        type: "image_url",
        image_url: { url: `data:image/jpeg;base64,${base64Image}` }
      }
    ];

    // 3. Panggil Llama-4-Scout
    const completion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: "Kamu adalah asisten guru profesional yang ahli dalam menilai essay." },
        { role: "user", content: contentPayload }
      ],
      model: "meta-llama/llama-4-scout-17b-16e-instruct", // Model multimodal andalan
      temperature: 0.3, // Low temperature agar akurat membaca teks
      response_format: { type: "json_object" }
    });

    const hasilRaw = completion.choices[0].message.content;
    const hasil = JSON.parse(hasilRaw);

    // 4. Simpan ke Database
    db.run(
      "INSERT INTO history_koreksi (user_id, kunci_jawaban, skor, analisis, feedback) VALUES (?,?,?,?,?)",
      [req.session.user.id, kunci_jawaban, hasil.skor, hasil.analisis, hasil.feedback],
      function (err) {
        // Hapus file sementara
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        
        res.json({
          success: true,
          skor: hasil.skor,
          analisis: hasil.analisis,
          feedback: hasil.feedback
        });
      }
    );

  } catch (err) {
    console.error("Koreksi Error:", err);
    res.status(500).json({ error: "Gagal memproses koreksi." });
  }
});

module.exports = router;
