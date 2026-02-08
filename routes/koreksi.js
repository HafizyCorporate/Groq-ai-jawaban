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
                                "text": `ANDA ADALAH GURU PROFESIONAL YANG SANGAT TELITI. TUGAS: Koreksi LJK (PG & ESSAY).

                                INSTRUKSI KHUSUS DETEKSI (PENTING!):
                                1. **Deteksi Multi-Alat Tulis**: Siswa mungkin menjawab menggunakan PENSIL, PULPEN (HITAM/BIRU/MERAH), atau SPIDOL.
                                2. **Logika Kontras**: Fokus pada coretan tambahan (X, centang, atau lingkaran) yang menimpa huruf opsi (a, b, atau c). 
                                3. **Prioritas Kepekatan**: Jika ada bekas hapusan (samar), JANGAN DIPILIH. Pilih coretan yang paling TEBAL dan JELAS menutupi huruf.
                                4. **Akurasi Posisi**: Pastikan coretan benar-benar berada di atas huruf pilihan. Jika huruf 'b' dicoret/dicentang secara tegas dan 'a' bersih, maka jawabannya adalah 'B'.

                                INSTRUKSI PILIHAN GANDA (PG):
                                - Analisis tanda SILANG (X), CENTANG (v), atau CORETAN yang menutupi opsi.
                                - Pastikan nomor soal (1-13) sesuai urutan di kertas.

                                INSTRUKSI ESSAY:
                                - Bandingkan jawaban dengan Kunci: ${JSON.stringify(kunciEssay)}.
                                - Nyatakan BENAR jika mengandung INTI MAKNA yang sesuai.

                                WAJIB OUTPUT JSON MURNI:
                                {
                                  "nama_siswa": "Detect Nama dari kertas",
                                  "jawaban_pg": {"1": "A", "2": "B", ...},
                                  "analisis_essay": {"1": "BENAR/SALAH (Alasan)", ...},
                                  "log_deteksi": "Jelaskan deteksi per nomor (Contoh: No 1: Huruf B tertutup coretan pensil tebal)."
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
