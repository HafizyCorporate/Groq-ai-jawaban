/**
 * FILE: koreksi.js - VERSI FINAL ANTI-ZONK
 */
const { GoogleGenerativeAI } = require("@google/generative-ai");
const dotenv = require('dotenv');
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function prosesKoreksiLengkap(files, settings, rumusPG, rumusES) {
    const kunciPG = settings.kunci_pg || {};
    const results = [];

    // Fungsi Hitung Nilai Aman
    const hitungNilai = (rumus, betul, total) => {
        if (!rumus || total === 0) return 0;
        try {
            let f = rumus.toLowerCase().replace(/betul/g, betul).replace(/total/g, total).replace(/x/g, '*');
            f = f.replace(/[^0-9+\-*/().]/g, ''); 
            return eval(f) || 0;
        } catch (e) { return 0; }
    };

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    for (const [index, file] of files.entries()) {
        try {
            const base64Data = file.buffer.toString("base64");
            const prompt = `EKSTRAKSI LJK:
            Cari Nama Siswa dan jawaban tanda silang (X) pada opsi A, B, C, atau D.
            BALAS HANYA DENGAN JSON MURNI:
            {
              "nama_siswa": "NAMA",
              "jawaban_pg": {"1": "A", "2": "B"},
              "log_deteksi": "Nomor 1: B, Nomor 2: A"
            }`;

            const imagePart = { inlineData: { data: base64Data, mimeType: file.mimetype || "image/jpeg" } };
            const result = await model.generateContent([prompt, imagePart]);
            const response = await result.response;
            let text = response.text();
            
            console.log("--- RAW OUTPUT AI ---", text);

            // 1. PEMBERSIH JSON (Membuang teks sampah di luar kurung kurawal)
            const start = text.indexOf('{');
            const end = text.lastIndexOf('}') + 1;
            if (start === -1 || end === 0) throw new Error("AI tidak mengirim format JSON");
            const cleanJson = text.substring(start, end);
            const aiData = JSON.parse(cleanJson);

            // 2. FALLBACK BRUTAL (Jika jawaban_pg kosong tapi log_deteksi ada isinya)
            let jawabanSiswa = aiData.jawaban_pg || {};
            if (Object.keys(jawabanSiswa).length === 0) {
                const sumberTeks = aiData.log_deteksi || text;
                const matches = sumberTeks.matchAll(/(\d+)[:.]\s*.*?\s*([A-D])(?![a-z])/gi);
                for (const m of matches) {
                    jawabanSiswa[m[1]] = m[2].toUpperCase();
                }
            }

            // 3. KOMPARASI DENGAN KUNCI DI DASHBOARD
            let pgBetul = 0;
            let totalKunci = 0;
            let rincian = [];
            let listNoBetul = [];

            Object.keys(kunciPG).forEach(no => {
                if (kunciPG[no] && kunciPG[no] !== "") {
                    totalKunci++;
                    const s = (jawabanSiswa[no] || "KOSONG").toString().toUpperCase().trim();
                    const k = kunciPG[no].toString().toUpperCase().trim();

                    if (s === k) {
                        pgBetul++;
                        listNoBetul.push(no);
                        rincian.push(`No ${no}: ✅ Benar (${s})`);
                    } else {
                        rincian.push(`No ${no}: ❌ Salah (Siswa:${s}, Kunci:${k})`);
                    }
                }
            });

            // 4. PACKING DATA UNTUK DASHBOARD (Nama variabel harus pas dengan HTML)
            results.push({
                nama: (aiData.nama_siswa && aiData.nama_siswa !== "NAMA") ? aiData.nama_siswa : `Siswa ${index + 1}`,
                pg_betul: pgBetul,
                nomor_pg_betul: listNoBetul.join(', ') || "TIDAK ADA",
                log_detail: rincian,
                nilai_akhir: Math.round(hitungNilai(rumusPG, pgBetul, totalKunci) * 10) / 10
            });

        } catch (err) {
            console.error("LOG ERROR:", err);
            results.push({ 
                nama: "GAGAL SCAN", 
                log_detail: ["Sistem gagal membedah gambar: " + err.message], 
                nomor_pg_betul: "KOSONG", 
                nilai_akhir: 0 
            });
        }
    }
    return results;
}

module.exports = { prosesKoreksiLengkap };
