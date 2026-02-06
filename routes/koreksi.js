const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const db = require("../db");
const Groq = require("groq-sdk");

const router = express.Router();
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Setup Folder Upload
const uploadDir = path.join(__dirname, "../uploads/");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
const upload = multer({ dest: uploadDir });

router.post("/proses-koreksi", upload.array("foto_tugas", 5), async (req, res) => {
  try {
    // 1. Cek Login
    if (!req.session.user) return res.status(401).json({ error: "Silakan login." });

    const userId = req.session.user.id;
    const { kunci_pg, kriteria_essay } = req.body;

    // 2. Cek File
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "Mohon upload foto tugas siswa." });
    }

    // 3. Payload Multimodal untuk Llama-4-Scout
    const contentPayload = [
      { 
        type: "text", 
        text: `Tugas: Koreksi jawaban siswa berdasarkan referensi berikut.
               KUNCI PG: ${kunci_pg}
               KRITERIA ESSAY: ${kriteria_essay}
               
               INSTRUKSI:
               - Baca tulisan tangan siswa pada foto (meskipun tulisannya buruk sekali).
               - PG: Cocokkan jawaban siswa dengan kunci.
               - Essay: Jika jawaban siswa merangkum poin atau mengarah ke kriteria, nyatakan BETUL.
               
               OUTPUT WAJIB JSON:
               {
                 "hasil_pg": "Hasil koreksi PG",
                 "hasil_essay": "Hasil koreksi Essay",
                 "skor_total": 0-100,
                 "feedback": "Saran singkat"
               }` 
      }
    ];

    // Konversi foto ke Base64
    req.files.forEach(file => {
      const base64Image = fs.readFileSync(file.path, { encoding: 'base64' });
      contentPayload.push({
        type: "image_url",
        image_url: { url: `data:image/jpeg;base64,${base64Image}` }
      });
    });

    // 4. Proses API Groq
    const completion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: "Kamu adalah asisten guru cerdas buatan Te Az Ha." },
        { role: "user", content: contentPayload }
      ],
      model: "meta-llama/llama-4-scout-17b-16e-instruct", 
      temperature: 0.2, // Rendah agar tidak halusinasi saat membaca tulisan buruk
      response_format: { type: "json_object" }
    });

    const hasilRaw = completion.choices[0]?.message?.content || "{}";
    const hasil = JSON.parse(hasilRaw);

    // 5. Simpan ke Database & Bersihkan File
    db.run(
      "INSERT INTO history_koreksi (user_id, kunci_pg, kriteria_essay, hasil_koreksi, skor_total) VALUES (?,?,?,?,?)",
      [userId, kunci_pg, kriteria_essay, hasilRaw, hasil.skor_total],
      function (err) {
        req.files.forEach(file => { if (fs.existsSync(file.path)) fs.unlinkSync(file.path); });
        if (err) return res.status(500).json({ error: "Gagal simpan ke database." });
        
        res.json({ success: true, data: hasil });
      }
    );

  } catch (err) {
    console.error("Error:", err);
    res.status(500).json({ error: "Terjadi kesalahan pada sistem AI." });
  }
});

module.exports = router;
