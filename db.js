const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, './db/database.sqlite'), (err) => {
    if (err) console.error("Database Error:", err);
    else console.log("Database CekTugas Ready.");
});

// Membuat tabel history koreksi jika belum ada
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS history_koreksi (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        kunci_jawaban TEXT,
        skor INTEGER,
        analisis TEXT,
        feedback TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

module.exports = db;
