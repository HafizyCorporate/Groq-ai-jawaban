const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const db = require("../db");
const Groq = require("groq-sdk");

const router = express.Router();
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const upload = multer({ dest: "uploads/" });

router.post("/proses-koreksi", upload.array("foto_tugas", 5), async (req, res) => {
  try {
    if (!req.session.user) return res.status(401).json({ error: "Login dulu!" });

    const { kunci_pg, kriteria_essay, rumus_nilai } = req.body;
    const files = req.files;

    if (!files || files.length === 0) return res.status(400).json({ error: "Upload minimal 1 foto!" });

    // Payload Multimodal
    const contentPayload = [{
      type: "text",
      text: `Tugas: Koreksi foto tugas siswa secara individu.
      KUNCI PG: ${kunci_pg}
      KRITERIA ESSAY: ${kriteria_essay}
      RUMUS PENILAIAN: ${rumus_nilai}

      INSTRUKSI:
      1. Identifikasi NAMA SISWA di setiap foto.
      2. Koreksi PG dan Essay (Gunakan logika: jika inti essay benar = betul).
      3. Hitung nilai akhir per siswa sesuai RUMUS yang diberikan.
      4. Jika nama tidak ada, beri nama "Siswa Tanpa Nama".

      OUTPUT JSON (Daftar Siswa):
      {
        "hasil": [
          { "nama": "Alesa", "pg_betul": 10, "essay_betul": 3, "nilai_akhir": 70, "catatan": "..." },
          { "nama": "Alex", "pg_betul": 12, "essay_betul": 5, "nilai_akhir": 85, "catatan": "..." }
        ]
      }`
    }];

    files.forEach(file => {
      const base64 = fs.readFileSync(file.path, { encoding: 'base64' });
      contentPayload.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64}` } });
    });

    const completion = await groq.chat.completions.create({
      messages: [{ role: "user", content: contentPayload }],
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
      temperature: 0.1,
      response_format: { type: "json_object" }
    });

    const hasil = JSON.parse(completion.choices[0].message.content);

    // Simpan ke DB
    db.run("INSERT INTO history_koreksi (user_id, hasil_koreksi) VALUES (?,?)", 
    [req.session.user.id, JSON.stringify(hasil.hasil)]);

    // Hapus File
    files.forEach(f => fs.unlinkSync(f.path));

    res.json({ success: true, data: hasil.hasil });
  } catch (err) {
    res.status(500).json({ error: "Gagal memproses AI." });
  }
});

module.exports = router;
