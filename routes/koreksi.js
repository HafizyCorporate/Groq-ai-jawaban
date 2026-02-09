/**
 * FILE: koreksi.js - VERSI FINAL ANTI-GELAP
 */
const { GoogleGenerativeAI } = require("@google/generative-ai");
const dotenv = require('dotenv');
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function prosesKoreksiLengkap(files, settings, rumusPG, rumusES) {
    const kunciPG = settings.kunci_pg || {};
    const kunciEssay = settings.kunci_essay || {};
    const results = [];

    const hitungNilaiAkhir = (rumus, betul, total) => {
        if (!rumus) return 0;
        try {
            let f = rumus.toLowerCase().replace(/betul/g, betul).replace(/total/g, total).replace(/x/g, '*');
            f = f.replace(/[^0-9+\-*/().]/g, ''); 
            return eval(f) || 0;
        } catch (e) { return 0; }
    };

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); // Pastikan model aktif

    for (const [index, file] of files.entries()) {
        try {
            const base64Data = file.buffer.toString("base64");
            const prompt = `EKSTRAKSI LJK:
            Cari tanda silang (X) pada A, B, C, atau D.
            FORMAT JSON:
            {
              "nama_siswa": "NAMA",
              "jawaban_pg": { "1": "A", "2": "B" },
              "log_deteksi": "1: Tanda X pada pilihan B; 2: Tanda X pada pilihan C"
            }`;

            const imagePart = { inlineData: { data: base64Data, mimeType: file.mimetype || "image/jpeg" } };
            const result = await model.generateContent([prompt, imagePart]);
            const response = await result.response;
            const text = response.text();
            
            console.log("RAW AI:", text);
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            const aiData = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

            // --- JEMBATAN DARURAT (REFIXED) ---
            let jawabanPG = aiData.jawaban_pg || {};
            
            // Jika AI cuma curhat di log_deteksi, kita paksa ambil datanya
            if (Object.keys(jawabanPG).length === 0 && aiData.log_deteksi) {
                // RegEx Baru: Mencari angka, lalu mencari huruf A-D setelahnya (mengabaikan kata-kata perantara)
                const polaCanggih = /(\d+)[:.]\s*.*?\s*([A-D])/gi;
                let m;
                while ((m = polaCanggih.exec(aiData.log_deteksi)) !== null) {
                    jawabanPG[m[1]] = m[2].toUpperCase();
                }
            }

            let pgBetul = 0, pgTotalKunci = 0, rincianProses = [];

            Object.keys(kunciPG).forEach(nomor => {
                if (kunciPG[nomor] !== "") {
                    pgTotalKunci++;
                    const jawabSiswa = (jawabanPG[nomor] || "KOSONG").toString().toUpperCase().trim();
                    const jawabKunci = kunciPG[nomor].toString().toUpperCase().trim();
                    
                    if (jawabSiswa === jawabKunci) {
                        pgBetul++;
                        rincianProses.push(`No ${nomor}: ✅ Benar (${jawabSiswa})`);
                    } else {
                        rincianProses.push(`No ${nomor}: ❌ Salah (Siswa:${jawabSiswa}, Kunci:${jawabKunci})`);
                    }
                }
            });

            const nilaiPG = hitungNilaiAkhir(rumusPG, pgBetul, pgTotalKunci);

            results.push({ 
                nama: (aiData.nama_siswa && aiData.nama_siswa !== "NAMA") ? aiData.nama_siswa.trim() : `Siswa ${index + 1}`, 
                pg_betul: pgBetul,
                pg_total: pgTotalKunci,
                nomor_pg_betul: rincianProses.filter(t => t.includes('✅')).map(t => t.match(/No (\d+)/)[1]).join(', ') || "TIDAK ADA",
                log_detail: rincianProses,
                info_ai: aiData.log_deteksi || "Analisis selesai.",
                nilai_akhir: nilaiPG
            }); 

        } catch (err) {
            results.push({ nama: `ERROR SCAN`, log_detail: [err.message], nilai_akhir: 0 });
        }
    }
    return results;
}
module.exports = { prosesKoreksiLengkap };
