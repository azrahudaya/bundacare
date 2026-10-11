#!/usr/bin/env node
"use strict";

// Menyeragamkan footer: mengganti baris disclaimer medis di .footer-bottom dengan
// baris hak cipta biasa, di semua halaman site/*.html.
//
// Jalankan: node scripts/fix-footer.js

const fs = require("fs");
const path = require("path");

const SITE = path.join(__dirname, "..", "site");

const OLD = `<div class="wrap footer-bottom">
      <p>bundacare adalah alat bantu pengingat, bukan layanan darurat atau pengganti tenaga kesehatan.</p>
    </div>`;

const NEW = `<div class="wrap footer-bottom">
      <p>© 2026 bundacare.</p>
    </div>`;

function main() {
  const files = fs.readdirSync(SITE).filter((f) => f.endsWith(".html"));
  let changed = 0;
  for (const file of files) {
    const p = path.join(SITE, file);
    const html = fs.readFileSync(p, "utf8");
    if (!html.includes(OLD)) continue;
    fs.writeFileSync(p, html.split(OLD).join(NEW));
    console.log(`ubah   ${file}`);
    changed += 1;
  }
  console.log(`\nSelesai. ${changed} halaman diperbarui.`);
}

main();
