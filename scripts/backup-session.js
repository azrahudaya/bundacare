#!/usr/bin/env node
"use strict";

// Backup sesi WhatsApp (.wwebjs_auth) tanpa menghentikan bot.
//
// Kenapa terpisah dari backup database: sesi LocalAuth adalah kredensial tertaut.
// Kalau folder ini hilang, bot tidak bisa pulih sendiri — operator harus menautkan
// ulang dengan QR atau kode pairing. Folder sesi berisi ~227 MB, tetapi sebagian
// besarnya cache Chromium yang bisa dibuang; hanya data yang benar-benar menyimpan
// kredensial sesi yang diarsipkan, sehingga hasilnya kecil dan cepat.
//
// Hasil arsip berisi kredensial: selalu dienkripsi kalau BACKUP_SESSION_PASSPHRASE
// diisi, dan tanpa itu skrip menolak jalan kecuali BACKUP_SESSION_ALLOW_PLAINTEXT=1.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const AUTH_DIR = process.env.WA_AUTH_DIR || path.join(__dirname, "..", ".wwebjs_auth");
const SESSION_NAME = `session-${process.env.WA_CLIENT_ID || "remindcare"}`;
const SESSION_DIR = path.join(AUTH_DIR, SESSION_NAME);
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, "..", "data", "backups");
const KEEP_DAYS = Number(process.env.BACKUP_SESSION_KEEP_DAYS || process.env.BACKUP_KEEP_DAYS || 14);
const OFFSITE_DIR = String(process.env.BACKUP_SESSION_OFFSITE_DIR || process.env.BACKUP_OFFSITE_DIR || "").trim();
const REMOTE_CMD = String(process.env.BACKUP_SESSION_REMOTE_CMD || process.env.BACKUP_REMOTE_CMD || "").trim();
const PASSPHRASE = String(process.env.BACKUP_SESSION_PASSPHRASE || "");
const ALLOW_PLAINTEXT = /^(1|true)$/i.test(process.env.BACKUP_SESSION_ALLOW_PLAINTEXT || "");

// Cache dan artefak yang bisa dibangun ulang Chromium. Membuang ini memangkas arsip
// dari ~227 MB menjadi belasan MB tanpa kehilangan kemampuan memulihkan sesi.
const EXCLUDES = [
  "Default/Cache",
  "Default/Code Cache",
  "Default/GPUCache",
  "Default/DawnGraphiteCache",
  "Default/DawnWebGPUCache",
  "Default/ShaderCache",
  "Default/Service Worker/CacheStorage",
  "Default/Service Worker/ScriptCache",
  "Default/Shared Dictionary",
  "Default/File System",
  "component_crx_cache",
  "extensions_crx_cache",
  "Crashpad",
  "BrowserMetrics",
  "GrShaderCache",
  "GPUPersistentCache",
  "GraphiteDawnCache",
  "OptimizationGuideModels",
  "OnDeviceHeadSuggestModel",
  "segmentation_platform",
  "SingletonLock",
  "SingletonSocket",
  "SingletonCookie",
];

function stamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function rotate(keepDays) {
  if (!fs.existsSync(BACKUP_DIR)) {
    return [];
  }
  const cutoff = Date.now() - keepDays * 86400000;
  const removed = [];
  for (const name of fs.readdirSync(BACKUP_DIR)) {
    if (!name.startsWith("bundacare-session-")) {
      continue;
    }
    const full = path.join(BACKUP_DIR, name);
    if (fs.statSync(full).mtimeMs < cutoff) {
      fs.unlinkSync(full);
      removed.push(name);
    }
  }
  return removed;
}

function copyOffsite(target) {
  if (!OFFSITE_DIR) {
    return null;
  }
  fs.mkdirSync(OFFSITE_DIR, { recursive: true });
  const dest = path.join(OFFSITE_DIR, path.basename(target));
  fs.copyFileSync(target, dest);
  const srcSize = fs.statSync(target).size;
  const destSize = fs.statSync(dest).size;
  if (srcSize !== destSize) {
    throw new Error(`ukuran salinan sesi di luar VPS berbeda (${srcSize} vs ${destSize})`);
  }
  return `salinan sesi luar VPS: ${dest}`;
}

function runRemoteCommand(target) {
  if (!REMOTE_CMD) {
    return null;
  }
  execFileSync("sh", ["-c", REMOTE_CMD.replace(/%f/g, target)], { stdio: "inherit" });
  return "perintah luar VPS untuk sesi dijalankan";
}

function archive(target) {
  const excludeArgs = EXCLUDES.map((item) => `--exclude=${item}`);
  // Profil Chromium sedang ditulis saat bot hidup: file bisa berubah/terhapus di
  // tengah pembacaan. Itu wajar, bukan kegagalan, jadi jangan hentikan arsip.
  const args = [
    "-czf",
    target,
    "--warning=no-file-changed",
    "--warning=no-file-removed",
    "--ignore-failed-read",
    ...excludeArgs,
    "-C",
    AUTH_DIR,
    SESSION_NAME,
  ];
  try {
    execFileSync("tar", args, { stdio: "pipe" });
  } catch (err) {
    // tar mengembalikan 1 kalau ada berkas berubah saat dibaca; arsipnya tetap sah.
    if (err.status !== 1) {
      throw err;
    }
    console.warn("tar melaporkan berkas berubah saat dibaca; arsip tetap dibuat.");
  }
}

function encryptInPlace(target) {
  const encTarget = `${target}.gpg`;
  // --batch + --yes supaya tidak ada prompt interaktif di dalam timer systemd.
  execFileSync(
    "gpg",
    [
      "--batch",
      "--yes",
      "--pinentry-mode",
      "loopback",
      "--passphrase-fd",
      "0",
      "--cipher-algo",
      "AES256",
      "-c",
      "-o",
      encTarget,
      target,
    ],
    { input: PASSPHRASE, stdio: ["pipe", "pipe", "pipe"] },
  );
  fs.unlinkSync(target);
  return encTarget;
}

function verifyArchive(target) {
  // Uji baca arsip: daftar isinya harus memuat penanda sesi WhatsApp.
  // Arsip terenkripsi didekripsi dulu ke berkas sementara, baru didaftar — karena
  // keluaran `gpg -d` adalah byte tar.gz, bukan daftar nama.
  let listing;
  if (target.endsWith(".gpg")) {
    const tmp = `${target}.verify.tar.gz`;
    try {
      execFileSync(
        "gpg",
        [
          "--batch",
          "--yes",
          "--pinentry-mode",
          "loopback",
          "--passphrase-fd",
          "0",
          "-d",
          "-o",
          tmp,
          target,
        ],
        { input: PASSPHRASE, stdio: ["pipe", "pipe", "pipe"] },
      );
      listing = execFileSync("tar", ["-tzf", tmp], {
        stdio: ["pipe", "pipe", "pipe"],
        maxBuffer: 64 * 1024 * 1024,
      });
    } finally {
      if (fs.existsSync(tmp)) {
        fs.unlinkSync(tmp);
      }
    }
  } else {
    listing = execFileSync("tar", ["-tzf", target], {
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
  }
  const text = String(listing);
  if (!text.includes(SESSION_NAME)) {
    throw new Error("arsip sesi tidak memuat folder sesi yang diharapkan");
  }
  const hasCookies = text.includes("Default/Cookies") || text.includes("Default/IndexedDB");
  if (!hasCookies) {
    throw new Error("arsip sesi tidak memuat data kredensial (Cookies/IndexedDB)");
  }
}

function main() {
  if (!fs.existsSync(SESSION_DIR)) {
    console.error(`Folder sesi tidak ditemukan: ${SESSION_DIR}. Lewati backup sesi.`);
    process.exit(1);
  }
  if (!PASSPHRASE && !ALLOW_PLAINTEXT) {
    console.error(
      "BACKUP_SESSION_PASSPHRASE kosong. Arsip sesi memuat kredensial tertaut, jadi " +
        "skrip menolak menyimpan tanpa enkripsi. Isi passphrase, atau set " +
        "BACKUP_SESSION_ALLOW_PLAINTEXT=1 kalau memang sadar risikonya.",
    );
    process.exit(1);
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
  const base = path.join(BACKUP_DIR, `bundacare-session-${stamp()}.tar.gz`);
  if (fs.existsSync(base) || fs.existsSync(`${base}.gpg`)) {
    console.log(`Backup sesi hari ini sudah ada: ${base}`);
    return;
  }

  archive(base);
  fs.chmodSync(base, 0o600);

  let target = base;
  if (PASSPHRASE) {
    target = encryptInPlace(base);
    fs.chmodSync(target, 0o600);
  } else {
    console.warn(
      "PERINGATAN: arsip sesi disimpan TANPA enkripsi. Siapa pun yang membaca berkas " +
        "ini bisa memakai sesi WhatsApp bot.",
    );
  }

  try {
    verifyArchive(target);
  } catch (err) {
    fs.unlinkSync(target);
    console.error(`Backup sesi gagal diuji: ${err.message}. File dihapus.`);
    process.exit(1);
  }

  const size = fs.statSync(target).size;
  const removed = rotate(KEEP_DAYS);
  console.log(
    `Backup sesi ok: ${target} (${Math.round(size / 1024 / 1024)} MB, terenkripsi: ${Boolean(PASSPHRASE)})`,
  );
  if (removed.length) {
    console.log(`Backup sesi lama dihapus: ${removed.join(", ")}`);
  }

  const copyNote = copyOffsite(target);
  const remoteNote = runRemoteCommand(target);
  if (copyNote) {
    console.log(copyNote);
  }
  if (remoteNote) {
    console.log(remoteNote);
  }
  if (!OFFSITE_DIR && !REMOTE_CMD) {
    console.warn(
      "PERINGATAN: backup sesi hanya tersimpan di VPS ini. Isi BACKUP_SESSION_OFFSITE_DIR " +
        "atau BACKUP_SESSION_REMOTE_CMD supaya sesi bisa dipulihkan kalau VPS hilang.",
    );
  }
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("Backup sesi gagal:", err.message);
    process.exit(1);
  }
}

module.exports = { EXCLUDES, stamp };
