#!/usr/bin/env node
"use strict";

// Mengekstrak SVG emoji Fluent Emoji (Microsoft) yang dipakai landing ke
// site/images/emoji/.
//
// Alasan: landing di-host statis (GitHub Pages), jadi aset harus ikut repo.
// Paket @iconify-json/fluent-emoji menyimpan semua ikon dalam satu icons.json
// (99 MB, 3174 ikon); di sini hanya emoji yang dipakai yang ditulis sebagai SVG.
// Jalankan ulang setelah mengubah daftar EMOJI di bawah:
//
//   npm run emoji
//
// Lisensi: Fluent Emoji (github.com/microsoft/fluentui-emoji) oleh Microsoft,
// MIT. Atribusi ada di README.md.

const fs = require("fs");
const path = require("path");

// nama ikon di @iconify-json/fluent-emoji -> nama berkas keluaran + teks alternatif.
const EMOJI = [
  { icon: "pregnant-woman", name: "pregnant-woman", alt: "Ibu hamil" },
  { icon: "pill", name: "pill", alt: "Tablet tambah darah" },
  { icon: "alarm-clock", name: "alarm", alt: "Pengingat" },
];

const SRC = path.join(
  __dirname,
  "..",
  "node_modules",
  "@iconify-json",
  "fluent-emoji",
  "icons.json",
);
const OUT_DIR = path.join(__dirname, "..", "site", "images", "emoji");

function buildSvg(icon) {
  const w = icon.width || 32;
  const h = icon.height || 32;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${icon.body}</svg>`;
}

function main() {
  if (!fs.existsSync(SRC)) {
    console.error(
      "icons.json tidak ada. Jalankan: npm install (lihat package.json).",
    );
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(SRC, "utf8"));
  const icons = data.icons || {};
  const aliases = data.aliases || {};

  const lookup = (name) => {
    if (icons[name]) return icons[name];
    const alias = aliases[name];
    return alias ? icons[alias.parent] : null;
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Bersihkan berkas lama supaya sisa emoji yang tak dipakai tidak menumpuk.
  for (const file of fs.readdirSync(OUT_DIR)) {
    if (file.endsWith(".svg")) fs.unlinkSync(path.join(OUT_DIR, file));
  }

  let written = 0;
  const missing = [];
  for (const e of EMOJI) {
    const icon = lookup(e.icon);
    if (!icon) {
      missing.push(e.icon);
      continue;
    }
    fs.writeFileSync(path.join(OUT_DIR, `${e.name}.svg`), buildSvg(icon));
    written += 1;
  }

  console.log(`Emoji Fluent ditulis: ${written}/${EMOJI.length} -> ${OUT_DIR}`);
  if (missing.length) {
    console.error("Ikon tidak ditemukan:", missing.join(", "));
    process.exit(1);
  }
}

main();
