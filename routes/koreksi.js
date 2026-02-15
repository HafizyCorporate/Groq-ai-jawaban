/**
 * FILE: koreksi.js 
 * MODEL: Gemini 2.5 Flash (FIXED: ListHasilBool & SafetySettings)
 */
const { GoogleGenerativeAI } = require("@google/generative-ai");
const dotenv = require('dotenv');
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function prosesKoreksiLengkap(files, settings) {
    // --- SINKRONISASI DATA JSON (AWAL) ---
    let kunciPG = {};
    let kunciES = {};

    try {
        kunciPG = typeof settings.kunci_pg === 'string' ? JSON.parse(settings.kunci_pg) : (settings.kunci_pg || {});
        kunciES = typeof settings.kunci_essay === 'string' ? JSON.parse(settings.kunci_essay) : (settings.kunci_essay || {});
    } catch (e) {
        console.error("⚠️ Sinkronisasi JSON Gagal:", e.message);
    }
    // --- AKHIR SINKRONISASI ---
    
    const results = [];

    // --- PERBAIKAN 1: MENAMBAHKAN SAFETY SETTINGS AGAR TIDAK ERROR BLOCK ---
    const model = genAI.getGenerativeModel({ 
        model: "gemini-2.5-flash",
        safetySettings: [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
        ]
    });

    for (const [index, file] of files.entries()) {
        try {
            const base64Data = file.buffer.toString("base64");
            
            // PERINTAH AI TETAP (TIDAK BERUBAH SAMA SEKALI)
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
            
            // --- PERBAIKAN 2: DEFINISIKAN VARIABEL INI (SEBELUMNYA HILANG) ---
            let listHasilBool = []; 

            Object.keys(kunciPG).forEach(no => {
                const k = kunciPG[no] ? kunciPG[no].toString().toUpperCase().trim() : "";
                if (k !== "") {
                    totalKunci++;
                    const s = (jawabanSiswa[no] || "KOSONG").toString().toUpperCase().trim();

                    if (s === k) {
                        pgBetul++;
                        listNoBetul.push(no);
                        rincian.push(`No ${no}: ✅ Benar (${s})`);
                        // Masukkan status TRUE agar kotak jadi hijau
                        listHasilBool.push(true); 
                    } else {
                        rincian.push(`No ${no}: ❌ Salah (Siswa:${s}, Kunci:${k})`);
                        // Masukkan status FALSE agar kotak jadi merah
                        listHasilBool.push(false); 
                    }
                }
            });

            let esBetul = parseInt(aiData.essay_betul_count) || 0;

            if (Object.keys(kunciES).length > 0) {
                rincian.push(`Essay: ✅ Terdeteksi ${esBetul} poin/benar`);
            }

            // --- OUTPUT HASIL (DIOPTIMALKAN UNTUK PENGGABUNGAN) ---
            results.push({
                // Jika AI tidak ketemu nama, kirim null.
                nama: (aiData.nama_siswa && aiData.nama_siswa !== "NAMA") ? aiData.nama_siswa : null,
                
                pg_betul: pgBetul,      
                essay_betul: esBetul,
                
                // Variabel ini sekarang sudah aman dan terisi
                list_hasil_pg: listHasilBool, 
                
                list_detail_pg: listNoBetul.join(', ') || "TIDAK ADA",
                list_detail_es: esBetul > 0 ? `${esBetul} Jawaban Terdeteksi Benar` : "TIDAK ADA",
                log_detail: rincian
            });

        } catch (err) {
            console.error("CRITICAL ERROR:", err);
            results.push({ 
                nama: "ERROR SCAN", 
                pg_betul: 0,
                essay_betul: 0,
                list_hasil_pg: [], // Tambahkan array kosong saat error agar frontend tidak blank
                list_detail_pg: "GAGAL",
                list_detail_es: "GAGAL",
                log_detail: ["Gagal baca data: " + err.message]
            });
        }
    }
    return results;
}

module.exports = { prosesKoreksiLengkap };
