/**
 * FILE: koreksi.js
 * TUGAS: Otak Analisis AI (via Gemini Terbaru) & Perhitungan Nilai
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");
const dotenv = require('dotenv');
dotenv.config();

// Inisialisasi Google AI dengan API Key dari .env
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

    /**
     * MENGGUNAKAN MODEL SESUAI DAFTAR DI AI STUDIO KAMU
     * Update: Menggunakan Gemini 2.5 Flash untuk stabilitas dan akurasi tinggi.
     */
    const model = genAI.getGenerativeModel({ 
        model: "gemini-2.5-flash" 
    });

    for (const [index, file] of files.entries()) {
        try {
            const base64Data = file.buffer.toString("base64");
            
            const prompt = `ANDA ADALAH GURU SUPER TELITI DENGAN KEMAMPUAN VISUAL DETEKTIF. 
            TUGAS: Koreksi LJK dengan metode Identifikasi Tumpang Tindih (Overlay).

            ATURAN DETEKSI (WAJIB):
            1. **Fokus Interaksi Tinta**: Cari coretan manual (X, centang, atau coretan tebal). Jawaban siswa adalah huruf opsi (a, b, c, atau d) yang SECARA FISIK TERTUTUP atau TERTINDIH oleh tinta tersebut.
            2. **Identifikasi Huruf di Bawah Tinta**: Lihat karakter huruf apa yang ada tepat di bawah coretan.
            3. **Non-Asumsi Layout**: Cari huruf yang tertindih di area setiap nomor soal.
            4. **Deteksi Multi-Alat**: Pilih coretan yang paling TEBAL. Abaikan bekas hapusan.

            INSTRUKSI ESSAY:
            - Bandingkan dengan Kunci: ${JSON.stringify(kunciEssay)}. Nyatakan BENAR jika inti maknanya sama.

            WAJIB OUTPUT JSON MURNI:
            {
              "nama_siswa": "Detect Nama dari kertas",
              "jawaban_pg": {"1": "A", "2": "B", ...},
              "analisis_essay": {"1": "BENAR/SALAH (Alasan)", ...},
              "log_deteksi": "Jelaskan visual per nomor."
            }`;

            const imagePart = {
                inlineData: {
                    data: base64Data,
                    mimeType: "image/jpeg"
                }
            };

            const result = await model.generateContent([prompt, imagePart]);
            const response = await result.response;
            const text = response.text();
            
            const cleanJson = text.replace(/```json|```/g, "").trim();
            const aiData = JSON.parse(cleanJson);

            const jawabanPG = aiData.jawaban_pg || {};
            const analES = aiData.analisis_essay || {};
            
            let pgBetul = 0;
            let pgTotalKunci = 0;
            let esBetul = 0;
            let rincianProses = [];

            Object.keys(kunciPG).forEach(nomor => {
                if (kunciPG[nomor] !== "") {
                    pgTotalKunci++;
                    const jawabSiswa = (jawabanPG[nomor] || "KOSONG").toString().toUpperCase().trim();
                    const jawabKunci = kunciPG[nomor].toString().toUpperCase().trim();
                    
                    if (jawabSiswa === jawabKunci) {
                        pgBetul++;
                        rincianProses.push(`No ${nomor}: ✅ Benar (Siswa: ${jawabSiswa})`);
                    } else {
                        rincianProses.push(`No ${nomor}: ❌ Salah (Siswa: ${jawabSiswa}, Kunci: ${jawabKunci})`);
                    }
                }
            });

            Object.keys(kunciEssay).forEach(no => {
                const status = analES[no] || "SALAH";
                const isBenar = status.toUpperCase().includes("BENAR");
                if(isBenar) esBetul++;
                rincianProses.push(`Essay ${no}: ${isBenar ? "✅" : "❌"} ${status}`);
            });

            const nilaiPG = hitungNilaiAkhir(rumusPG, pgBetul, pgTotalKunci);
            const nilaiES = hitungNilaiAkhir(rumusES, esBetul, Object.keys(kunciEssay).length);
            const totalSkor = Math.round((nilaiPG + nilaiES) * 10) / 10;

            results.push({ 
                nama: (aiData.nama_siswa || `Siswa ${index + 1}`).trim(), 
                pg_betul: pgBetul,
                pg_total: pgTotalKunci,
                es_betul: esBetul,
                nomor_pg_betul: rincianProses.filter(t => t.includes('✅') && t.startsWith('No')).map(t => t.split(':')[0].replace('No ', '')).join(', '),
                log_detail: rincianProses,
                info_ai: aiData.log_deteksi || "Analisis selesai.",
                nilai_akhir: totalSkor
            }); 

        } catch (err) {
            console.error("Detail Error:", err);
            results.push({ 
                nama: `Error (File ${index + 1})`, 
                log_detail: [err.message],
                nilai_akhir: 0
            });
        }
    }
    return results;
}

module.exports = { prosesKoreksiLengkap };
