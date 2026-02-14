/**
 * FILE: koreksi.js 
 * MODEL: Gemini 2.5 Flash (RE-FIXED)
 */
const { GoogleGenerativeAI } = require("@google/generative-ai");
const dotenv = require('dotenv');
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function prosesKoreksiLengkap(files, settings, rumusPG, rumusES) {
    const kunciPG = typeof settings.kunci_pg === 'string' ? JSON.parse(settings.kunci_pg) : (settings.kunci_pg || {});
    const kunciES = typeof settings.kunci_essay === 'string' ? JSON.parse(settings.kunci_essay) : (settings.kunci_essay || {});
    
    const results = [];

    // --- PERBAIKAN 1: KARAKTER RUMUS LEBIH FLEKSIBEL ---
    const hitungNilai = (rumus, betul, total) => {
        if (!rumus || total === 0) return 0;
        try {
            // Jika input hanya angka murni (misal: "2.5"), langsung kalikan dengan jumlah betul
            if (!isNaN(rumus)) return parseFloat(rumus) * betul;

            let f = rumus.toLowerCase()
                .replace(/:/g, '/')   // Mengubah ":" menjadi "/" (pembagian)
                .replace(/x/g, '*')   // Mengubah "x" menjadi "*" (perkalian)
                .replace(/betul/g, betul)
                .replace(/total/g, total);

            // Bersihkan karakter selain angka dan operator matematika dasar
            f = f.replace(/[^0-9+\-*/().]/g, ''); 
            return eval(f) || 0;
        } catch (e) { return 0; }
    };

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    for (const [index, file] of files.entries()) {
        try {
            const base64Data = file.buffer.toString("base64");
            
            // PERINTAH AI TETAP (TIDAK BERUBAH)
            const prompt = `TUGAS: Analisis LJK secara presisi.
            
            1.INSTRUKSI DETEKSI PG (SANGAT KETAT):
            - Target Nomor: Fokus hanya pada nomor berikut: ${JSON.stringify(kunciPG)}.
            - Analisis Kontras: Bedakan antara "Bayangan Abu-abu" dengan "Tinta Hitam/Biru" (jawaban). 
            - Penentuan Jawaban: Jawaban siswa adalah huruf yang memiliki coretan paling tebal atau disilang paling jelas. 
            - Anti-Salah Baca: Jika ada dua huruf terkena tinta, pilih yang memiliki cakupan tinta paling luas.
            - Abaikan Noise: Abaikan bintik hitam kecil atau garis tepi soal.
            - Siswa mungkin menjawab dengan Silang (X), Centang (V), atau Bulatan kecil.
            - Deteksi Tinta Tipis: Meskipun coretan sangat tipis atau hampir samar dengan warna teks, identifikasi keberadaan TINTA BARU (pulpen/pensil) di atas pilihan jawaban.
            - Prioritas: Jika ada bercak tinta yang melintasi huruf (A, B, C, D, atau E), itu adalah jawaban siswa.
            - Kasus Ragu: Jika ada dua coretan, pilih coretan yang paling baru atau paling tegas. Jika sangat tipis, jangan langsung dianggap kosong, perhatikan perubahan tekstur pada area huruf.

            2.DETEKSI ESSAY (SANGAT KETAT):
            - Baca jawaban tulisan tangan siswa untuk soal essay.
            - Bandingkan dengan Kunci Essay: ${JSON.stringify(kunciES)}.
            - Berikan status "BENAR" jika inti jawabannya sama, "SALAH" jika beda jauh.

            OUTPUT WAJIB JSON MURNI:
            {
              "nama_siswa": "NAMA",
              "jawaban_pg": {"1": "A", "2": "B"},
              "essay_betul_count": 0,
              "log_deteksi": "1:B, 2:A"
            }`;

            const imagePart = { inlineData: { data: base64Data, mimeType: file.mimetype || "image/jpeg" } };
            const result = await model.generateContent([prompt, imagePart]);
            const response = await result.response;
            let text = response.text();
            
            let cleanJson = text.replace(/```json/g, "").replace(/```/g, "").trim();
            const jsonStart = cleanJson.indexOf('{');
            const jsonEnd = cleanJson.lastIndexOf('}') + 1;
            
            if (jsonStart === -1) throw new Error("Format JSON tidak ditemukan!");
            const aiData = JSON.parse(cleanJson.substring(jsonStart, jsonEnd));

            let jawabanSiswa = aiData.jawaban_pg || {};
            
            if (Object.keys(jawabanSiswa).length === 0) {
                const teksAnalisis = aiData.log_deteksi || text;
                const matches = teksAnalisis.matchAll(/(\d+)\s*[:=]\s*([A-E])/gi);
                for (const m of matches) {
                    jawabanSiswa[m[1]] = m[2].toUpperCase();
                }
            }

            let pgBetul = 0;
            let totalKunci = 0;
            let rincian = [];
            let listNoBetul = [];

            Object.keys(kunciPG).forEach(no => {
                const k = kunciPG[no] ? kunciPG[no].toString().toUpperCase().trim() : "";
                if (k !== "") {
                    totalKunci++;
                    const s = (jawabanSiswa[no] || "KOSONG").toString().toUpperCase().trim();

                    if (s === k) {
                        pgBetul++;
                        listNoBetul.push(no);
                        rincian.push(`No ${no}: ✅ Benar (${s})`);
                    } else {
                        rincian.push(`No ${no}: ❌ Salah (Siswa:${s}, Kunci:${k})`);
                    }
                }
            });

            let esBetul = parseInt(aiData.essay_betul_count) || 0;

            // --- REKOMENDASI PERBAIKAN LOG DETAIL (ESSAY INTEGRATION) ---
            if (Object.keys(kunciES).length > 0) {
                rincian.push(`Essay: ✅ Terdeteksi ${esBetul} poin/benar`);
            }

            // --- OUTPUT HASIL ---
            results.push({
                nama: (aiData.nama_siswa && aiData.nama_siswa !== "NAMA") ? aiData.nama_siswa : `Siswa ${index + 1}`,
                pg_betul: pgBetul,      
                essay_betul: esBetul,   
                list_detail_pg: listNoBetul.join(', ') || "TIDAK ADA",
                list_detail_es: esBetul > 0 ? `${esBetul} Jawaban Terdeteksi Benar` : "TIDAK ADA",
                log_detail: rincian,
                // PERBAIKAN 2: LOGIKA PEMBULATAN STANDAR (0.5 ke atas naik ke 1)
                nilai_akhir: Math.round(hitungNilai(rumusPG, pgBetul, totalKunci) + hitungNilai(rumusES, esBetul, 1))
            });

        } catch (err) {
            console.error("CRITICAL ERROR:", err);
            results.push({ 
                nama: "ERROR SCAN", 
                pg_betul: 0,
                essay_betul: 0,
                list_detail_pg: "GAGAL",
                list_detail_es: "GAGAL",
                log_detail: ["Gagal baca data: " + err.message], 
                nilai_akhir: 0 
            });
        }
    }
    return results;
}

module.exports = { prosesKoreksiLengkap };
