#!/usr/bin/env node
"use strict";

// Membuat thumbnail kartu artikel dari gambar sumber di site/images/artikel/.
//
// Alasan: gambar sumber punya rasio berbeda-beda (1,3 sampai 4,6) sehingga kartu
// terlihat tidak rapi. Thumbnail diseragamkan ke 16:10 dengan crop terpusat, lalu
// disimpan sebagai JPEG kualitas 82 di site/images/artikel/thumb/.
//
// Beberapa sumber diganti karena tidak cocok jadi thumbnail (mis. tangkapan video
// dengan tombol play, atau banner teks sangat lebar).
//
// Jalankan: npm run thumbs

const fs = require("fs");
const path = require("path");
const https = require("https");
const { execFileSync } = require("child_process");

const SITE = path.join(__dirname, "..", "site");
const DIR = path.join(SITE, "images", "artikel");
const THUMB_DIR = path.join(DIR, "thumb");

const RATIO = 16 / 10; // lebar / tinggi
const TARGET_W = 640;

// slug -> sumber. Kalau `remote` diisi, gambar diunduh dulu ke DIR/<slug>.jpg.
// `gravity` menentukan arah crop: center (default), east, atau west. Dipakai saat
// subjek gambar tidak di tengah (mis. banner dengan teks di kiri, ilustrasi di kanan).
const SOURCES = [
  { slug: "tablet-tambah-darah", remote: "https://ayosehat.kemkes.go.id/imagex/content/8f1bf3c05c78ebcc6356b7c0b31f1e50.webp" },
  { slug: "anemia-ibu-hamil", file: "anemia-ibu-hamil.jpg", gravity: "east" },
  { slug: "gizi-ibu-hamil", file: "gizi-ibu-hamil.jpg" },
  { slug: "tanda-persalinan", file: "tanda-persalinan.jpg" },
  { slug: "kunjungan-nifas", file: "kunjungan-nifas.jpg" },
  { slug: "menyusui", file: "menyusui.jpg" },
];

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
          resolve();
        });
      })
      .on("error", reject);
  });
}

function cropToRatio(src, dest, gravity = "center") {
  // ImageMagick: crop terpusat ke rasio 16:10, lalu resize ke lebar target.
  // gravity bisa 'center', 'east', 'northeast', dst. untuk memilih bagian gambar
  // yang dipertahankan saat rasio sumber sangat lebar.
  execFileSync("convert", [
    src,
    "-auto-orient",
    "-gravity", gravity,
    "-crop", `${RATIO.toFixed(4)}:1`,
    "+repage",
    "-resize", `${TARGET_W}x`,
    "-strip",
    "-quality", "82",
    dest,
  ]);
}

async function main() {
  fs.mkdirSync(THUMB_DIR, { recursive: true });
  for (const s of SOURCES) {
    const src = path.join(DIR, `${s.slug}.jpg`);
    if (s.remote) {
      await fetchTo(s.remote, src);
      console.log(`unduh  ${s.slug}.jpg (sumber baru)`);
    }
    const from = path.join(DIR, s.file || `${s.slug}.jpg`);
    if (!fs.existsSync(from)) {
      console.error(`lewati  ${s.slug}: sumber ${from} tidak ada`);
      continue;
    }
    const dest = path.join(THUMB_DIR, `${s.slug}.jpg`);
    cropToRatio(from, dest, s.gravity);
    const size = fs.statSync(dest).size;
    console.log(`thumb  ${s.slug}.jpg (${size} byte)`);
  }
  console.log(`\nSelesai. Thumbnail di ${THUMB_DIR}`);
}

main().catch((err) => {
  console.error("Gagal membuat thumbnail:", err.message);
  process.exit(1);
});
