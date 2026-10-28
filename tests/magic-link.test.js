"use strict";

// Uji alur masuk panel admin lewat magic link: pengiriman, sekali pakai, sesi yang
// bertahan setelah restart, dan penolakan email yang tidak terdaftar.
const assert = require("assert");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");

const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "bundacare-magic-"));
const DATA_DIR = path.join(WORK, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const ADMIN_EMAIL = "hudaya.azra@gmail.com";
const OTHER_EMAIL = "orang.lain@contoh.com";

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
  });
}

async function test(name, fn) {
  try {
    await fn();
    console.log("ok -", name);
  } catch (err) {
    console.error("FAIL -", name);
    console.error(err);
    process.exit(1);
  }
}

let server = null;
let db = null;
let mod = null;
let port = 0;
const USER_AGENT = "uji-magic-agent";

function request(method, urlPath, options = {}) {
  return new Promise((resolve) => {
    const headers = Object.assign({ "User-Agent": USER_AGENT }, options.headers || {});
    const req = http.request(
      { host: "127.0.0.1", port, path: urlPath, method, headers },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
      },
    );
    req.on("error", (err) => resolve({ status: 0, error: err.message }));
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function run() {
  port = await freePort();
  process.env.DATA_DIR = DATA_DIR;
  process.env.ADMIN_WEB_ENABLED = "1";
  process.env.ADMIN_WEB_HOST = "127.0.0.1";
  process.env.ADMIN_WEB_PORT = String(port);
  process.env.ADMIN_EMAILS = ADMIN_EMAIL;
  process.env.SMTP_JSON_TRANSPORT = "1";
  process.env.REGISTRATION_ALLOWED_ORIGINS = "https://azrahudaya.github.io";
  process.env.PUBLIC_REGISTRATION_ENABLED = "0";

  mod = require("../index.js");
  db = mod.__openDbForTest();
  await mod.__initDbForTest(db);
  await mod.ensureSettingsTable(db);
  await mod.loadRuntimeSettings(db);
  server = await mod.__startAdminServerForTest(db);
  await new Promise((resolve) => setTimeout(resolve, 300));

  const magic = mod.__magicAuthForTest;
  const origin = "http://127.0.0.1:" + port;

  await test("halaman login menampilkan form email, bukan password", async () => {
    const res = await request("GET", "/admin/login");
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.includes('name="email"'), "field email ada");
    assert.ok(res.body.includes("/admin/login/magic"), "form menuju endpoint magic");
    assert.ok(!res.body.includes('name="password"'), "tidak ada field password di form utama");
  });

  await test("permintaan tautan dari email terdaftar mengirim email dan menyimpan token", async () => {
    const res = await request("POST", "/admin/login/magic", {
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: origin },
      body: "email=" + encodeURIComponent(ADMIN_EMAIL),
    });
    assert.strictEqual(res.status, 302);
    assert.ok(String(res.headers.location || "").includes("sent=1"), res.headers.location);
    const row = await new Promise((resolve, reject) =>
      db.get("SELECT COUNT(*) AS c FROM admin_magic_tokens", (err, r) => (err ? reject(err) : resolve(r))),
    );
    assert.ok(row.c >= 1, "token tersimpan");
  });

  await test("email tidak terdaftar tidak membuat token dan tetap dijawab sama", async () => {
    const before = await new Promise((resolve, reject) =>
      db.get("SELECT COUNT(*) AS c FROM admin_magic_tokens", (err, r) => (err ? reject(err) : resolve(r))),
    );
    const res = await request("POST", "/admin/login/magic", {
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: origin },
      body: "email=" + encodeURIComponent(OTHER_EMAIL),
    });
    assert.strictEqual(res.status, 302, "jawaban tetap sama supaya tidak membocorkan email");
    const after = await new Promise((resolve, reject) =>
      db.get("SELECT COUNT(*) AS c FROM admin_magic_tokens", (err, r) => (err ? reject(err) : resolve(r))),
    );
    assert.strictEqual(after.c, before.c, "tidak ada token baru untuk email asing");
  });

  await test("permintaan tautan dari situs lain ditolak", async () => {
    const res = await request("POST", "/admin/login/magic", {
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "http://situs-lain.example" },
      body: "email=" + encodeURIComponent(ADMIN_EMAIL),
    });
    assert.strictEqual(res.status, 403);
  });

  let sessionCookie = "";
  let rawToken = "";
  await test("token magic link: GET menampilkan konfirmasi, POST menukar sesi, dan sekali pakai", async () => {
    const created = await magic.createMagicToken(db, ADMIN_EMAIL);
    rawToken = created.token;
    // GET (mis. prefetch Gmail) hanya memeriksa token dan menampilkan tombol, tidak menghabiskannya.
    const peek = await request("GET", "/admin/auth?token=" + encodeURIComponent(rawToken));
    assert.strictEqual(peek.status, 200);
    assert.ok(peek.body.includes("Masuk ke panel"), "halaman konfirmasi dirender");
    assert.ok(peek.body.includes(encodeURIComponent(rawToken)), "token dibawa ke form POST");
    // Prefetch berulang tetap tidak menghanguskan token.
    const peekAgain = await request("GET", "/admin/auth?token=" + encodeURIComponent(rawToken));
    assert.strictEqual(peekAgain.status, 200);
    // POST benar-benar menukar token menjadi sesi.
    const first = await request("POST", "/admin/auth", {
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: origin },
      body: "token=" + encodeURIComponent(rawToken),
    });
    assert.strictEqual(first.status, 302);
    assert.strictEqual(first.headers.location, "/admin");
    sessionCookie = String(first.headers["set-cookie"] || "").split(";")[0];
    assert.ok(/HttpOnly/i.test(String(first.headers["set-cookie"] || "")), "cookie HttpOnly");
    // Token sekali pakai: pemakaian kedua ditolak.
    const again = await request("POST", "/admin/auth", {
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: origin },
      body: "token=" + encodeURIComponent(rawToken),
    });
    assert.strictEqual(again.status, 302);
    assert.ok(String(again.headers.location || "").includes("error=token"), "token kedua kali ditolak");
  });

  await test("sesi dari magic link membuka dashboard", async () => {
    const res = await request("GET", "/admin", { headers: { Cookie: sessionCookie } });
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.includes("Daftar ibu"), "dashboard dirender");
  });

  await test("endpoint QR tersedia untuk admin dan tertutup tanpa sesi", async () => {
    const tanpaSesi = await request("GET", "/admin/api/qr");
    assert.strictEqual(tanpaSesi.status, 401, "tanpa sesi ditolak");
    const res = await request("GET", "/admin/api/qr", { headers: { Cookie: sessionCookie } });
    assert.strictEqual(res.status, 200);
    const data = JSON.parse(res.body || "{}");
    assert.strictEqual(data.ok, true);
    assert.ok(typeof data.connected === "boolean", "ada status koneksi");
    assert.ok(typeof data.qr === "string", "field qr berupa string");
  });

  await test("sesi bertahan setelah restart (dimuat ulang dari basis data)", async () => {
    // Meniru restart: peta sesi di memori dikosongkan, lalu dimuat dari DB.
    mod.__destroyAllAdminSessionsForTest();
    const tanpaSesi = await request("GET", "/admin", { headers: { Cookie: sessionCookie } });
    assert.strictEqual(tanpaSesi.status, 302, "tanpa pemuatan ulang sesi hilang");
    await mod.__loadPersistedAdminSessionsForTest(db);
    const setelahMuat = await request("GET", "/admin", { headers: { Cookie: sessionCookie } });
    assert.strictEqual(setelahMuat.status, 200, "sesi hidup lagi setelah dimuat dari DB");
  });

  await test("sesi terikat sidik jari perangkat", async () => {
    const res = await request("GET", "/admin", {
      headers: { Cookie: sessionCookie, "User-Agent": "agen-berbeda" },
    });
    assert.strictEqual(res.status, 302, "user-agent lain tidak bisa memakai cookie");
  });

  await test("CORS registrasi hanya untuk origin yang diizinkan", async () => {
    const allowed = await request("OPTIONS", "/api/registrations", {
      headers: { Origin: "https://azrahudaya.github.io", "Access-Control-Request-Method": "POST" },
    });
    assert.strictEqual(allowed.status, 204);
    assert.strictEqual(allowed.headers["access-control-allow-origin"], "https://azrahudaya.github.io");
    const denied = await request("OPTIONS", "/api/registrations", {
      headers: { Origin: "https://jahat.example", "Access-Control-Request-Method": "POST" },
    });
    assert.strictEqual(denied.status, 204);
    assert.strictEqual(denied.headers["access-control-allow-origin"], undefined, "origin asing tidak diizinkan");
  });

  await new Promise((resolve) => (server && typeof server.close === "function" ? server.close(resolve) : resolve()));
  db.close();
  fs.rmSync(WORK, { recursive: true, force: true });
  console.log("semua uji magic link lulus");
}

run().catch((err) => {
  console.error("Uji magic link gagal:", err);
  process.exit(1);
});
