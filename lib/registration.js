"use strict";

const crypto = require("node:crypto");
const sqlite3 = require("sqlite3");

const TTL_MS = 15 * 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
const attempts = new Map();

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => db.run(sql, params, function (err) {
    if (err) reject(err);
    else resolve(this);
  }));
}
function get(db, sql, params = []) {
  return new Promise((resolve, reject) => db.get(sql, params, (err, row) => err ? reject(err) : resolve(row)));
}
function all(db, sql, params = []) {
  return new Promise((resolve, reject) => db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows)));
}

async function initRegistrations(db) {
  await run(db, `CREATE TABLE IF NOT EXISTS registrations (
    request_id TEXT PRIMARY KEY,
    phone TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    reminder_time TEXT NOT NULL,
    consent INTEGER NOT NULL CHECK(consent = 1),
    consent_at TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending_verification','pending_approval','active','expired','paused')),
    verified_at TEXT,
    approved_at TEXT
  )`);
  await run(db, "CREATE INDEX IF NOT EXISTS idx_registrations_token ON registrations (token_hash, status)");
  await run(db, "CREATE TABLE IF NOT EXISTS registration_decoys (request_id TEXT PRIMARY KEY, expires_at TEXT NOT NULL)");
  await run(db, "CREATE TABLE IF NOT EXISTS registration_activation_log (request_id TEXT PRIMARY KEY, activated_at TEXT NOT NULL)");
  await migrateRegistrationsDropHpht(db);
}

// HPHT sudah tidak dipakai lagi. Kolom lama dibuat NOT NULL, jadi baris baru tanpa
// hpht akan ditolak. SQLite tidak bisa menghapus NOT NULL lewat ALTER, jadi tabel
// dibangun ulang tanpa kolom itu kalau masih ada.
async function migrateRegistrationsDropHpht(db) {
  const cols = await all(db, "PRAGMA table_info(registrations)");
  if (!cols.some((c) => c.name === "hpht")) {
    return;
  }
  await run(db, "BEGIN");
  try {
    await run(db, `CREATE TABLE registrations_new (
      request_id TEXT PRIMARY KEY,
      phone TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      reminder_time TEXT NOT NULL,
      consent INTEGER NOT NULL CHECK(consent = 1),
      consent_at TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending_verification','pending_approval','active','expired','paused')),
      verified_at TEXT,
      approved_at TEXT
    )`);
    await run(db, `INSERT INTO registrations_new
      (request_id,phone,name,reminder_time,consent,consent_at,token_hash,expires_at,status,verified_at,approved_at)
      SELECT request_id,phone,name,reminder_time,consent,consent_at,token_hash,expires_at,status,verified_at,approved_at FROM registrations`);
    await run(db, "DROP TABLE registrations");
    await run(db, "ALTER TABLE registrations_new RENAME TO registrations");
    await run(db, "CREATE INDEX IF NOT EXISTS idx_registrations_token ON registrations (token_hash, status)");
    await run(db, "COMMIT");
  } catch (err) {
    await run(db, "ROLLBACK");
    throw err;
  }
}

function normalizePhone(input) {
  if (typeof input !== "string") return null;
  const raw = input.replace(/[\s()+-]/g, "");
  if (!/^\d+$/.test(raw)) return null;
  const phone = raw.startsWith("0") ? `62${raw.slice(1)}` : raw;
  return /^628\d{8,12}$/.test(phone) ? phone : null;
}

function validate(payload, options = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const name = typeof payload.name === "string" ? payload.name.trim().replace(/\s+/g, " ") : "";
  const phone = normalizePhone(payload.phone);
  const reminderTime = payload.reminderTime;
  if (!name || name.length > 100 || !phone || payload.consent !== true ||
      typeof reminderTime !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(reminderTime)) return null;
  // Jam di luar jendela kirim tidak akan pernah diproses loop pengingat, jadi ditolak
  // di sini juga (bukan hanya di UI) supaya tidak ada pendaftaran yang mustahil terkirim.
  if (typeof options.isWithinSendWindow === "function" &&
      !options.isWithinSendWindow(reminderTime)) {
    return null;
  }
  return { name, phone, reminderTime };
}

function limited(ip, kind = "post") {
  const now = Date.now();
  for (const [key, value] of attempts) {
    if (now - value.start >= WINDOW_MS) attempts.delete(key);
  }
  const key = `${kind}:${ip}`;
  const record = attempts.get(key) || { start: now, count: 0 };
  record.count += 1;
  attempts.set(key, record);
  return record.count > (kind === "status" ? 60 : 30);
}

function sameOrigin(req) {
  const source = req.get("origin") || req.get("referer");
  if (!source) return true;
  try {
    const origin = new URL(source);
    if (origin.host === req.get("host") && origin.protocol === `${req.protocol}:`) {
      return true;
    }
    // Landing page bisa di-host terpisah (GitHub Pages). Origin yang diizinkan lewat
    // REGISTRATION_ALLOWED_ORIGINS tetap diterima, selain origin sendiri.
    const allowed = String(process.env.REGISTRATION_ALLOWED_ORIGINS || "")
      .split(/[\s,]+/)
      .map((o) => o.trim().replace(/\/+$/, ""))
      .filter(Boolean);
    return allowed.includes(origin.origin);
  } catch { return false; }
}

function registerRoutes(app, db, options) {
  app.get("/api/registrations/availability", (_req, res) => {
    res.set("Cache-Control", "no-store");
    const win = typeof options.getSendWindow === "function" ? options.getSendWindow() : null;
    res.json({
      open: process.env.PUBLIC_REGISTRATION_ENABLED === "1" && Boolean(normalizePhone(process.env.WA_PAIRING_NUMBER || process.env.PUBLIC_WA_NUMBER || "")),
      // Jendela kirim ikut dikirim supaya formulir bisa membatasi pilihan jam dan
      // tidak ada pendaftaran dengan jam yang mustahil terkirim.
      sendWindow: win
        ? {
            startHour: win.startHour,
            endHour: win.endHour,
            endMinute: win.endMinute,
            label: typeof options.sendWindowLabel === "function" ? options.sendWindowLabel() : null,
          }
        : null,
    });
  });
  app.post("/api/registrations", async (req, res) => {
    res.set("Cache-Control", "no-store");
    db.run("DELETE FROM registration_decoys WHERE expires_at <= ?", [new Date().toISOString()]);
    if (process.env.PUBLIC_REGISTRATION_ENABLED !== "1") return res.status(503).json({ error: "Pendaftaran pilot belum dibuka." });
    if (!sameOrigin(req)) return res.status(403).json({ error: "Permintaan harus dari situs ini." });
    if (limited(req.socket.remoteAddress || "unknown")) return res.status(429).json({ error: "Terlalu banyak percobaan. Coba lagi nanti." });
    const entry = validate(req.body, { isWithinSendWindow: options.isWithinSendWindow });
    if (!entry) {
      const rawTime = req.body && req.body.reminderTime;
      const outOfWindow =
        typeof rawTime === "string" &&
        /^([01]\d|2[0-3]):[0-5]\d$/.test(rawTime) &&
        typeof options.isWithinSendWindow === "function" &&
        !options.isWithinSendWindow(rawTime);
      return res.status(400).json({
        error: outOfWindow
          ? `Jam pengingat harus antara ${options.sendWindowLabel ? options.sendWindowLabel() : "jam yang tersedia"} WIB.`
          : "Periksa nama, nomor, jam, dan persetujuan.",
      });
    }
    const botNumber = normalizePhone(process.env.WA_PAIRING_NUMBER || process.env.PUBLIC_WA_NUMBER || "");
    if (!botNumber) return res.status(503).json({ error: "Nomor verifikasi belum tersedia." });
    try {
      const existing = await get(db, "SELECT status,is_blocked FROM users WHERE wa_id = ?", [`${entry.phone}@c.us`]);
      const existingAccount = existing && (existing.status !== "onboarding" || existing.is_blocked);
      const pending = await get(db, "SELECT status,expires_at FROM registrations WHERE phone = ?", [entry.phone]);
      const token = crypto.randomBytes(18).toString("hex").toUpperCase();
      const requestId = crypto.randomBytes(24).toString("hex");
      const expiresAt = new Date(Date.now() + TTL_MS).toISOString();
      if (pending && !existingAccount) {
        if (pending.status === "expired" || pending.status === "paused" || (pending.status === "pending_verification" && pending.expires_at <= new Date().toISOString())) {
          await run(db, "DELETE FROM registrations WHERE phone = ? AND (status IN ('expired','paused') OR (status = 'pending_verification' AND expires_at <= ?))", [entry.phone, new Date().toISOString()]);
        } else {
          await run(db, "INSERT INTO registration_decoys (request_id, expires_at) VALUES (?,?)", [requestId, expiresAt]);
          return res.status(201).json({ verificationUrl: `https://wa.me/${botNumber}?text=${encodeURIComponent(`VERIFIKASI ${token}`)}`, expiresAt, requestId });
        }
      } else if (existingAccount) {
        await run(db, "INSERT INTO registration_decoys (request_id, expires_at) VALUES (?,?)", [requestId, expiresAt]);
        return res.status(201).json({ verificationUrl: `https://wa.me/${botNumber}?text=${encodeURIComponent(`VERIFIKASI ${token}`)}`, expiresAt, requestId });
      }
      const inserted = await run(db, `INSERT OR IGNORE INTO registrations
        (request_id,phone,name,reminder_time,consent,consent_at,token_hash,expires_at,status)
        VALUES (?,?,?,?,1,?,?,?,'pending_verification')`,
      [requestId, entry.phone, entry.name, entry.reminderTime, new Date().toISOString(),
        crypto.createHash("sha256").update(token).digest("hex"), expiresAt]);
      if (!inserted.changes) await run(db, "INSERT INTO registration_decoys (request_id, expires_at) VALUES (?,?)", [requestId, expiresAt]);
      return res.status(201).json({ verificationUrl: `https://wa.me/${botNumber}?text=${encodeURIComponent(`VERIFIKASI ${token}`)}`, expiresAt, requestId });
    } catch (err) {
      if (err.code === "SQLITE_CONSTRAINT") {
        try {
          await run(db, "INSERT INTO registration_decoys (request_id, expires_at) VALUES (?,?)", [requestId, expiresAt]);
          return res.status(201).json({ verificationUrl: `https://wa.me/${botNumber}?text=${encodeURIComponent(`VERIFIKASI ${token}`)}`, expiresAt, requestId });
        } catch (_) { return res.status(500).json({ error: "Pendaftaran gagal. Coba lagi nanti." }); }
      }
      console.error("Gagal menyimpan pendaftaran:", err.message);
      return res.status(500).json({ error: "Pendaftaran gagal. Coba lagi nanti." });
    }
  });

  app.get("/api/registrations/status", async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (limited(req.socket.remoteAddress || "unknown", "status")) return res.status(429).json({ error: "Terlalu banyak pemeriksaan status." });
    const id = req.query.requestId;
    if (typeof id !== "string" || !/^[a-f0-9]{48}$/.test(id)) return res.status(404).json({ error: "Pendaftaran tidak ditemukan." });
    try {
      const row = await get(db, "SELECT phone,status,expires_at FROM registrations WHERE request_id = ?", [id]);
      if (!row) {
        const decoy = await get(db, "SELECT expires_at FROM registration_decoys WHERE request_id = ?", [id]);
        if (!decoy) return res.status(404).json({ error: "Pendaftaran tidak ditemukan." });
        return res.json({ status: decoy.expires_at <= new Date().toISOString() ? "expired" : "pending_verification" });
      }
      if (row.status === "pending_verification" && row.expires_at <= new Date().toISOString()) {
        await run(db, "UPDATE registrations SET status = 'expired' WHERE request_id = ? AND status = 'pending_verification'", [id]);
        row.status = "expired";
      }
      if (row.status === "active") {
        const user = await get(db, "SELECT status FROM users WHERE wa_id = ?", [`${row.phone}@c.us`]);
        if (!user || user.status !== "active") row.status = "paused";
      }
      return res.json({ status: row.status });
    } catch (err) {
      console.error("Gagal membaca status pendaftaran:", err.message);
      return res.status(500).json({ error: "Status tidak tersedia." });
    }
  });

  app.get("/admin/api/registrations", options.requireAdmin, async (_req, res) => {
    try {
      const rows = await all(db, "SELECT request_id,phone,name,reminder_time,status,verified_at FROM registrations WHERE status = 'pending_approval' ORDER BY verified_at ASC LIMIT 100");
      res.json({ registrations: rows.map((r) => ({ requestId: r.request_id, phone: r.phone, name: r.name, reminderTime: r.reminder_time, status: r.status, verifiedAt: r.verified_at })) });
    } catch (err) { res.status(500).json({ error: "Daftar tidak tersedia." }); }
  });

  app.post("/admin/api/registrations/:requestId/approve", options.requireAdmin, options.requireCsrf, async (req, res) => {
    const id = req.params.requestId;
    if (!/^[a-f0-9]{48}$/.test(id)) return res.status(404).json({ error: "Pendaftaran tidak ditemukan." });
    const tx = new sqlite3.Database(db.filename);
    tx.configure("busyTimeout", 5000);
    let started = false;
    try {
      await run(tx, "BEGIN IMMEDIATE");
      started = true;
      const row = await get(tx, "SELECT * FROM registrations WHERE request_id = ? AND status = 'pending_approval'", [id]);
      if (!row) {
        await run(tx, "ROLLBACK");
        started = false;
        return res.status(409).json({ error: "Pendaftaran belum siap disetujui." });
      }
      const limit = await get(tx, "SELECT value FROM settings WHERE key = 'onboarding_daily_limit'");
      const maxToday = Math.max(1, Number(limit?.value) || 20);
      const recent = await get(tx, "SELECT COUNT(*) AS count FROM registration_activation_log WHERE date(activated_at, '+7 hours') = date('now', '+7 hours')");
      if (recent.count >= maxToday) {
        await run(tx, "ROLLBACK");
        started = false;
        return res.status(429).json({ error: "Batas aktivasi pilot hari ini tercapai." });
      }
      const now = new Date().toISOString();
      const userId = `${row.phone}@c.us`;
      const existingUser = await get(tx, "SELECT status,is_blocked FROM users WHERE wa_id = ?", [userId]);
      if (existingUser && (existingUser.status !== "onboarding" || existingUser.is_blocked)) {
        await run(tx, "ROLLBACK");
        started = false;
        return res.status(409).json({ error: "Nomor perlu diperiksa pengelola." });
      }
      if (existingUser) {
        await run(tx, `UPDATE users SET name = ?, reminder_time = ?, allow_remindcare = 1,
          is_allowed = 1, status = 'active', onboarding_step = 0, updated_at = ? WHERE wa_id = ? AND status = 'onboarding' AND is_blocked = 0`,
        [row.name, row.reminder_time, now, userId]);
      } else {
        await run(tx, `INSERT INTO users
          (wa_id,name,reminder_time,allow_remindcare,is_allowed,status,onboarding_step,created_at,updated_at)
          VALUES (?,?,?,1,1,'active',0,?,?)`,
        [userId, row.name, row.reminder_time, now, now]);
      }
      await run(tx, "UPDATE registrations SET status = 'active', approved_at = ? WHERE request_id = ? AND status = 'pending_approval'", [now, id]);
      await run(tx, "INSERT INTO registration_activation_log (request_id, activated_at) VALUES (?,?)", [id, now]);
      await run(tx, "COMMIT");
      started = false;
      return res.json({ status: "active" });
    } catch (err) {
      if (started) { try { await run(tx, "ROLLBACK"); } catch (_) {} }
      if (err.code === "SQLITE_CONSTRAINT") return res.status(409).json({ error: "Nomor sudah terdaftar." });
      console.error("Gagal menyetujui pendaftaran:", err.message);
      return res.status(500).json({ error: "Persetujuan gagal." });
    } finally {
      await new Promise((resolve) => tx.close(() => resolve()));
    }
  });
}

async function cancelRegistration(db, waId, action) {
  if (!/^(stop|delete)$/.test(action) || !/^628\d{8,12}@c\.us$/.test(waId)) return false;
  const tx = new sqlite3.Database(db.filename);
  tx.configure("busyTimeout", 5000);
  let started = false;
  try {
    await run(tx, "BEGIN IMMEDIATE");
    started = true;
    const phone = waId.slice(0, -5);
    const row = await get(tx, "SELECT status FROM registrations WHERE phone = ?", [phone]);
    if (!row) {
      await run(tx, "ROLLBACK");
      started = false;
      return false;
    }
    if (action === "delete") {
      await run(tx, "DELETE FROM postpartum_visit_logs WHERE wa_id = ?", [waId]);
      await run(tx, "DELETE FROM reminder_logs WHERE wa_id = ?", [waId]);
      await run(tx, "DELETE FROM users WHERE wa_id = ?", [waId]);
      await run(tx, "DELETE FROM registrations WHERE phone = ?", [phone]);
    } else {
      await run(tx, "UPDATE registrations SET status = 'paused', token_hash = '' WHERE phone = ? AND status IN ('pending_verification','pending_approval','active')", [phone]);
      await run(tx, "UPDATE users SET status = 'paused', allow_remindcare = 0 WHERE wa_id = ? AND status = 'active'", [waId]);
    }
    await run(tx, "COMMIT");
    started = false;
    return true;
  } catch (err) {
    if (started) { try { await run(tx, "ROLLBACK"); } catch (_) {} }
    throw err;
  } finally {
    await new Promise((resolve) => tx.close(() => resolve()));
  }
}

async function verifyMessage(db, waId, text) {
  const match = /^VERIFIKASI\s+([A-F0-9]{36})$/i.exec(text.trim());
  if (!match || !/^628\d{8,12}@c\.us$/.test(waId)) return false;
  const hash = crypto.createHash("sha256").update(match[1].toUpperCase()).digest("hex");
  const result = await run(db, `UPDATE registrations SET status = 'pending_approval', verified_at = ?, token_hash = ''
    WHERE phone = ? AND token_hash = ? AND status = 'pending_verification' AND expires_at > ?`,
  [new Date().toISOString(), waId.slice(0, -5), hash, new Date().toISOString()]);
  return result.changes === 1;
}

module.exports = { initRegistrations, registerRoutes, verifyMessage, cancelRegistration, normalizePhone };
