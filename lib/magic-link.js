"use strict";

// Autentikasi panel admin memakai magic link.
//
// Alasan keputusan:
// - Tidak ada password yang disimpan atau diketik, jadi tidak ada yang bisa dicuri dari
//   form login. Satu tautan berumur pendek dikirim ke email admin.
// - Token magic link dan token sesi hanya disimpan sebagai hash SHA-256. Bocornya isi
//   basis data tidak langsung memberi tautan yang bisa dipakai.
// - Sesi disimpan di SQLite, bukan di memori proses. Restart service tidak lagi
//   memaksa operator masuk ulang, jadi "sesi aktif lama" benar-benar bertahan.
// - Sesi terikat pada sidik jari (alamat IP + User-Agent) saat login. Cookie yang
//   dicuri dari mesin lain tidak berguna.
// - Tautan magic link sekali pakai dan berumur pendek (default 15 menit).

const crypto = require("node:crypto");
const nodemailer = require("nodemailer");

const MAGIC_TTL_MS = Number(process.env.MAGIC_LINK_TTL_MS || 15 * 60 * 1000);
const SESSION_TTL_MS = Number(
  process.env.ADMIN_WEB_SESSION_TTL_MS || 30 * 24 * 60 * 60 * 1000,
);
const IDLE_TIMEOUT_MS = Number(
  process.env.ADMIN_WEB_IDLE_TIMEOUT_MS || 14 * 24 * 60 * 60 * 1000,
);
const RATE_WINDOW_MS = Number(process.env.MAGIC_LINK_RATE_WINDOW_MS || 15 * 60 * 1000);
const RATE_MAX_PER_EMAIL = Number(process.env.MAGIC_LINK_RATE_MAX_PER_EMAIL || 5);
const RATE_MAX_PER_IP = Number(process.env.MAGIC_LINK_RATE_MAX_PER_IP || 10);

const rateState = new Map();

function run(db, sql, params = []) {
  return new Promise((resolve, reject) =>
    db.run(sql, params, function (err) {
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

async function initMagicAuth(db) {
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS admin_magic_tokens (
      token_hash TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT
    )`,
  );
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      csrf TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      expires_at TEXT NOT NULL
    )`,
  );
  await run(
    db,
    "CREATE INDEX IF NOT EXISTS idx_admin_magic_email ON admin_magic_tokens (email, expires_at)",
  );
}

function sha256(input) {
  return crypto.createHash("sha256").update(String(input)).digest("hex");
}

function newToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function normalizeEmail(input) {
  if (typeof input !== "string") return null;
  const email = input.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function adminEmails() {
  return String(process.env.ADMIN_EMAILS || "")
    .split(/[\s,;]+/)
    .map((e) => normalizeEmail(e))
    .filter(Boolean);
}

function isAllowedAdminEmail(email) {
  const list = adminEmails();
  return list.length > 0 && list.includes(normalizeEmail(email));
}

function magicLinkBaseUrl() {
  const explicit = String(process.env.ADMIN_WEB_PUBLIC_URL || "").trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  return "";
}

// Batas laju sederhana di memori: cukup untuk mencegah pengiriman email beruntun dari
// satu alamat atau satu email. Dibersihkan tiap kali diperiksa.
function rateLimited(kind, key) {
  const now = Date.now();
  for (const [k, v] of rateState) {
    if (now - v.start >= RATE_WINDOW_MS) rateState.delete(k);
  }
  const composite = `${kind}:${key}`;
  const record = rateState.get(composite) || { start: now, count: 0 };
  record.count += 1;
  rateState.set(composite, record);
  const max = kind === "email" ? RATE_MAX_PER_EMAIL : RATE_MAX_PER_IP;
  return record.count > max;
}

function resetRateState() {
  rateState.clear();
}

async function createMagicToken(db, email) {
  const token = newToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + MAGIC_TTL_MS);
  // Bersihkan token kedaluwarsa supaya tabel tidak menumpuk.
  await run(db, "DELETE FROM admin_magic_tokens WHERE expires_at <= ?", [
    now.toISOString(),
  ]);
  await run(
    db,
    `INSERT INTO admin_magic_tokens (token_hash, email, created_at, expires_at, used_at)
     VALUES (?,?,?,?,NULL)`,
    [sha256(token), normalizeEmail(email), now.toISOString(), expiresAt.toISOString()],
  );
  return { token, expiresAt: expiresAt.toISOString() };
}

// Mengonsumsi token secara atomik: hanya satu permintaan yang bisa menukarnya menjadi
// sesi, walau tautan diklik dua kali berbarengan.
// Intip token tanpa menghabiskannya. Dipakai halaman GET supaya prefetch tautan
// (misal pemindai Gmail atau in-app browser) tidak menghanguskan token sekali-pakai
// sebelum pengguna benar-benar menekan tombol masuk. Token tetap sekali-pakai: yang
// menghabiskannya adalah POST /admin/auth, bukan GET.
async function peekMagicToken(db, rawToken) {
  if (typeof rawToken !== "string" || rawToken.length < 20) return null;
  const hash = sha256(rawToken);
  const now = new Date().toISOString();
  const row = await get(
    db,
    "SELECT email FROM admin_magic_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?",
    [hash, now],
  );
  return row ? row.email : null;
}

async function consumeMagicToken(db, rawToken) {
  if (typeof rawToken !== "string" || rawToken.length < 20) return null;
  const hash = sha256(rawToken);
  const now = new Date().toISOString();
  const result = await run(
    db,
    `UPDATE admin_magic_tokens SET used_at = ?
     WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`,
    [now, hash, now],
  );
  if (!result.changes) return null;
  const row = await get(db, "SELECT email FROM admin_magic_tokens WHERE token_hash = ?", [
    hash,
  ]);
  return row ? row.email : null;
}

function sessionFingerprint(ip, userAgent) {
  const agent = String(userAgent || "").slice(0, 200);
  return sha256(`${ip || ""}|${agent}`);
}

async function createSession(db, email, fingerprint) {
  const token = newToken();
  const csrf = newToken();
  const now = new Date();
  await run(db, "DELETE FROM admin_sessions WHERE expires_at <= ?", [
    now.toISOString(),
  ]);
  await run(
    db,
    `INSERT INTO admin_sessions
      (token_hash, email, csrf, fingerprint, created_at, last_seen, expires_at)
     VALUES (?,?,?,?,?,?,?)`,
    [
      sha256(token),
      normalizeEmail(email),
      csrf,
      fingerprint,
      now.toISOString(),
      now.toISOString(),
      new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
    ],
  );
  return { token, csrf, expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString() };
}

async function getSession(db, rawToken, fingerprint) {
  if (typeof rawToken !== "string" || rawToken.length < 20) return null;
  const row = await get(db, "SELECT * FROM admin_sessions WHERE token_hash = ?", [
    sha256(rawToken),
  ]);
  if (!row) return null;
  const now = Date.now();
  const expired = Date.parse(row.expires_at) <= now;
  const idle = IDLE_TIMEOUT_MS > 0 && now - Date.parse(row.last_seen) > IDLE_TIMEOUT_MS;
  const wrongFingerprint = fingerprint && row.fingerprint !== fingerprint;
  if (expired || idle || wrongFingerprint) {
    await run(db, "DELETE FROM admin_sessions WHERE token_hash = ?", [row.token_hash]);
    return null;
  }
  const nowIso = new Date(now).toISOString();
  await run(db, "UPDATE admin_sessions SET last_seen = ? WHERE token_hash = ?", [
    nowIso,
    row.token_hash,
  ]);
  return { email: row.email, csrf: row.csrf, tokenHash: row.token_hash, expiresAt: row.expires_at };
}

async function deleteSession(db, rawToken) {
  if (typeof rawToken !== "string" || !rawToken) return;
  await run(db, "DELETE FROM admin_sessions WHERE token_hash = ?", [sha256(rawToken)]);
}

// Perbarui last_seen dan expires_at sesi yang sedang dipakai (sesi "rolling").
// Dipanggil dari getAdminSession supaya perpanjangan bertahan setelah restart service.
async function touchSession(db, tokenHash, expiresAtMs) {
  if (!tokenHash) return;
  await run(
    db,
    "UPDATE admin_sessions SET last_seen = ?, expires_at = ? WHERE token_hash = ?",
    [
      new Date().toISOString(),
      new Date(Number(expiresAtMs) || Date.now()).toISOString(),
      tokenHash,
    ],
  );
}

async function deleteSessionsByEmail(db, email) {
  await run(db, "DELETE FROM admin_sessions WHERE email = ?", [normalizeEmail(email)]);
}

// Menyimpan sesi yang token mentahnya sudah dibuat di pemanggil. Yang masuk basis data
// hanya hash token, sehingga bocornya isi tabel tidak memberi cookie yang bisa dipakai.
async function persistSession(db, { token, email, csrf, fingerprint, expiresAt, createdAt }) {
  const now = new Date();
  await run(
    db,
    `INSERT OR REPLACE INTO admin_sessions
      (token_hash, email, csrf, fingerprint, created_at, last_seen, expires_at)
     VALUES (?,?,?,?,?,?,?)`,
    [
      sha256(token),
      normalizeEmail(email) || String(email || ""),
      csrf,
      fingerprint,
      createdAt || now.toISOString(),
      now.toISOString(),
      expiresAt || new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
    ],
  );
}

// Dipanggil saat start: memuat sesi yang masih berlaku supaya restart tidak memaksa
// operator masuk ulang. Kunci peta adalah hash token.
async function loadActiveSessions(db) {
  const now = new Date().toISOString();
  const rows = await new Promise((resolve, reject) =>
    db.all(
      "SELECT token_hash, email, csrf, fingerprint, last_seen, expires_at FROM admin_sessions WHERE expires_at > ?",
      [now],
      (err, r) => (err ? reject(err) : resolve(r)),
    ),
  );
  return rows || [];
}

async function deleteAllSessions(db) {
  await run(db, "DELETE FROM admin_sessions");
}

function smtpConfigured() {
  if (/^(1|true)$/i.test(String(process.env.SMTP_JSON_TRANSPORT || ""))) return true;
  return Boolean(
    String(process.env.SMTP_HOST || "").trim() &&
      String(process.env.SMTP_USER || "").trim() &&
      String(process.env.SMTP_PASS || "").trim(),
  );
}

let cachedTransport = null;
function buildTransport() {
  if (cachedTransport) return cachedTransport;
  if (/^(1|true)$/i.test(String(process.env.SMTP_JSON_TRANSPORT || ""))) {
    cachedTransport = nodemailer.createTransport({ jsonTransport: true });
    return cachedTransport;
  }
  const port = Number(process.env.SMTP_PORT || 465);
  cachedTransport = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port,
    secure: port === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return cachedTransport;
}

function renderEmail(link, expiresAt) {
  const expiry = new Date(expiresAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
  const text = [
    "Halo,",
    "",
    "Berikut tautan masuk ke panel admin Bundacare:",
    link,
    "",
    `Tautan berlaku sampai ${expiry} (WIB) dan hanya bisa dipakai sekali.`,
    "Kalau kamu tidak meminta tautan ini, abaikan saja email ini.",
  ].join("\n");
  const html = `<!doctype html><html lang="id"><body style="font-family:system-ui,sans-serif;color:#18181b;line-height:1.5">
    <p>Halo,</p>
    <p>Berikut tautan masuk ke panel admin Bundacare:</p>
    <p><a href="${link}" style="display:inline-block;background:#07c;color:#fff;padding:10px 16px;border-radius:3px;text-decoration:none">Masuk ke panel admin</a></p>
    <p style="color:#71717a;font-size:13px">Tautan berlaku sampai ${expiry} (WIB) dan hanya bisa dipakai sekali.</p>
    <p style="color:#71717a;font-size:13px">Kalau kamu tidak meminta tautan ini, abaikan saja email ini.</p>
  </body></html>`;
  return { text, html };
}

async function sendMagicLinkEmail(email, link, expiresAt) {
  if (!smtpConfigured()) {
    throw new Error("SMTP belum dikonfigurasi.");
  }
  const { text, html } = renderEmail(link, expiresAt);
  const from = String(process.env.MAIL_FROM || process.env.SMTP_USER || "").trim();
  const info = await buildTransport().sendMail({
    from,
    to: email,
    subject: "Tautan masuk panel admin Bundacare",
    text,
    html,
  });
  return info;
}

function __resetTransportForTest() {
  cachedTransport = null;
}

module.exports = {
  initMagicAuth,
  normalizeEmail,
  adminEmails,
  isAllowedAdminEmail,
  magicLinkBaseUrl,
  rateLimited,
  resetRateState,
  createMagicToken,
  consumeMagicToken,
  peekMagicToken,
  createSession,
  getSession,
  deleteSession,
  touchSession,
  deleteSessionsByEmail,
  persistSession,
  loadActiveSessions,
  deleteAllSessions,
  sessionFingerprint,
  sha256,
  smtpConfigured,
  sendMagicLinkEmail,
  MAGIC_TTL_MS,
  SESSION_TTL_MS,
  IDLE_TIMEOUT_MS,
  __resetTransportForTest,
};
