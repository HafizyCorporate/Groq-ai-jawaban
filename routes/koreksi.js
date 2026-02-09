/**
 * FILE: koreksi.js
 * TUGAS: Otak Analisis AI (via Gemini 2.5 Flash) & Perhitungan Nilai
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
     * UPDATE: Menggunakan Gemini 2.5 Flash
     */
    const model = genAI.getGenerativeModel({ 
        model: "gemini-2.5-flash" 
    });

    for (const [index, file] of files.entries()) {
        try {
            const base64Data = file.buffer.toString("base64");
            
            const prompt = `TUGAS: EKSTRAKSI DATA LJK.
            
            KUNCI PG: ${JSON.stringify(kunciPG)}
            KUNCI ESSAY: ${JSON.stringify(kunciEssay)}

            INSTRUKSI:
            Cari coretan (X/Centang/Lingkaran) pada gambar. 
            WAJIB masukkan setiap huruf jawaban ke dalam object "jawaban_pg". 
            JANGAN HANYA MENULIS DI 'log_deteksi'.

            CONTOH OUTPUT YANG SAYA INGINKAN (WAJIB):
            {
              "nama_siswa": "BUDI SANTOSO",
              "jawaban_pg": {
                "1": "A",
                "2": "C",
                "3": "B"
              },
              "analisis_essay": {
                "1": "BENAR"
              },
              "log_deteksi": "Catatan visual per nomor"
            }

            SEKARANG ANALISIS GAMBAR INI DAN BALAS HANYA DENGAN JSON MURNI!`;

            const imagePart = {
                inlineData: {
                    data: base64Data,
                    mimeType: file.mimetype || "image/jpeg"
                }
            };

            const result = await model.generateContent([prompt, imagePart]);
            const response = await result.response;
            const text = response.text();
            
            console.log(`--- JAWABAN MENTAH AI (FILE ${index + 1}) ---`);
            console.log(text);
            
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error("Format JSON tidak ditemukan dalam respon AI");
            
            const aiData = JSON.parse(jsonMatch[0]);

            // --- BAGIAN PEMBERSIH DATA (NEW) ---
            let jawabanPG = aiData.jawaban_pg || {};
            
            // Jika AI curhat di log tapi lupa ngisi object jawaban_pg, kita sisir manual teksnya
            if (Object.keys(jawabanPG).length === 0 && aiData.log_deteksi) {
                console.log("⚠️ Sistem: Mendeteksi object kosong, menyisir teks log_deteksi...");
                const barisLog = aiData.log_deteksi.split('\n');
                barisLog.forEach(baris => {
                    // Mencari pola angka dan huruf jawaban (A, B, C, atau D)
                    const match = baris.match(/(\d+)[:.]\s*(?:Jawaban\s*)?['"]?([A-D])['"]?/i);
                    if (match) {
                        jawabanPG[match[1]] = match[2].toUpperCase();
                    }
                });
            }
            // ------------------------------------

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
                const status = (analES[no] || "SALAH").toString();
                const isBenar = status.toUpperCase().includes("BENAR");
                if(isBenar) esBetul++;
                rincianProses.push(`Essay ${no}: ${isBenar ? "✅" : "❌"} ${status}`);
            });

            const nilaiPG = hitungNilaiAkhir(rumusPG, pgBetul, pgTotalKunci);
            const nilaiES = hitungNilaiAkhir(rumusES, esBetul, Object.keys(kunciEssay).length);
            const totalSkor = Math.round((nilaiPG + nilaiES) * 10) / 10;

            results.push({ 
                nama: (aiData.nama_siswa && aiData.nama_siswa !== "TULIS NAMA SISWA") ? aiData.nama_siswa.trim() : `Siswa ${index + 1}`, 
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
                nama: `GAGAL SCAN`, 
                log_detail: [err.message],
                info_ai: "Gagal memproses gambar. Coba pastikan foto tegak dan jelas.",
                nilai_akhir: 0
            });
        }
    }
    return results;
}

module.exports = { prosesKoreksiLengkap };
