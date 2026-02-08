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
                                "text": `ANDA ADALAH GURU PROFESIONAL. TUGAS: Koreksi LJK (PG & ESSAY).

                                INSTRUKSI PILIHAN GANDA (PG):
                                1. **Pemisah Soal & Jawaban**: Fokus analisis HANYA pada area label huruf opsi (a, b, c, d).
                                2. **Logika Coretan (X)**:
                                   - Jawaban Siswa adalah huruf yang tertutup coretan PALING TEBAL, PEKAT, dan GELAP.
                                   - **Filter Penghapus**: Jika ada coretan samar/abu-abu (bekas hapusan), JANGAN DIPILIH.
                                
                                INSTRUKSI ESSAY:
                                1. Baca tulisan tangan siswa. Bandingkan dengan Kunci: ${JSON.stringify(kunciEssay)}.
                                2. Nyatakan BENAR jika mengandung INTI MAKNA yang sesuai.

                                WAJIB OUTPUT JSON MURNI TANPA PREAMBLE/TEKS LAIN.` 
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
            
            // Tambahan: Pengamanan parse JSON agar tidak crash jika AI "bermuka dua"
            let aiData;
            try {
                aiData = JSON.parse(rawData.choices[0].message.content);
            } catch (e) {
                // Jika gagal parse, cari bracket JSON secara manual
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
                // Tambahan .trim() agar nama siswa bersih
                nama: (aiData.nama_siswa || `Siswa ${index + 1}`).trim(), 
                pg_betul: pgBetul,
                pg_total: pgTotalKunci,
                es_betul: esBetul,
                nomor_pg_betul: rincianProses.filter(t => t.includes('✅')).map(t => t.split(':')[0].replace('No ', '')).join(', '),
                log_detail: rincianProses,
                info_ai: aiData.log_deteksi || "Tidak ada log visual.",
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
