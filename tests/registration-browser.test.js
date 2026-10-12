"use strict";

// Uji integrasi browser untuk arsitektur Bundacare sekarang:
//   landing (origin sendiri) -> API bot (origin lain, CORS) -> verifikasi WA -> persetujuan admin
//
// Catatan: bot TIDAK lagi menyajikan landing page (dulu express.static(site) membuat
// api.bundacare.site menampilkan landing). Karena itu uji ini menjalankan server statis
// terpisah untuk folder site/ dan mengarahkan config.js ke API bot (lintas origin nyata).
//
// Menjalankan bot sungguhan (index.js) dengan SQLite sementara. Tidak mengirim WhatsApp
// nyata: pesan verifikasi disimulasikan lewat __handleMessageForTest.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const express = require("express");
const puppeteer = require("puppeteer");

const REPO = path.resolve(__dirname, "..");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bundacare-browser-"));
process.env.DATA_DIR = dir;
process.env.ADMIN_WEB_HOST = "127.0.0.1";
process.env.ADMIN_WEB_PASSWORD = "browser-test-only";
process.env.PUBLIC_WA_NUMBER = "628111222333";
process.env.PUBLIC_REGISTRATION_ENABLED = "1";
process.env.ENFORCE_ALLOWLIST = "1";

async function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

async function run() {
  process.env.ADMIN_WEB_PORT = String(await freePort());
  const sitePort = await freePort();
  process.env.REGISTRATION_ALLOWED_ORIGINS = `http://127.0.0.1:${sitePort}`;

  const bot = require(path.join(REPO, "index"));
  const db = bot.__openDbForTest();
  const apiBase = `http://127.0.0.1:${process.env.ADMIN_WEB_PORT}`;
  const siteBase = `http://127.0.0.1:${sitePort}`;

  let adminServer, siteServer, browser;
  try {
    await bot.__initDbForTest(db);
    await bot.ensureSettingsTable(db);
    await bot.loadRuntimeSettings(db);
    adminServer = await bot.__startAdminServerForTest(db);

    const site = express();
    site.get("/config.js", (_req, res) => {
      res.type("application/javascript").send(`window.BUNDACARE_API_BASE = "${apiBase}";\n`);
    });
    site.use(express.static(path.join(REPO, "site"), { index: "index.html" }));
    siteServer = site.listen(sitePort, "127.0.0.1");

    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/google-chrome",
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/ERR_FILE_NOT_FOUND/.test(m.text())) errors.push(`console: ${m.text()}`); });

    // ---- Responsif, target sentuh, tanpa overflow ----
    for (const width of [195, 360, 390, 768, 1024, 1440]) {
      await page.setViewport({ width, height: 850 });
      await page.goto(siteBase, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => !document.querySelector("#submit-button").disabled, { timeout: 20000 });
      const checks = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth,
        action: document.querySelector("#submit-button").getBoundingClientRect().height,
        link: document.querySelector(".hero .button").getBoundingClientRect().height,
        privacy: !!document.querySelector('a[href="/privasi.html"]') || !!document.querySelector('a[href="privasi.html"]'),
      }));
      assert.equal(checks.overflow, false, `overflow ${width}px`);
      assert.ok(checks.action >= 44 && checks.link >= 44, `tap targets ${width}px`);
      assert.equal(checks.privacy, true);
      console.log(`ok - viewport ${width}px, tanpa overflow, CTA 44px`);
      if (width === 390 || width === 1440) await page.screenshot({ path: `/tmp/bundacare-integrated-${width}.png`, fullPage: true });
    }

    // ---- Tautan jangkar menunjuk bagian yang ada ----
    await page.setViewport({ width: 390, height: 850 });
    await page.goto(siteBase, { waitUntil: "domcontentloaded" });
    const anchors = await page.evaluate(() => [...document.querySelectorAll('a[href^="#"]')].map((a) => ({ href: a.getAttribute("href"), exists: Boolean(document.querySelector(a.getAttribute("href"))) })));
    assert.ok(anchors.every((a) => a.exists), JSON.stringify(anchors));
    console.log("ok - semua tautan halaman menunjuk bagian yang ada");

    // ---- Navigasi CTA ----
    await page.click('.hero a[href="#daftar"]');
    assert.equal(await page.evaluate(() => location.hash), "#daftar");
    await page.setViewport({ width: 1440, height: 850 });
    await page.click('.header-nav a[href="#cara-kerja"]');
    assert.equal(await page.evaluate(() => location.hash), "#cara-kerja");
    console.log("ok - CTA dan navigasi ke bagian yang benar");

    // ---- Fokus keyboard terlihat ----
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => ({ text: (document.activeElement.textContent || "").trim().slice(0, 24), tag: document.activeElement.tagName, cls: (document.activeElement.className || "").toString(), outline: getComputedStyle(document.activeElement).outlineStyle, matchesFV: document.activeElement.matches(":focus-visible") }));
    assert.equal(focused.outline, "solid", `fokus tak terlihat: ${JSON.stringify(focused)}`);
    console.log("ok - kontrol keyboard punya fokus tampak");

    // ---- Zoom teks 200% tanpa overflow ----
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    const zoom = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth }));
    assert.equal(zoom.overflow, false, "zoom teks 200% tidak boleh overflow horizontal");
    await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
    console.log("ok - zoom teks 200% tidak membuat overflow horizontal");

    // ---- Validasi formulir kosong ----
    await page.setViewport({ width: 390, height: 850 });
    await page.click("#submit-button");
    assert.ok(await page.$eval("#name", (el) => el.getAttribute("aria-invalid") === "true" || el.validationMessage !== ""));
    console.log("ok - form kosong menampilkan kesalahan");

    // ---- Kirim formulir -> tautan verifikasi ----
    await page.type("#name", "Ibu Uji Browser");
    await page.type("#phone", "085700000006");
    await page.$eval("#reminderTime", (el) => { el.value = "09:30"; el.dispatchEvent(new Event("input", { bubbles: true })); });
    await page.click("#consent");
    await page.click("#submit-button");
    await page.waitForSelector("#registration-result:not([hidden])", { timeout: 20000 });
    const link = await page.$eval("#verification-link", (el) => el.href);
    const token = new URL(link).searchParams.get("text");
    assert.match(token, /^VERIFIKASI [A-F0-9]{36}$/);
    console.log("ok - form web menyimpan pending, tautan WhatsApp terisi");

    // ---- Refresh tetap menampilkan tautan pending ----
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("#registration-result:not([hidden])", { timeout: 20000 });
    assert.equal(await page.$eval("#verification-link", (el) => el.href), link);
    console.log("ok - refresh tab tetap menampilkan tautan verifikasi pending");

    // ---- Verifikasi lewat WA tiruan -> menunggu persetujuan ----
    const client = { sendMessage: async () => ({ id: { _serialized: "mock" } }) };
    await bot.__handleMessageForTest(db, client, { from: "6285700000006@c.us", body: token });
    await page.click("#check-status");
    await page.waitForFunction(() => /Menunggu persetujuan/.test(document.querySelector("#status-title").textContent), { timeout: 20000 });
    console.log("ok - satu pesan WA tiruan mengubah status ke menunggu persetujuan");

    // ---- Admin login (password) + setujui ----
    const login = await fetch(`${apiBase}/admin/login`, {
      method: "POST", redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "username=admin&password=browser-test-only",
    });
    assert.equal(login.status, 302, `login status ${login.status}`);
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const adminHtml = await (await fetch(`${apiBase}/admin`, { headers: { Cookie: cookie } })).text();
    const csrf = adminHtml.match(/name="csrf-token" content="([^"]+)"/)[1];
    const list = await (await fetch(`${apiBase}/admin/api/registrations`, { headers: { Cookie: cookie } })).json();
    assert.equal(list.registrations.length, 1);
    const approve = await fetch(`${apiBase}/admin/api/registrations/${list.registrations[0].requestId}/approve`, {
      method: "POST", headers: { Cookie: cookie, "X-CSRF-Token": csrf, "Content-Type": "application/json" }, body: "{}",
    });
    assert.equal(approve.status, 200, `approve status ${approve.status}`);
    console.log("ok - admin menyetujui pendaftar lewat API");

    // ---- Status browser berubah jadi aktif ----
    await page.click("#check-status");
    await page.waitForFunction(() => /Pengingat aktif/.test(document.querySelector("#status-title").textContent), { timeout: 20000 });
    console.log("ok - persetujuan admin mengaktifkan pengingat di status browser");

    // ---- Pilot ditutup -> formulir nonaktif ----
    process.env.PUBLIC_REGISTRATION_ENABLED = "0";
    await page.evaluate(() => sessionStorage.clear());
    await page.goto(siteBase, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => /belum dibuka/i.test(document.querySelector("#availability").textContent), { timeout: 20000 });
    assert.equal(await page.$eval("#submit-button", (el) => el.disabled), true);
    console.log("ok - pilot tertutup mematikan formulir sebelum data diisi");

    // ---- Halaman privasi ----
    await page.goto(`${siteBase}/privasi.html`);
    assert.match(await page.title(), /privasi/i);
    console.log("ok - halaman privasi tersedia");

    assert.deepEqual(errors, [], `error JS: ${JSON.stringify(errors)}`);
    console.log("ok - tanpa error JavaScript");
    console.log("\nSEMUA LULUS ✅");
  } finally {
    if (browser) await browser.close();
    if (siteServer) await new Promise((r) => siteServer.close(r));
    if (adminServer) await new Promise((r) => adminServer.close(r));
    await new Promise((r) => db.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
