#!/usr/bin/env node
"use strict";

const puppeteer = require("puppeteer");
const path = require("path");

const OUTPUT_DIR = process.argv[2] || "/tmp";
const BASE_URL = process.argv[3] || "http://127.0.0.1:8787/";

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();

    // Desktop
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(BASE_URL, { waitUntil: "networkidle0" });
    await page.screenshot({ path: path.join(OUTPUT_DIR, "bundacare-landing-desktop.png"), fullPage: true });

    // Mobile
    await page.setViewport({ width: 390, height: 844, isMobile: true });
    await page.goto(BASE_URL, { waitUntil: "networkidle0" });
    await page.screenshot({ path: path.join(OUTPUT_DIR, "bundacare-landing-mobile.png"), fullPage: true });

    console.log(`Screenshot saved to ${OUTPUT_DIR}`);
  } finally {
    await browser.close();
  }
})();
