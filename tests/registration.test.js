"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bundacare-registration-"));
process.env.DATA_DIR = dir;
process.env.ADMIN_WEB_ENABLED = "1";
process.env.ADMIN_WEB_HOST = "127.0.0.1";
process.env.ADMIN_WEB_PASSWORD = "test-password-only";
process.env.WA_PAIRING_NUMBER = "628111222333";
process.env.PUBLIC_REGISTRATION_ENABLED = "1";
process.env.ENFORCE_ALLOWLIST = "1";
process.env.ALLOWLIST_WA_IDS = "628111222333";

async function freePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function run() {
  process.env.ADMIN_WEB_PORT = String(await freePort());
  const bot = require("../index");
  const db = bot.__openDbForTest();
  let server;
  const sent = [];
  const client = { sendMessage: async (_to, text) => { sent.push(text); return { id: { _serialized: `mock-${sent.length}` } }; } };
  const phone = "6285700000001";
  const form = { name: "Ibu Uji", phone: "085700000001", hpht: "2026-08-01", reminderTime: "08:30", consent: true };
  let requestId;
  let token;
  let cookie;
  let csrf;
  const check = async (label, fn) => { await fn(); console.log("ok -", label); };
  const req = async (method, endpoint, body, headers = {}) => {
    const response = await fetch(`http://127.0.0.1:${process.env.ADMIN_WEB_PORT}${endpoint}`, {
      method, redirect: "manual", headers: { ...(body ? { "content-type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data, headers: response.headers };
  };
  const get = (sql, args = []) => new Promise((resolve, reject) => db.get(sql, args, (err, row) => err ? reject(err) : resolve(row)));
  const exec = (sql, args = []) => new Promise((resolve, reject) => db.run(sql, args, function (err) { err ? reject(err) : resolve(this); }));
  const inbound = async (body, from = `${phone}@c.us`, contactNumber) => bot.__handleMessageForTest(db, client, {
    from, body, getContact: contactNumber ? async () => ({ number: contactNumber }) : undefined,
  });
  try {
    await bot.__initDbForTest(db);
    await bot.ensureSettingsTable(db);
    await bot.loadRuntimeSettings(db);
    server = await bot.__startAdminServerForTest(db);
    await check("API registrasi hidup di origin bot, landing tidak disajikan", async () => {
      const landing = await req("GET", "/");
      assert.equal(landing.status, 404, "landing tidak disajikan dari origin API");
      const availability = await req("GET", "/api/registrations/availability");
      assert.deepEqual(availability.data, { open: true });
    });
    await check("ketersediaan pilot tertutup tidak mengaktifkan formulir", async () => {
      process.env.PUBLIC_REGISTRATION_ENABLED = "0";
      assert.deepEqual((await req("GET", "/api/registrations/availability")).data, { open: false });
      process.env.PUBLIC_REGISTRATION_ENABLED = "1";
    });
    await check("pendaftaran menolak origin asing dan consent kosong", async () => {
      assert.equal((await req("POST", "/api/registrations", form, { Origin: "https://asing.example" })).status, 403);
      assert.equal((await req("POST", "/api/registrations", { ...form, consent: false })).status, 400);
    });
    await check("decoy kedaluwarsa dibersihkan saat pendaftaran baru", async () => {
      await exec("INSERT INTO registration_decoys (request_id, expires_at) VALUES (?,?)", ["old-request", new Date(Date.now() - 1000).toISOString()]);
      const next = await req("POST", "/api/registrations", { ...form, phone: "085700000013" });
      assert.equal(next.status, 201);
      assert.equal((await get("SELECT COUNT(*) AS count FROM registration_decoys WHERE expires_at <= ?", [new Date().toISOString()])).count, 0);
    });
    await check("POST serentak untuk nomor sama tidak membocorkan status duplikat", async () => {
      const pair = await Promise.all(Array.from({ length: 2 }, () => req("POST", "/api/registrations", { ...form, phone: "085700000018" })));
      assert.deepEqual(pair.map((item) => item.status), [201, 201]);
      assert.equal((await get("SELECT COUNT(*) AS count FROM registrations WHERE phone = ?", ["6285700000018"])).count, 1);
    });
    await check("pendaftaran mengembalikan tautan verifikasi dan status tanpa PII", async () => {
      const response = await req("POST", "/api/registrations", form);
      assert.equal(response.status, 201, JSON.stringify(response.data));
      requestId = response.data.requestId;
      assert.match(requestId, /^[a-f0-9]{48}$/);
      assert.match(response.data.verificationUrl, /^https:\/\/wa\.me\/628111222333\?text=/);
      assert.ok(Date.parse(response.data.expiresAt) > Date.now());
      token = new URL(response.data.verificationUrl).searchParams.get("text").split(" ")[1];
      const row = await get("SELECT * FROM registrations WHERE request_id = ?", [requestId]);
      assert.equal(row.phone, phone);
      assert.equal(row.consent, 1);
      assert.equal(row.status, "pending_verification");
      assert.ok(!JSON.stringify(row).includes(token), "kode hanya disimpan dalam bentuk hash");
      assert.equal(await get("SELECT * FROM users WHERE wa_id = ?", [`${phone}@c.us`]), undefined);
      const status = await req("GET", `/api/registrations/status?requestId=${requestId}`);
      assert.deepEqual(status.data, { status: "pending_verification" });
      assert.equal(status.headers.get("cache-control"), "no-store");
      assert.equal((await req("GET", "/api/registrations/status?requestId=salah")).status, 404);
    });
    await check("pendaftaran ganda tidak membocorkan keberadaan nomor", async () => {
      const response = await req("POST", "/api/registrations", form);
      assert.equal(response.status, 201);
      assert.deepEqual(Object.keys(response.data).sort(), ["expiresAt", "requestId", "verificationUrl"]);
      assert.deepEqual((await req("GET", `/api/registrations/status?requestId=${response.data.requestId}`)).data, { status: "pending_verification" });
      const decoyToken = new URL(response.data.verificationUrl).searchParams.get("text").split(" ")[1];
      await inbound(`VERIFIKASI ${decoyToken}`);
      assert.equal((await req("GET", `/api/registrations/status?requestId=${requestId}`)).data.status, "pending_verification");
    });
    await check("nomor salah dan kode salah tidak mengubah status", async () => {
      await inbound(`VERIFIKASI ${token}`, "6285700000002@c.us");
      await inbound("VERIFIKASI SALAH");
      assert.equal((await req("GET", `/api/registrations/status?requestId=${requestId}`)).data.status, "pending_verification");
    });
    await check("@lid terpetakan ke nomor yang sama, kode dikonsumsi sekali", async () => {
      await inbound(`VERIFIKASI ${token}`, "123456@lid", phone);
      assert.equal((await req("GET", `/api/registrations/status?requestId=${requestId}`)).data.status, "pending_approval");
      await inbound(`VERIFIKASI ${token}`);
      assert.equal((await req("GET", `/api/registrations/status?requestId=${requestId}`)).data.status, "pending_approval");
      assert.equal(await get("SELECT * FROM users WHERE wa_id = ?", [`${phone}@c.us`]), undefined);
    });
    await check("admin login dan persetujuan wajib sesi serta CSRF", async () => {
      assert.equal((await req("POST", `/admin/api/registrations/${requestId}/approve`, {})).status, 401);
      const login = await fetch(`http://127.0.0.1:${process.env.ADMIN_WEB_PORT}/admin/login`, {
        method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "username=admin&password=test-password-only",
      });
      assert.equal(login.status, 302);
      cookie = login.headers.get("set-cookie").split(";")[0];
      const dashboard = await req("GET", "/admin", null, { Cookie: cookie });
      csrf = dashboard.data.match(/name="csrf-token" content="([^"]+)"/)[1];
      assert.equal((await req("POST", `/admin/api/registrations/${requestId}/approve`, {}, { Cookie: cookie })).status, 403);
      const list = await req("GET", "/admin/api/registrations", null, { Cookie: cookie });
      assert.equal(list.status, 200);
      assert.ok(list.data.registrations.some((entry) => entry.requestId === requestId));
      assert.equal((await req("POST", `/admin/api/registrations/${requestId}/approve`, {}, { Cookie: cookie, "x-csrf-token": csrf })).status, 200);
      assert.equal((await req("GET", `/api/registrations/status?requestId=${requestId}`)).data.status, "active");
      const user = await get("SELECT * FROM users WHERE wa_id = ?", [`${phone}@c.us`]);
      assert.equal(user.status, "active");
      assert.equal(user.reminder_time, "08:30");
      assert.equal((await req("POST", `/admin/api/registrations/${requestId}/approve`, {}, { Cookie: cookie, "x-csrf-token": csrf })).status, 409);
    });
    await check("persetujuan menghormati batas user baru harian", async () => {
      const a = await req("POST", "/api/registrations", { ...form, phone: "085700000011" });
      assert.equal(a.status, 201);
      await inbound(new URL(a.data.verificationUrl).searchParams.get("text"), "6285700000011@c.us");
      await bot.setSetting(db, "onboarding_daily_limit", 1);
      const blocked = await req("POST", `/admin/api/registrations/${a.data.requestId}/approve`, {}, { Cookie: cookie, "x-csrf-token": csrf });
      assert.equal(blocked.status, 429);
      assert.equal((await req("GET", `/api/registrations/status?requestId=${a.data.requestId}`)).data.status, "pending_approval");
      await bot.setSetting(db, "onboarding_daily_limit", 20);
    });
    await check("admin allow sebelum formulir tidak mengunci pendaftaran", async () => {
      const candidatePhone = "6285700000026";
      const admin = await get("SELECT * FROM users WHERE wa_id = ?", ["628111222333@c.us"]) || { wa_id: "628111222333@c.us", is_admin: 1 };
      await bot.__handleAdminCommandForTest(db, client, admin, `admin allow ${candidatePhone}`);
      const candidate = await req("POST", "/api/registrations", { ...form, phone: candidatePhone });
      assert.equal(candidate.status, 201);
      await inbound(new URL(candidate.data.verificationUrl).searchParams.get("text"), `${candidatePhone}@c.us`);
      assert.equal((await req("GET", `/api/registrations/status?requestId=${candidate.data.requestId}`)).data.status, "pending_approval");
      const approved = await req("POST", `/admin/api/registrations/${candidate.data.requestId}/approve`, {}, { Cookie: cookie, "x-csrf-token": csrf });
      assert.equal(approved.status, 200);
      assert.equal((await get("SELECT status FROM users WHERE wa_id = ?", [`${candidatePhone}@c.us`])).status, "active");
    });
    await check("admin allow sebelum verifikasi tidak mengunci pendaftaran", async () => {
      const candidate = await req("POST", "/api/registrations", { ...form, phone: "085700000021" });
      assert.equal(candidate.status, 201);
      await bot.__handleAdminCommandForTest(db, client, await get("SELECT * FROM users WHERE wa_id = ?", ["628111222333@c.us"]) || { wa_id: "628111222333@c.us", is_admin: 1 }, "admin allow 6285700000021");
      await inbound(new URL(candidate.data.verificationUrl).searchParams.get("text"), "6285700000021@c.us");
      assert.equal((await req("GET", `/api/registrations/status?requestId=${candidate.data.requestId}`)).data.status, "pending_approval");
      const approved = await req("POST", `/admin/api/registrations/${candidate.data.requestId}/approve`, {}, { Cookie: cookie, "x-csrf-token": csrf });
      assert.equal(approved.status, 200);
      assert.equal((await get("SELECT status FROM users WHERE wa_id = ?", ["6285700000021@c.us"])).status, "active");
    });
    await check("duplikat tidak mengganggu user aktif", async () => {
      const response = await req("POST", "/api/registrations", form);
      assert.equal(response.status, 201);
      assert.deepEqual(Object.keys(response.data).sort(), ["expiresAt", "requestId", "verificationUrl"]);
      const duplicateStatus = await req("GET", `/api/registrations/status?requestId=${response.data.requestId}`);
      assert.deepEqual(duplicateStatus.data, { status: "pending_verification" });
      assert.equal((await get("SELECT status FROM users WHERE wa_id = ?", [`${phone}@c.us`])).status, "active");
    });
    await check("pendaftar tanpa izin tetap pending sekalipun scheduler direkonsiliasi", async () => {
      const newForm = { ...form, phone: "085700000003" };
      const response = await req("POST", "/api/registrations", newForm);
      assert.equal(response.status, 201);
      await bot.reconcileRunnableUsers(db);
      assert.equal(await get("SELECT * FROM users WHERE wa_id = ?", ["6285700000003@c.us"]), undefined);
      assert.equal((await req("GET", `/api/registrations/status?requestId=${response.data.requestId}`)).data.status, "pending_verification");
    });
    await check("kode kedaluwarsa gagal dan status expired", async () => {
      const newForm = { ...form, phone: "085700000004" };
      const response = await req("POST", "/api/registrations", newForm);
      const expiredToken = new URL(response.data.verificationUrl).searchParams.get("text").split(" ")[1];
      await exec("UPDATE registrations SET expires_at = ? WHERE request_id = ?", [new Date(Date.now() - 1000).toISOString(), response.data.requestId]);
      await inbound(`VERIFIKASI ${expiredToken}`, "6285700000004@c.us");
      assert.equal((await req("GET", `/api/registrations/status?requestId=${response.data.requestId}`)).data.status, "expired");
      const retry = await req("POST", "/api/registrations", newForm);
      assert.equal(retry.status, 201);
      assert.notEqual(retry.data.requestId, response.data.requestId);
      const freshToken = new URL(retry.data.verificationUrl).searchParams.get("text").split(" ")[1];
      await inbound(`VERIFIKASI ${freshToken}`, "6285700000004@c.us");
      assert.equal((await req("GET", `/api/registrations/status?requestId=${retry.data.requestId}`)).data.status, "pending_approval");
    });
    await check("start nomor asing selalu diarahkan ke website meski formulir pilot tutup", async () => {
      process.env.PUBLIC_REGISTRATION_ENABLED = "0";
      await bot.addPanelAllowedNumber(db, "6285700000019@c.us", null, "panel", "admin");
      await inbound("start", "6285700000019@c.us");
      assert.equal(await get("SELECT * FROM users WHERE wa_id = ?", ["6285700000019@c.us"]), undefined);
      process.env.PUBLIC_REGISTRATION_ENABLED = "1";
    });
    await check("start nomor asing tidak membuat onboarding dan stop menghentikan user aktif", async () => {
      await inbound("start", "6285700000009@c.us");
      assert.equal(await get("SELECT * FROM users WHERE wa_id = ?", ["6285700000009@c.us"]), undefined);
      assert.equal((await get("SELECT COUNT(*) AS count FROM users WHERE wa_id = ?", ["6285700000009@c.us"])).count, 0);
      await inbound("stop");
      assert.equal((await get("SELECT status FROM users WHERE wa_id = ?", [`${phone}@c.us`])).status, "paused");
      assert.equal((await req("GET", `/api/registrations/status?requestId=${requestId}`)).data.status, "paused");
    });
    await check("scheduler menolak status nonaktif walaupun jam sudah ada", async () => {
      const user = await get("SELECT * FROM users WHERE wa_id = ?", [`${phone}@c.us`]);
      const sentBefore = sent.length;
      await bot.__processUserReminderTickForTest(db, client, { ...user, status: "pending_approval", allow_remindcare: 1 }, {}, "2026-10-10");
      assert.equal(sent.length, sentBefore);
    });
    await check("kode kedaluwarsa bisa didaftarkan ulang tanpa membuka halaman status", async () => {
      const phoneRetry = "085700000006";
      const first = await req("POST", "/api/registrations", { ...form, phone: phoneRetry });
      assert.equal(first.status, 201);
      await exec("UPDATE registrations SET expires_at = ? WHERE request_id = ?", [new Date(Date.now() - 1000).toISOString(), first.data.requestId]);
      const retry = await req("POST", "/api/registrations", { ...form, phone: phoneRetry });
      assert.equal(retry.status, 201);
      const freshToken = new URL(retry.data.verificationUrl).searchParams.get("text").split(" ")[1];
      await inbound(`VERIFIKASI ${freshToken}`, "6285700000006@c.us");
      assert.equal((await req("GET", `/api/registrations/status?requestId=${retry.data.requestId}`)).data.status, "pending_approval");
    });
    await check("nomor pending tidak dapat membatalkan atau memproses onboarding WA", async () => {
      const pending = await req("POST", "/api/registrations", { ...form, phone: "085700000007" });
      assert.equal(pending.status, 201);
      await inbound("stop", "6285700000007@c.us");
      assert.equal((await req("GET", `/api/registrations/status?requestId=${pending.data.requestId}`)).data.status, "paused");
      assert.equal(await get("SELECT * FROM users WHERE wa_id = ?", ["6285700000007@c.us"]), undefined);
      const retry = await req("POST", "/api/registrations", { ...form, phone: "085700000007" });
      assert.equal(retry.status, 201);
      const retryToken = new URL(retry.data.verificationUrl).searchParams.get("text");
      await inbound(retryToken, "6285700000007@c.us");
      assert.equal((await req("GET", `/api/registrations/status?requestId=${retry.data.requestId}`)).data.status, "pending_approval");
    });
    await check("pendaftar belum aktif dapat meminta hapus data dari WA", async () => {
      const pending = await req("POST", "/api/registrations", { ...form, phone: "085700000014" });
      assert.equal(pending.status, 201);
      await inbound(new URL(pending.data.verificationUrl).searchParams.get("text"), "6285700000014@c.us");
      await inbound("delete", "6285700000014@c.us");
      assert.equal(await get("SELECT * FROM registrations WHERE phone = ?", ["6285700000014"]), undefined);
    });
    await check("hapus dari panel menghapus data registrasi dan bisa daftar ulang", async () => {
      const targetPhone = "6285700000021";
      const adminDelete = await req("POST", `/admin/api/users/${encodeURIComponent(`${targetPhone}@c.us`)}/actions`, { action: "delete_data", value: "HAPUS" }, { Cookie: cookie, "x-csrf-token": csrf });
      assert.equal(adminDelete.status, 200);
      assert.equal(await get("SELECT * FROM registrations WHERE phone = ?", [targetPhone]), undefined);
      await bot.setSetting(db, "onboarding_daily_limit", 2);
      const throttled = await req("POST", `/admin/api/registrations/${(await get("SELECT request_id FROM registrations WHERE phone = ?", ["6285700000011"])).request_id}/approve`, {}, { Cookie: cookie, "x-csrf-token": csrf });
      assert.equal(throttled.status, 429);
      await bot.setSetting(db, "onboarding_daily_limit", 20);
      const next = await req("POST", "/api/registrations", { ...form, phone: targetPhone });
      assert.equal(next.status, 201);
      await inbound(new URL(next.data.verificationUrl).searchParams.get("text"), `${targetPhone}@c.us`);
      assert.equal((await req("GET", `/api/registrations/status?requestId=${next.data.requestId}`)).data.status, "pending_approval");
    });
    await check("pembatalan yang terlambat setelah persetujuan tetap menghentikan user", async () => {
      const candidate = await req("POST", "/api/registrations", { ...form, phone: "085700000025" });
      assert.equal(candidate.status, 201);
      await inbound(new URL(candidate.data.verificationUrl).searchParams.get("text"), "6285700000025@c.us");
      const approved = await req("POST", `/admin/api/registrations/${candidate.data.requestId}/approve`, {}, { Cookie: cookie, "x-csrf-token": csrf });
      assert.equal(approved.status, 200);
      const cancelled = await require("../lib/registration").cancelRegistration(db, "6285700000025@c.us", "stop");
      assert.equal(cancelled, true);
      const user = await get("SELECT status,allow_remindcare FROM users WHERE wa_id = ?", ["6285700000025@c.us"]);
      assert.equal(user.status, "paused");
      assert.equal(user.allow_remindcare, 0);
      assert.equal((await req("GET", `/api/registrations/status?requestId=${candidate.data.requestId}`)).data.status, "paused");
    });
    await check("STOP berlomba persetujuan tidak menyisakan user aktif", async () => {
      const candidate = await req("POST", "/api/registrations", { ...form, phone: "085700000024" });
      assert.equal(candidate.status, 201);
      await inbound(new URL(candidate.data.verificationUrl).searchParams.get("text"), "6285700000024@c.us");
      await Promise.all([
        req("POST", `/admin/api/registrations/${candidate.data.requestId}/approve`, {}, { Cookie: cookie, "x-csrf-token": csrf }),
        inbound("stop", "6285700000024@c.us"),
      ]);
      const user = await get("SELECT status,allow_remindcare FROM users WHERE wa_id = ?", ["6285700000024@c.us"]);
      assert.ok(!user || user.status !== "active" || !user.allow_remindcare);
    });
    await check("hapus data user juga menghapus formulir kesehatan", async () => {
      const user = await get("SELECT * FROM users WHERE wa_id = ?", ["6285700000001@c.us"]);
      assert.equal(user.status, "paused");
      await inbound("delete");
      await inbound("delete");
      assert.equal(await get("SELECT * FROM users WHERE wa_id = ?", ["6285700000001@c.us"]), undefined);
      assert.equal(await get("SELECT * FROM registrations WHERE phone = ?", ["6285700000001"]), undefined);
    });
    await check("payload terlalu besar mengembalikan galat JSON", async () => {
      const response = await req("POST", "/api/registrations", { ...form, name: "A".repeat(9000) });
      assert.equal(response.status, 413);
      assert.equal(typeof response.data.error, "string");
    });
    await check("batas percobaan HTTP menolak permintaan berulang", async () => {
      let response;
      for (let i = 0; i < 15; i++) response = await req("POST", "/api/registrations", { ...form, phone: "nomor-tidak-valid" });
      assert.equal(response.status, 429);
    });
    await check("saklar publik menutup pendaftaran", async () => {
      process.env.PUBLIC_REGISTRATION_ENABLED = "0";
      assert.equal((await req("POST", "/api/registrations", { ...form, phone: "085700000008" })).status, 503);
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => db.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

run().catch((err) => { console.error(err); process.exitCode = 1; });
