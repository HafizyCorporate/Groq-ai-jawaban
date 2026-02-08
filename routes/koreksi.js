/**
 * FILE: logika.js / koreksi.js
 * TUGAS: Otak Analisis AI (via API) & Perhitungan Nilai
 */

// Tidak perlu require("groq-sdk") lagi
const dotenv = require('dotenv');
dotenv.config();

async function prosesKoreksiLengkap(files, settings, rumusPG, rumusES) {
    const kunciPG = settings.kunci_pg || {};
    const kunciEssay = settings.kunci_essay || {};
    const results = [];

    // Helper untuk hitung rumus secara aman
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
            
            // TAHAP 1: VISION AI MENGGUNAKAN FETCH API (LLAMA-4 MAVERICK)
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
                                "text": `ANDA ADALAH GURU PROFESIONAL. TUGAS: Koreksi LJK (PG & ESSAY).

                                INSTRUKSI PILIHAN GANDA (PG):
                                1. **Pemisah Soal & Jawaban**: Fokus analisis HANYA pada area label huruf opsi (a, b, c, d).
                                2. **Logika Coretan (X)**:
                                   - Jawaban Siswa adalah huruf yang tertutup coretan PALING TEBAL, PEKAT, dan GELAP.
                                   - **Filter Penghapus**: Jika ada coretan samar/abu-abu (bekas hapusan), JANGAN DIPILIH.
                                
                                INSTRUKSI ESSAY:
                                1. Baca tulisan tangan siswa. Bandingkan dengan Kunci: ${JSON.stringify(kunciEssay)}.
                                2. Nyatakan BENAR jika mengandung INTI MAKNA yang sesuai.

                                WAJIB OUTPUT JSON MURNI:
                                {
                                  "nama_siswa": "Detect Nama Siswa",
                                  "jawaban_pg": {"1": "A", "2": "B", ...},
                                  "analisis_essay": {"1": "BENAR/SALAH (Alasan)", ...},
                                  "log_deteksi": "Penjelasan visual deteksi per nomor."
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
            const aiData = JSON.parse(rawData.choices[0].message.content);
            const jawabanPG = aiData.jawaban_pg || {};
            const analES = aiData.analisis_essay || {};
            
            // TAHAP 2: HITUNG BETUL/SALAH (LOGIKA CODING)
            let pgBetul = 0;
            let pgTotalKunci = 0;
            let esBetul = 0;
            let rincianProses = [];

            // Cek PG
            Object.keys(kunciPG).forEach(nomor => {
                if (kunciPG[nomor] !== "") {
                    pgTotalKunci++;
                    const jawabSiswa = (jawabanPG[nomor] || "KOSONG").toUpperCase();
                    const jawabKunci = kunciPG[nomor].toUpperCase();
                    
                    if (jawabSiswa === jawabKunci) {
                        pgBetul++;
                        rincianProses.push(`No ${nomor}: ✅ Benar (Siswa: ${jawabSiswa})`);
                    } else {
                        rincianProses.push(`No ${nomor}: ❌ Salah (Siswa: ${jawabSiswa}, Kunci: ${jawabKunci})`);
                    }
                }
            });

            // Cek Essay
            Object.keys(kunciEssay).forEach(no => {
                const status = analES[no] || "SALAH";
                const isBenar = status.toUpperCase().includes("BENAR");
                if(isBenar) esBetul++;
                rincianProses.push(`Essay ${no}: ${isBenar ? "✅" : "❌"} ${status}`);
            });

            // TAHAP 3: HITUNG NILAI AKHIR BERDASARKAN RUMUS
            const nilaiPG = hitungNilaiAkhir(rumusPG, pgBetul, pgTotalKunci);
            const nilaiES = hitungNilaiAkhir(rumusES, esBetul, Object.keys(kunciEssay).length);
            const totalSkor = Math.round((nilaiPG + nilaiES) * 10) / 10;

            results.push({ 
                nama: aiData.nama_siswa || `Siswa ${index + 1}`, 
                pg_betul: pgBetul,
                pg_total: pgTotalKunci,
                es_betul: esBetul,
                nomor_pg_betul: rincianProses.filter(t => t.includes('✅')).map(t => t.split(':')[0]).join(', '),
                log_detail: rincianProses,
                info_ai: aiData.log_deteksi,
                nilai_akhir: totalSkor
            }); 

        } catch (err) {
            console.error("Detail Error:", err);
            results.push({ nama: "Error Scan", log_detail: [err.message] });
        }
    }
    return results;
}

module.exports = { prosesKoreksiLengkap };
