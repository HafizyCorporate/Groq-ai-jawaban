/**
 * FILE: koreksi.js 
 * MODEL: Gemini 2.5 Flash (RE-FIXED)
 * UPDATE: Logika Pembulatan Kustom (0.5 ke bawah = 0) & Fix Tampilan 0
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
            
            1.INSTRUKSI DETEKSI PG (SANGAT KETAT):
            - Target Nomor: Fokus hanya pada nomor berikut: ${JSON.stringify(kunciPG)}.
            - Analisis Kontras: Bedakan antara "Bayangan Abu-abu" dengan "Tinta Hitam/Biru" (jawaban). 
            - Penentuan Jawaban: Jawaban siswa adalah huruf yang memiliki coretan paling tebal atau disilang paling jelas. 
            - Anti-Salah Baca: Jika ada dua huruf terkena tinta, pilih yang memiliki cakupan tinta paling luas.
            - Abaikan Noise: Abaikan bintik hitam kecil atau garis tepi soal.

            2.DETEKSI ESSAY (SANGAT KETAT):
            - Baca jawaban tulisan tangan siswa untuk soal essay.
            - Bandingkan dengan Kunci Essay: ${JSON.stringify(kunciES)}.
            - Berikan status "BENAR" jika inti jawabannya sama, "SALAH" jika beda jauh.

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

            let jawabanSiswa = aiData.jawaban_pg || {};
            if (Object.keys(jawabanSiswa).length === 0) {
                const teksAnalisis = aiData.log_deteksi || text;
                const matches = teksAnalisis.matchAll(/(\d+)\s*[:=]\s*([A-D])/gi);
                for (const m of matches) {
                    jawabanSiswa[m[1]] = m[2].toUpperCase();
                }
            }

            let pgBetul = 0;
            let esBetul = 0; // Tambahkan penampung hitungan essay
            let totalKunci = 0;
            let rincian = [];
            let listNoBetul = [];

            // Hitung PG
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

            // Hitung Essay: Mencari kata "BENAR" dari hasil analisis teks AI
            const esMatches = text.match(/BENAR/g);
            esBetul = esMatches ? esMatches.length : 0;

            // TAHAP 4: KIRIM KE FRONTEND (LOGIKA PEMBULATAN BARU)
            results.push({
                nama: (aiData.nama_siswa && aiData.nama_siswa !== "NAMA") ? aiData.nama_siswa : `Siswa ${index + 1}`,
                pg_betul: pgBetul,
                essay_betul: esBetul, // SEKARANG DIKIRIM AGAR TIDAK 0
                nomor_pg_betul: listNoBetul.join(', ') || "TIDAK ADA",
                log_detail: rincian,
                nilai_akhir: (function(n) {
                    // Jika nilai desimal <= 0.5 maka bulatkan ke bawah, jika > 0.5 bulatkan ke atas
                    return (n - Math.floor(n) <= 0.5) ? Math.floor(n) : Math.ceil(n);
                })(hitungNilai(rumusPG, pgBetul, totalKunci))
            });

        } catch (err) {
            console.error("CRITICAL ERROR:", err);
            results.push({ 
                nama: "ERROR SCAN", 
                pg_betul: 0,
                essay_betul: 0,
                log_detail: ["Gagal baca data: " + err.message], 
                nomor_pg_betul: "KOSONG", 
                nilai_akhir: 0 
            });
        }
    }
    return results;
}

module.exports = { prosesKoreksiLengkap };
