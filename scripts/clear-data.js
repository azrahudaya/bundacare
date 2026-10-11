#!/usr/bin/env node
"use strict";

// Mengosongkan tabel DATA saja, tanpa menyentuh settings dan sesi admin.
//
// Alasan pemisahan ini: settings menyimpan hash password admin dan saklar runtime;
// admin_sessions menyimpan sesi login yang masih hidup. Menghapus keduanya membuat
// operator terkunci dari panel. Yang dibersihkan hanya data ibu/pendaftaran/log.
//
// Pakai:
//   node scripts/clear-data.js --yes
//   node scripts/clear-data.js --yes --db /path/lain.db
//
// Skrip ini TIDAK menyentuh berkas backup. Buat backup dulu (npm run backup).

const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

// Tabel data yang dikosongkan. Urutan tidak penting karena tidak ada FK yang dipakai.
const DATA_TABLES = [
  "users",
  "user_aliases",
  "reminder_logs",
  "postpartum_visit_logs",
  "registrations",
  "registration_decoys",
  "registration_activation_log",
  "allowed_numbers",
];

function run(db, sql, params = []) {
  return new Promise((resolve, reject) =>
    db.run(sql, params, function onDone(err) {
      if (err) reject(err);
      else resolve(this);
    }),
  );
}
function get(db, sql, params = []) {
  return new Promise((resolve, reject) =>
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row))),
  );
}
function close(db) {
  return new Promise((resolve) => db.close(() => resolve()));
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.includes("--yes")) {
    console.error(
      "Ini menghapus semua data ibu, pendaftaran, dan log. Jalankan dengan --yes kalau yakin.",
    );
    process.exit(1);
  }
  const dbFlag = args.indexOf("--db");
  const dbPath =
    dbFlag >= 0 && args[dbFlag + 1]
      ? args[dbFlag + 1]
      : process.env.DB_PATH || path.join(__dirname, "..", "data", "bundacare.db");

  if (!fs.existsSync(dbPath)) {
    console.error(`Basis data tidak ada: ${dbPath}`);
    process.exit(1);
  }

  const db = new sqlite3.Database(dbPath);
  db.configure("busyTimeout", 5000);
  try {
    const existing = new Set(
      (await new Promise((resolve, reject) =>
        db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, rows) =>
          err ? reject(err) : resolve(rows),
        ),
      )).map((r) => r.name),
    );

    let cleared = 0;
    for (const table of DATA_TABLES) {
      if (!existing.has(table)) {
        console.log(`lewati  ${table} (tabel tidak ada)`);
        continue;
      }
      const before = await get(db, `SELECT COUNT(*) AS c FROM "${table}"`);
      await run(db, `DELETE FROM "${table}"`);
      console.log(`kosong  ${table}: ${before.c} baris dihapus`);
      cleared += 1;
    }

    // Nomor autoincrement direset supaya id mulai dari 1 lagi.
    if (existing.has("sqlite_sequence")) {
      await run(db, "DELETE FROM sqlite_sequence");
      console.log("kosong  sqlite_sequence");
    }

    const kept = ["settings", "admin_sessions", "admin_magic_tokens"];
    for (const table of kept) {
      if (!existing.has(table)) continue;
      const row = await get(db, `SELECT COUNT(*) AS c FROM "${table}"`);
      console.log(`SIMPAN  ${table}: ${row.c} baris`);
    }

    console.log(`\nSelesai. ${cleared} tabel data dikosongkan.`);
  } finally {
    await close(db);
  }
}

main().catch((err) => {
  console.error("Gagal mengosongkan data:", err.message);
  process.exit(1);
});
