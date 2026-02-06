require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const koreksiRoute = require('./routes/koreksi');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: 'te-az-ha-secret',
    resave: false,
    saveUninitialized: true
}));

// Menggunakan Route Koreksi
app.use('/ai', koreksiRoute);

// Statis Folder untuk Dashboard
app.use(express.static(path.join(__dirname, 'views')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server CekTugas running on port ${PORT}`));
