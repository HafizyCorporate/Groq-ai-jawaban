/**
 * FILE: koreksi.js - VERSI SUPER AGRESIF ANTI-GAGAL
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
            let f = rumus.toLowerCase()
                         .replace(/betul/g, betul)
                         .replace(/total/g, total)
                         .replace(/x/g, '*');
            f = f.replace(/[^0-9+\-*/().]/g, ''); 
            return eval(f) || 0;
        } catch (e) { return 0; }
    };

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    for (const [index, file] of files.entries()) {
        try {
            const base64Data = file.buffer.toString("base64");
            const prompt = `EKSTRAKSI DATA LJK:
            Deteksi coretan (X) pada pilihan A,B,C,D.
            WAJIB BALAS JSON MURNI:
            {
              "nama_siswa": "CARI NAMA DI KERTAS",
              "jawaban_pg": {},
              "log_deteksi": "Contoh: 1:B, 2:A, 3:C"
            }`;

            const imagePart = { inlineData: { data: base64Data, mimeType: file.mimetype || "image/jpeg" } };
            const result = await model.generateContent([prompt, imagePart]);
            const response = await result.response;
            const text = response.text();
            
            console.log("--- RAW AI RESPONSE ---");
            console.log(text);

            const jsonMatch = text.match(/\{[\s\S]*\}/);
            const aiData = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

            // --- SISTEM PENANGKAP SUPER AGRESIF (FALLBACK) ---
            let jawabanPG = aiData.jawaban_pg || {};
            let teksSumber = aiData.log_deteksi || text; // Kalau log_deteksi kosong, pakai raw text AI

            // Cari Pola: Angka (1-99) lalu Huruf (A-D) meski terpisah kata-kata
            // Contoh: "1: Tanda X terdeteksi pada pilihan B" -> akan ambil 1 dan B
            const matches = teksSumber.matchAll(/(?:Nomor\s+)?(\d+)[:.]?.*?([A-D])(?![a-z])/gi);
            for (const m of matches) {
                const no = m[1];
                const huruf = m[2].toUpperCase();
                if (!jawabanPG[no]) jawabanPG[no] = huruf;
            }

            let pgBetul = 0;
            let pgTotalKunci = 0;
            let rincianProses = [];

            // Bandingkan dengan Kunci Jawaban yang Bos input di Dashboard
            Object.keys(kunciPG).forEach(nomor => {
                if (kunciPG[nomor] !== "") {
                    pgTotalKunci++;
                    const jawabSiswa = (jawabanPG[nomor] || "KOSONG").toString().toUpperCase().trim();
                    const jawabKunci = kunciPG[nomor].toString().toUpperCase().trim();
                    
                    if (jawabSiswa === jawabKunci) {
                        pgBetul++;
                        rincianProses.push(`No ${nomor}: ✅ Benar (${jawabSiswa})`);
                    } else {
                        rincianProses.push(`No ${nomor}: ❌ Salah (Siswa: ${jawabSiswa}, Kunci: ${jawabKunci})`);
                    }
                }
            });

            const nilaiPG = hitungNilaiAkhir(rumusPG, pgBetul, pgTotalKunci);

            results.push({ 
                nama: (aiData.nama_siswa && !aiData.nama_siswa.includes("CARI NAMA")) ? aiData.nama_siswa.trim() : `Siswa ${index + 1}`, 
                pg_betul: pgBetul,
                pg_total: pgTotalKunci,
                nomor_pg_betul: rincianProses.filter(t => t.includes('✅')).map(t => t.match(/No (\d+)/)[1]).join(', ') || "KOSONG",
                log_detail: rincianProses,
                info_ai: aiData.log_deteksi || "Selesai dianalisis.",
                nilai_akhir: nilaiPG
            }); 

        } catch (err) {
            console.error("Error Detail:", err);
            results.push({ nama: "GAGAL SCAN", log_detail: [err.message], nilai_akhir: 0 });
        }
    }
    return results;
}

module.exports = { prosesKoreksiLengkap };
