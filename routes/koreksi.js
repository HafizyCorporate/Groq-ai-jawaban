/**
 * FILE: koreksi.js 
 * MODEL: Gemini 2.5 Flash (RE-FIXED)
 * UPDATE: Sinkronisasi Output tanpa mengubah Logika Deteksi & Prompt
 */
const { GoogleGenerativeAI } = require("@google/generative-ai");
const dotenv = require('dotenv');
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function prosesKoreksiLengkap(files, settings, rumusPG, rumusES) {
    const kunciPG = settings.kunci_pg || {};
    const kunciES = settings.kunci_essay || {};
    const results = [];

    // --- RUMUS TETAP (TIDAK DIRUBAH) ---
    const hitungNilai = (rumus, betul, total) => {
        if (!rumus || total === 0) return 0;
        try {
            let f = rumus.toLowerCase().replace(/betul/g, betul).replace(/total/g, total).replace(/x/g, '*');
            f = f.replace(/[^0-9+\-*/().]/g, ''); 
            return eval(f) || 0;
        } catch (e) { return 0; }
    };

    // --- MODEL TETAP 2.5 FLASH ---
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    for (const [index, file] of files.entries()) {
        try {
            const base64Data = file.buffer.toString("base64");
            
            // --- PROMPT TETAP SAMA (TIDAK DIRUBAH SEDIKITPUN) ---
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
            let esBetul = 0; 
            let totalKunci = 0;
            let rincian = [];
            let listNoBetul = [];

            // --- HITUNG PG (LOGIKA TETAP) ---
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

            // --- HITUNG ESSAY (LOGIKA TETAP) ---
            const esMatches = text.match(/BENAR/g);
            esBetul = esMatches ? esMatches.length : 0;

            // --- OUTPUT HASIL ---
            results.push({
                nama: (aiData.nama_siswa && aiData.nama_siswa !== "NAMA") ? aiData.nama_siswa : `Siswa ${index + 1}`,
                pg_betul: pgBetul,      
                essay_betul: esBetul,   
                list_detail_pg: listNoBetul.join(', ') || "TIDAK ADA",
                list_detail_es: esBetul > 0 ? `${esBetul} Jawaban Terdeteksi Benar` : "TIDAK ADA",
                log_detail: rincian,
                nilai_akhir: (function(n) {
                    return (n - Math.floor(n) <= 0.5) ? Math.floor(n) : Math.ceil(n);
                })(hitungNilai(rumusPG, pgBetul, totalKunci))
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
