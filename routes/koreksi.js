/**
 * FILE: koreksi.js
 * TUGAS: Otak Analisis AI (via API) & Perhitungan Nilai
 */

const dotenv = require('dotenv');
dotenv.config();

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

    for (const [index, file] of files.entries()) {
        try {
            const base64 = file.buffer.toString("base64");
            
            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    "model": "meta-llama/llama-4-scout-17b-16e-instruct",
                    "messages": [{
                        "role": "user",
                        "content": [
                            { 
                                "type": "text", 
                                "text": `ANDA ADALAH GURU SUPER TELITI DENGAN KEMAMPUAN VISUAL DETEKTIF. 
                                TUGAS: Koreksi LJK dengan metode Identifikasi Tumpang Tindih (Overlay).

                                ATURAN DETEKSI (WAJIB):
                                1. **Fokus Interaksi Tinta**: Abaikan posisi relatif (kiri/kanan). Jawaban siswa adalah huruf opsi (a, b, c, atau d) yang SECARA FISIK TERTUTUP atau TERTINDIH oleh coretan manual (X, centang, atau coretan tebal).
                                2. **Identifikasi Huruf di Bawah Tinta**: Jika Anda melihat coretan tangan, lihat huruf karakter apa yang ada tepat di bawah coretan tersebut. Jika huruf 'a' tertutup tinta, maka jawabannya ADALAH 'A'.
                                3. **Non-Asumsi Layout**: Jangan berasumsi opsi selalu sejajar. Bisa saja opsi 'c' atau 'd' berada di bawah 'a' atau 'b'. Selalu cari huruf yang tertindih tinta di setiap nomor soal.
                                4. **Deteksi Multi-Alat**: Siswa menggunakan Pensil/Pulpen/Spidol. Abaikan bayangan samar atau bekas hapusan. Pilih coretan yang paling TEBAL dan KONTRAS.

                                INSTRUKSI ESSAY:
                                - Bandingkan dengan Kunci: ${JSON.stringify(kunciEssay)}. Nyatakan BENAR jika inti maknanya sama.

                                WAJIB OUTPUT JSON MURNI:
                                {
                                  "nama_siswa": "Detect Nama dari kertas",
                                  "jawaban_pg": {"1": "A", "2": "B", ...},
                                  "analisis_essay": {"1": "BENAR/SALAH (Alasan)", ...},
                                  "log_deteksi": "Wajib jelaskan visual per nomor (Contoh: No 4 coretan tangan secara fisik menutupi huruf 'a', opsi b, c, d bersih total)."
                                }` 
                            },
                            { "type": "image_url", "image_url": { "url": `data:image/jpeg;base64,${base64}` } }
                        ]
                    }],
                    "response_format": { "type": "json_object" },
                    "temperature": 0
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error?.message || "Gagal menghubungi API Groq");
            }

            const rawData = await response.json();
            
            let aiData;
            try {
                aiData = JSON.parse(rawData.choices[0].message.content);
            } catch (e) {
                const content = rawData.choices[0].message.content;
                const jsonMatch = content.match(/\{[\s\S]*\}/);
                aiData = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
            }

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
                nomor_pg_betul: rincianProses.filter(t => t.includes('✅')).map(t => t.split(':')[0].replace('No ', '')).join(', '),
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
