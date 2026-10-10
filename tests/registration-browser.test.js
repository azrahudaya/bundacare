"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const puppeteer = require("puppeteer");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bundacare-browser-"));
process.env.DATA_DIR = dir;
process.env.ADMIN_WEB_HOST = "127.0.0.1";
process.env.ADMIN_WEB_PASSWORD = "browser-test-only";
process.env.PUBLIC_WA_NUMBER = "628111222333";
process.env.PUBLIC_REGISTRATION_ENABLED = "1";
process.env.ENFORCE_ALLOWLIST = "1";
async function freePort() {
  return new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", () => {
      const port = socket.address().port;
      socket.close(() => resolve(port));
    });
  });
}

async function run() {
  process.env.ADMIN_WEB_PORT = String(await freePort());
  const bot = require("../index");
  const db = bot.__openDbForTest();
  const base = `http://127.0.0.1:${process.env.ADMIN_WEB_PORT}`;
  let server;
  let browser;
  try {
    await bot.__initDbForTest(db);
    await bot.ensureSettingsTable(db);
    await bot.loadRuntimeSettings(db);
    server = await bot.__startAdminServerForTest(db);
    browser = await puppeteer.launch({ headless: true, executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/google-chrome", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const width of [195, 360, 390, 768, 1024, 1440]) {
      await page.setViewport({ width, height: 850 });
      await page.goto(base, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => !document.querySelector("#submit-button").disabled);
      const checks = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth,
        action: document.querySelector("#submit-button").getBoundingClientRect().height,
        link: document.querySelector(".hero .button").getBoundingClientRect().height,
        privacy: !!document.querySelector('a[href="/privasi.html"]'),
      }));
      assert.equal(checks.overflow, false, `overflow ${width}px`);
      assert.ok(checks.action >= 44 && checks.link >= 44, `tap targets ${width}px`);
      assert.equal(checks.privacy, true);
      console.log(`ok - viewport ${width}px, no overflow, CTA 44px`);
      if (width === 390 || width === 1440) await page.screenshot({ path: `/tmp/bundacare-integrated-${width}.png`, fullPage: true });
    }
    await page.setViewport({ width: 390, height: 850 });
    const anchors = await page.evaluate(() => [...document.querySelectorAll('a[href^="#"]')].map((a) => ({ href: a.getAttribute('href'), exists: Boolean(document.querySelector(a.getAttribute('href'))) })));
    assert.ok(anchors.every((a) => a.exists), JSON.stringify(anchors));
    console.log("ok - semua tautan halaman menunjuk bagian yang ada");
    await page.click('.hero a[href="#daftar"]');
    assert.equal(await page.evaluate(() => location.hash), "#daftar");
    await page.setViewport({ width: 1440, height: 850 });
    await page.click('.header-nav a[href="#cara-kerja"]');
    assert.equal(await page.evaluate(() => location.hash), "#cara-kerja");
    await page.click('.header-nav a[href="#artikel"]');
    assert.equal(await page.evaluate(() => location.hash), "#artikel");
    await page.click('.header-nav a[href="#daftar"]');
    assert.equal(await page.evaluate(() => location.hash), "#daftar");
    console.log("ok - CTA dan navigasi ke bagian yang benar");
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => ({ text: document.activeElement.textContent, visible: getComputedStyle(document.activeElement).outlineStyle !== "none" }));
    assert.ok(focused.visible);
    console.log("ok - kontrol keyboard punya fokus tampak");
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    const zoom = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth, offenders: [...document.querySelectorAll("body *")].filter((el) => el.getBoundingClientRect().right > innerWidth + 1).slice(0, 12).map((el) => ({ tag: el.tagName, className: el.className, right: el.getBoundingClientRect().right })) }));
    assert.equal(zoom.overflow, false, `zoom teks 200% tidak boleh overflow horizontal: ${JSON.stringify(zoom.offenders)}`);
    await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
    console.log("ok - zoom teks 200% tidak membuat overflow horizontal");
    await page.setViewport({ width: 390, height: 850 });
    await page.click("#submit-button");
    assert.ok(await page.$eval("#name", (el) => el.getAttribute("aria-invalid") === "true"));
    console.log("ok - form kosong menampilkan kesalahan dan fokus");
    await page.type("#name", "Ibu Uji Browser");
    await page.type("#phone", "085700000006");
    await page.$eval("#hpht", (el) => { el.value = "2026-08-01"; el.dispatchEvent(new Event("input", { bubbles: true })); });
    await page.$eval("#reminderTime", (el) => { el.value = "09:30"; el.dispatchEvent(new Event("input", { bubbles: true })); });
    await page.click("#consent");
    await page.click("#submit-button");
    await page.waitForSelector("#registration-result:not([hidden])");
    const link = await page.$eval("#verification-link", (el) => el.href);
    const token = new URL(link).searchParams.get("text");
    assert.match(token, /^VERIFIKASI [A-F0-9]{36}$/);
    console.log("ok - form web menyimpan pending, tautan WhatsApp terisi");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("#registration-result:not([hidden])");
    assert.equal(await page.$eval("#verification-link", (el) => el.href), link);
    console.log("ok - refresh tab tetap menampilkan tautan verifikasi pending");
    const client = { sendMessage: async () => ({ id: { _serialized: "mock" } }) };
    await bot.__handleMessageForTest(db, client, { from: "6285700000006@c.us", body: token });
    await page.click("#check-status");
    await page.waitForFunction(() => document.querySelector("#status-title").textContent.includes("persetujuan"));
    console.log("ok - satu pesan WA tiruan mengubah status ke menunggu persetujuan");
    await page.evaluate(() => {
      const key = "bundacare-pending-verification";
      const saved = JSON.parse(sessionStorage.getItem(key));
      saved.expiresAt = new Date(Date.now() - 1000).toISOString();
      sessionStorage.setItem(key, JSON.stringify(saved));
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("#registration-result:not([hidden])");
    await page.click("#check-status");
    await page.waitForFunction(() => document.querySelector("#status-title").textContent.includes("persetujuan"));
    console.log("ok - status terverifikasi tetap dapat dicek setelah kode habis");
    const login = await fetch(`${base}/admin/login`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "username=admin&password=browser-test-only" });
    assert.equal(login.status, 302);
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const admin = await fetch(`${base}/admin`, { headers: { Cookie: cookie } });
    const csrf = (await admin.text()).match(/name="csrf-token" content="([^"]+)"/)[1];
    const list = await fetch(`${base}/admin/api/registrations`, { headers: { Cookie: cookie } });
    const rows = (await list.json()).registrations;
    assert.equal(rows.length, 1);
    const adminPage = await browser.newPage();
    adminPage.on("request", (req) => { if (req.method() === "POST" && req.url().endsWith("/admin/login")) console.log("login headers", { origin: req.headers().origin, referer: req.headers().referer, host: req.headers().host }); });
    await adminPage.goto(`${base}/admin/login`, { waitUntil: "domcontentloaded" });
    await adminPage.type('input[name="username"]', "admin");
    await adminPage.type('input[name="password"]', "browser-test-only");
    await Promise.all([adminPage.waitForNavigation({ waitUntil: "domcontentloaded" }), adminPage.click('button[type="submit"]')]);
    console.log("login diagnostics", await adminPage.evaluate(() => ({ url:location.pathname, text:document.body.innerText.slice(0,350) })));
    adminPage.on("dialog", (dialog) => dialog.accept());
    await adminPage.goto(`${base}/admin`, { waitUntil: "domcontentloaded" });
    await adminPage.waitForFunction(() => document.querySelector("#registrations-body button") || document.querySelector("#registrations-note")?.textContent !== "Memuat.");
    console.log("admin diagnostics", await adminPage.evaluate(() => ({ title:document.title, note:document.querySelector("#registrations-note")?.textContent, rows:document.querySelector("#registrations-body")?.innerText, url:location.pathname }))); 
    await adminPage.waitForFunction(() => document.querySelector("#registrations-body button"));
    await adminPage.click("#registrations-body button");
    await adminPage.waitForFunction(() => document.querySelector("#registrations-note").textContent.includes("Belum ada pendaftar"));
    console.log("ok - tombol persetujuan admin mengaktifkan pendaftar dan menyegarkan daftar");
    await adminPage.close();
    await page.click("#check-status");
    await page.waitForFunction(() => document.querySelector("#status-title").textContent.includes("aktif"));
    console.log("ok - persetujuan admin mengaktifkan pengingat di status browser");
    assert.deepEqual(errors, []);
    console.log("ok - tanpa error JavaScript");
    await page.goto(`${base}/privasi.html`);
    assert.match(await page.title(), /privasi/i);
    console.log("ok - halaman privasi tersedia");
    process.env.PUBLIC_REGISTRATION_ENABLED = "0";
    await page.evaluate(() => sessionStorage.clear());
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelector("#availability").textContent.includes("belum dibuka"));
    assert.equal(await page.$eval("#submit-button", (el) => el.disabled), true);
    console.log("ok - pilot tertutup mematikan formulir sebelum data diisi");
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => db.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
