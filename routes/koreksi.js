/**
 * FILE: koreksi.js 
 * MODEL: Gemini 2.5 Flash (RE-FIXED)
 */
const { GoogleGenerativeAI } = require("@google/generative-ai");
const dotenv = require('dotenv');
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function prosesKoreksiLengkap(files, settings, rumusPG, rumusES) {
    const kunciPG = settings.kunci_pg || {};
    const kunciES = settings.kunci_essay || {};
    const results = [];

    const hitungNilai = (rumus, betul, total) => {
        if (!rumus || total === 0) return 0;
        try {
            let f = rumus.toLowerCase().replace(/betul/g, betul).replace(/total/g, total).replace(/x/g, '*');
            f = f.replace(/[^0-9+\-*/().]/g, ''); 
            return eval(f) || 0;
        } catch (e) { return 0; }
    };

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    for (const [index, file] of files.entries()) {
        try {
            const base64Data = file.buffer.toString("base64");
            
            const prompt = `TUGAS: Analisis LJK secara presisi.
            
            INSTRUKSI DETEKSI (SANGAT KETAT):
            1. Target Nomor: Fokus hanya pada nomor berikut: ${JSON.stringify(kunciPG)}.
            2. Analisis Kontras: Bedakan antara "Bayangan Abu-abu" dengan "Tinta Hitam/Biru" (jawaban). 
            3. Penentuan Jawaban: Jawaban siswa adalah huruf yang memiliki coretan paling tebal atau disilang paling jelas. 
            4. Anti-Salah Baca: Jika ada dua huruf terkena tinta, pilih yang memiliki cakupan tinta paling luas.
            5. Abaikan Noise: Abaikan bintik hitam kecil atau garis tepi soal.

            OUTPUT WAJIB JSON MURNI:
            {
              "nama_siswa": "NAMA",
              "jawaban_pg": {"1": "A", "2": "B"},
              "log_deteksi": "1:B, 2:A"
            }`;

            const imagePart = { inlineData: { data: base64Data, mimeType: file.mimetype || "image/jpeg" } };
            const result = await model.generateContent([prompt, imagePart]);
            const response = await result.response;
            let text = response.text();
            
            const jsonStart = text.indexOf('{');
            const jsonEnd = text.lastIndexOf('}') + 1;
            if (jsonStart === -1) throw new Error("Format JSON tidak ditemukan!");
            const aiData = JSON.parse(text.substring(jsonStart, jsonEnd));

            // TAHAP 2: FALLBACK REGEX
            let jawabanSiswa = aiData.jawaban_pg || {};
            if (Object.keys(jawabanSiswa).length === 0) {
                const teksAnalisis = aiData.log_deteksi || text;
                const matches = teksAnalisis.matchAll(/(\d+)\s*[:=]\s*([A-D])/gi);
                for (const m of matches) {
                    jawabanSiswa[m[1]] = m[2].toUpperCase();
                }
            }

            // --- TAHAP 3: KOMPARASI & HITUNG (SUDAH ADA DISINI) ---
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

            // TAHAP 4: KIRIM KE FRONTEND
            results.push({
                nama: (aiData.nama_siswa && aiData.nama_siswa !== "NAMA") ? aiData.nama_siswa : `Siswa ${index + 1}`,
                pg_betul: pgBetul,
                nomor_pg_betul: listNoBetul.join(', ') || "TIDAK ADA",
                log_detail: rincian,
                nilai_akhir: Math.round(hitungNilai(rumusPG, pgBetul, totalKunci) * 10) / 10
            });

        } catch (err) {
            console.error("CRITICAL ERROR:", err);
            results.push({ 
                nama: "ERROR SCAN", 
                log_detail: ["Gagal baca data: " + err.message], 
                nomor_pg_betul: "KOSONG", 
                nilai_akhir: 0 
            });
        }
    }
    return results;
}

module.exports = { prosesKoreksiLengkap };
