#!/usr/bin/env node
"use strict";

// Menyeragamkan halaman artikel: unduh gambar dari Kemenkes ke repo (self-host, bukan
// hotlink), buang <style> lokal, dan bungkus isi ke header/footer situs.
//
// Alasan self-host: hotlink ke situs pemerintah bisa gagal (CORS/hotlink protection)
// dan membebani server mereka. Gambar disimpan di site/images/artikel/.
//
// Jalankan: node scripts/normalize-articles.js

const fs = require("fs");
const path = require("path");
const https = require("https");

const SITE = path.join(__dirname, "..", "site");
const IMG_DIR = path.join(SITE, "images", "artikel");

// URL gambar Kemenkes -> nama berkas lokal (tanpa ekstensi, .jpg ditambahkan).
const IMAGES = [
  ["https://ayosehat.kemkes.go.id/imagex/content/7tablet-tambah-darah.png", "tablet-tambah-darah"],
  ["https://ayosehat.kemkes.go.id/imagex/content/9ea66f43bdd5759fb4909c29e503b348.webp", "anemia-ibu-hamil"],
  ["https://ayosehat.kemkes.go.id/imagex/content/19c5b3a795cc23cdc0774caf1e075786.webp", "gizi-ibu-hamil"],
  ["https://ayosehat.kemkes.go.id/imagex/content/8f0a9494df1a39aec2c429a9ee90b212.webp", "tanda-persalinan"],
  ["https://ayosehat.kemkes.go.id/imagex/content/8944b9d4b10d9e2e26ad74706749b845.webp", "kunjungan-nifas"],
  ["https://ayosehat.kemkes.go.id/imagex/content/d515cd44c540542a740d17a21e6e1c29.webp", "menyusui"],
];

const NAV = `  <header class="site-header">
    <div class="wrap header-inner">
      <a class="brand" href="index.html">bundacare<span class="brand-period">.</span></a>
      <nav class="header-nav" aria-label="Navigasi utama">
        <a href="index.html#cara-kerja">Cara kerja</a>
        <a href="index.html#bacaan">Bacaan</a>
        <a class="nav-action" href="index.html#daftar">Ikut pengingat</a>
      </nav>
    </div>
  </header>`;

const FOOTER = `  <footer class="site-footer">
    <div class="wrap footer-grid">
      <div>
        <a class="footer-brand" href="index.html">bundacare.</a>
        <p class="footer-tagline">Pengingat tablet tambah darah dan kontrol kesehatan ibu lewat WhatsApp.</p>
      </div>
      <div>
        <p class="footer-heading">Bacaan</p>
        <div class="footer-col">
          <a href="artikel-tablet-tambah-darah.html">Tablet tambah darah</a>
          <a href="artikel-anemia-ibu-hamil.html">Anemia pada ibu hamil</a>
          <a href="artikel-gizi-ibu-hamil.html">Gizi ibu hamil</a>
          <a href="artikel-tanda-persalinan.html">Tanda-tanda persalinan</a>
          <a href="artikel-kunjungan-nifas.html">Kunjungan masa nifas</a>
          <a href="artikel-menyusui.html">Menyusui</a>
        </div>
      </div>
      <div>
        <p class="footer-heading">Informasi</p>
        <div class="footer-col">
          <a href="tentang.html">Tentang</a>
          <a href="privasi.html">Kebijakan privasi</a>
          <a href="#isi">Kembali ke atas</a>
        </div>
      </div>
    </div>
    <div class="wrap footer-bottom">
      <p>bundacare adalah alat bantu pengingat, bukan layanan darurat atau pengganti tenaga kesehatan.</p>
    </div>
  </footer>`;

function fetchTo(url, dest) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "Mozilla/5.0 (bundacare self-host)" } }, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} untuk ${url}`));
          res.resume();
          return;
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          fs.writeFileSync(dest, Buffer.concat(chunks));
          resolve(fs.statSync(dest).size);
        });
      })
      .on("error", reject);
  });
}

async function downloadImages() {
  fs.mkdirSync(IMG_DIR, { recursive: true });
  const map = new Map();
  for (const [url, name] of IMAGES) {
    const dest = path.join(IMG_DIR, `${name}.jpg`);
    const size = await fetchTo(url, dest);
    map.set(url, `images/artikel/${name}.jpg`);
    console.log(`unduh  ${name}.jpg (${size} byte)`);
  }
  return map;
}

function rewrite(html, imgMap) {
  let out = html;
  // Buang <style>...</style> lokal (gaya ikut styles.css situs).
  out = out.replace(/<style>[\s\S]*?<\/style>\s*/i, "");
  // Ganti src gambar Kemenkes dengan berkas lokal.
  for (const [url, local] of imgMap) {
    out = out.split(url).join(local);
  }
  return out;
}

function buildDocument(original, imgMap) {
  const title = (original.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || "Artikel";
  const desc = (original.match(/<meta name="description" content="([\s\S]*?)">/i) || [])[1] || "";
  // Isi artikel = di dalam <article>...</article>.
  const inner = (original.match(/<article>([\s\S]*?)<\/article>/i) || [])[1] || original;
  const body = rewrite(inner, imgMap).trim();
  return `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#C7354D">
  <meta name="description" content="${desc}">
  <link rel="icon" href="data:,">
  <title>${title} | Bundacare</title>
  <link rel="stylesheet" href="styles.css">
  <script src="config.js"></script>
</head>
<body>
  <a class="skip-link" href="#isi">Lewati ke isi</a>
${NAV}
  <main id="isi" class="doc-page">
    <a class="doc-back" href="index.html#bacaan">← Kembali ke Bacaan</a>
${body}
    <p class="doc-updated">Terakhir diperbarui: 11 Oktober 2026</p>
  </main>
${FOOTER}
</body>
</html>
`;
}

async function main() {
  const imgMap = await downloadImages();
  const files = fs.readdirSync(SITE).filter((f) => /^artikel-.*\.html$/.test(f));
  for (const file of files) {
    const p = path.join(SITE, file);
    const original = fs.readFileSync(p, "utf8");
    fs.writeFileSync(p, buildDocument(original, imgMap));
    console.log(`tulis  ${file}`);
  }
  console.log(`\nSelesai. ${files.length} artikel diseragamkan.`);
}

main().catch((err) => {
  console.error("Gagal menyeragamkan artikel:", err.message);
  process.exit(1);
});
