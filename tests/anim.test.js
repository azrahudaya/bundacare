"use strict";
// Verifikasi lapisan animasi GSAP: hero masuk, scroll reveal, reduced-motion, dan
// tidak ada konten yang tertinggal tersembunyi kalau GSAP gagal.
const fs = require("node:fs"); const os = require("node:os"); const path = require("node:path"); const net = require("node:net");
const express = require("express"); const puppeteer = require("puppeteer");
const REPO = path.resolve(__dirname, "..");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-anim-"));
process.env.DATA_DIR = dir; process.env.ADMIN_WEB_HOST = "127.0.0.1"; process.env.ADMIN_WEB_PASSWORD = "x";
async function freePort(){return new Promise((res,rej)=>{const s=net.createServer();s.once("error",rej);s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(()=>res(p));});});}
const log=(...a)=>console.log(...a);
(async()=>{
  process.env.ADMIN_WEB_PORT=String(await freePort());
  const sitePort=await freePort();
  const bot=require(path.join(REPO,"index")); const db=bot.__openDbForTest();
  await bot.__initDbForTest(db); await bot.ensureSettingsTable(db); await bot.loadRuntimeSettings(db);
  const srv=await bot.__startAdminServerForTest(db);
  const site=express();
  site.get("/config.js",(_req,res)=>res.type("application/javascript").send('window.BUNDACARE_API_BASE = "";\n'));
  site.get("/api/registrations/availability",(_req,res)=>res.json({open:false}));
  site.use(express.static(path.join(REPO,"site"),{index:"index.html"}));
  const ss=site.listen(sitePort,"127.0.0.1");
  const base=`http://127.0.0.1:${sitePort}`;
  const browser=await puppeteer.launch({headless:true,executablePath:"/usr/bin/google-chrome",args:["--no-sandbox","--disable-dev-shm-usage"]});
  try {
    // ---------- 1. Animasi aktif ----------
    const page=await browser.newPage();
    const errs=[]; page.on("pageerror",e=>errs.push(e.message));
    page.on("console",m=>{if(m.type()==="error")errs.push("console: "+m.text);});
    await page.setViewport({width:1280,height:900});
    await page.goto(base,{waitUntil:"domcontentloaded"});
    log("js-anim class:", await page.evaluate(()=>document.documentElement.classList.contains("js-anim")));
    log("GSAP dimuat:", await page.evaluate(()=>!!window.gsap), "| ScrollTrigger:", await page.evaluate(()=>!!window.ScrollTrigger));
    // tepat setelah load, hero harus masih transparan (sedang dianimasikan)
    const early=await page.evaluate(()=>{const h=document.querySelector("#judul");return parseFloat(getComputedStyle(h).opacity);});
    log("opacity judul sesaat setelah load:", early.toFixed(2));
    await new Promise(r=>setTimeout(r,2500));
    const late=await page.evaluate(()=>{const h=document.querySelector("#judul");return parseFloat(getComputedStyle(h).opacity);});
    log("opacity judul setelah 2.5s:", late.toFixed(2));
    if (early>=0.99) log("CATATAN: hero tidak terlihat beranimasi (mungkin selesai sangat cepat)");
    if (late<0.99) throw new Error("hero tidak pernah muncul sepenuhnya");

    // stiker mengapung (transform berubah antar waktu)
    const t1=await page.evaluate(()=>getComputedStyle(document.querySelector(".hero-sticker")).transform);
    await new Promise(r=>setTimeout(r,600));
    const t2=await page.evaluate(()=>getComputedStyle(document.querySelector(".hero-sticker")).transform);
    log("stiker transform berubah:", t1!==t2);

    // ---------- 2. Scroll reveal ----------
    const before=await page.evaluate(()=>{const el=document.querySelector('#cara-judul');return {op:parseFloat(getComputedStyle(el).opacity), y:el.getBoundingClientRect().top};});
    log("judul cara-kerja sebelum di-scroll:", JSON.stringify(before));
    await page.evaluate(()=>document.querySelector('#daftar').scrollIntoView());
    await new Promise(r=>setTimeout(r,1500));
    const after=await page.evaluate(()=>{const el=document.querySelector('#daftar-judul');return parseFloat(getComputedStyle(el).opacity);});
    log("opacity judul daftar setelah scroll:", after.toFixed(2));
    if (after<0.99) throw new Error("scroll reveal tidak menampilkan elemen");
    // kartu artikel ikut muncul
    await page.evaluate(()=>document.querySelector('#bacaan').scrollIntoView());
    await new Promise(r=>setTimeout(r,1500));
    const art=await page.evaluate(()=>Array.from(document.querySelectorAll('.article-list a')).map(a=>parseFloat(getComputedStyle(a).opacity)));
    log("opacity 6 kartu artikel:", art.map(x=>x.toFixed(2)).join(", "));
    if (art.some(x=>x<0.99)) throw new Error("sebagian kartu artikel tidak muncul");
    log("ERROR JS:", JSON.stringify(errs));
    if (errs.length) throw new Error("ada error JS");
    await page.close();

    // ---------- 3. prefers-reduced-motion ----------
    const rp=await browser.newPage();
    await rp.emulateMediaFeatures([{name:"prefers-reduced-motion",value:"reduce"}]);
    await rp.setViewport({width:1280,height:900});
    await rp.goto(base,{waitUntil:"domcontentloaded"});
    await new Promise(r=>setTimeout(r,500));
    const rm=await rp.evaluate(()=>({
      jsAnim:document.documentElement.classList.contains("js-anim"),
      heroOpacity:parseFloat(getComputedStyle(document.querySelector("#judul")).opacity),
      belowOpacity:parseFloat(getComputedStyle(document.querySelector("#daftar-judul")).opacity),
    }));
    log("reduced-motion:", JSON.stringify(rm));
    if (rm.jsAnim) throw new Error("js-anim tetap terpasang saat reduced-motion");
    if (rm.heroOpacity<0.99||rm.belowOpacity<0.99) throw new Error("konten tersembunyi saat reduced-motion");
    await rp.close();

    // ---------- 4. GSAP gagal dimuat -> konten tetap tampil ----------
    const fp=await browser.newPage();
    await fp.setRequestInterception(true);
    fp.on("request",req=>{ if(req.url().includes("/vendor/gsap/")) req.abort(); else req.continue(); });
    await fp.setViewport({width:1280,height:900});
    await fp.goto(base,{waitUntil:"domcontentloaded"});
    await new Promise(r=>setTimeout(r,800));
    const fb=await fp.evaluate(()=>({
      jsAnim:document.documentElement.classList.contains("js-anim"),
      heroOpacity:parseFloat(getComputedStyle(document.querySelector("#judul")).opacity),
      belowOpacity:parseFloat(getComputedStyle(document.querySelector("#daftar-judul")).opacity),
    }));
    log("GSAP diblokir:", JSON.stringify(fb));
    if (fb.jsAnim) throw new Error("js-anim tidak dilepas saat GSAP gagal");
    if (fb.heroOpacity<0.99||fb.belowOpacity<0.99) throw new Error("konten tersembunyi saat GSAP gagal");
    await fp.close();

    log("\nANIMASI LULUS ✅");
  } finally {
    await browser.close(); await new Promise(r=>ss.close(r)); await new Promise(r=>srv.close(r)); await new Promise(r=>db.close(r)); fs.rmSync(dir,{recursive:true,force:true});
  }
})().catch(e=>{console.error("GAGAL:",e);process.exitCode=1;});
