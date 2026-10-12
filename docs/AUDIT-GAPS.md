# Bundacare: kekurangan dan catatan audit

Catatan ini merangkum kondisi repo dan hal yang belum beres. Diperbarui 2026-10-12
setelah pemeriksaan lokal menyeluruh.

## Sudah beres (terverifikasi)

- Test suite: 176 tes lulus (`npm test`), plus suite UI klik 71/71
  (`npm run test:ui`) dan uji browser end-to-end (`node tests/registration-browser.test.js`).
- Uji E2E lokal membuktikan alur penuh: landing → API lintas-origin → kode verifikasi WA →
  persetujuan admin → user aktif di DB. Bot tidak lagi menyajikan landing page.
- Panel admin hidup di lokal (`http://127.0.0.1:3030/admin`), landing hidup di lokal
  (`http://127.0.0.1:8787/` lewat `npm run serve:site`).
- Login panel memakai magic link ke email admin (Gmail SMTP). Token sekali pakai, hash
  SHA-256, batas laju per email dan per IP.
- Sesi panel disimpan di SQLite (`admin_sessions`), bertahan setelah restart service.
  Default rolling 30 hari, idle 14 hari. Sesi terikat IP + User-Agent.
- Backend sudah ter-deploy ke VPS (`43.157.241.188`, lihat `infra.local.md`, gitignored):
  `bundacare-bot.service` aktif, Caddy menerbitkan TLS untuk `api.bundacare.site` dan
  `bot.bundacare.site`.
- Landing `https://bundacare.site` dihosting di **GitHub Pages** dari folder `site/`
  (workflow `deploy-site.yml`, `site/CNAME`). VPS tidak lagi menyajikan landing.
- Animasi landing memakai GSAP + ScrollTrigger self-host (`site/vendor/gsap`), tanpa build
  step. Hero masuk bertahap, stiker mengapung, parallax, scroll reveal. Kalau GSAP gagal
  dimuat atau pengguna memilih reduced-motion, semua konten tetap tampil. Uji: `npm run test:anim`.
- Fitur HPHT/HPL/persalinan/nifas sudah dihapus dari onboarding WA, formulir, dan panel
  admin. Fokus kini hanya pengingat tablet tambah darah harian.
- Enam artikel bacaan asli di `site/artikel-*.html`, materinya dari publikasi Kemenkes,
  gambar di-self-host di `site/images/artikel/` (bukan hotlink), tiap artikel mencantumkan
  sumbernya. Diseragamkan dengan `npm run articles`.
- Halaman `site/tentang.html` dan kebijakan privasi di `site/privasi.html` yang mengacu
  UU PDP No. 27/2022 dan UU Kesehatan No. 17/2023.
- Email magic link (Gmail SMTP) dan alarm eksternal (webhook + Telegram) sudah diisi di
  server; backup offsite sudah diisi.
- Aksesibilitas: fokus keyboard terlihat di semua kontrol (termasuk input formulir),
  tanpa overflow horizontal pada lebar 195–1440 px.

## Belum beres / perlu tindakan sebelum buka publik

### 1. WhatsApp belum tertaut di server produksi

- Heartbeat VPS menunjukkan `ready: false`; log berulang "client belum siap".
- Sesi WA ada di `/opt/bundacare/.wwebjs_auth/session-bundacare` tetapi belum
  terautentikasi. Tautkan lewat QR di panel (`/admin` → "Tautkan WhatsApp") atau
  `WA_PAIRING_NUMBER`, lalu pastikan `heartbeat.ready: true`.
- Selama belum tertaut, pengingat tidak terkirim dan registrasi pilot tetap harus tertutup.

### 2. Registrasi publik masih tertutup

- `PUBLIC_REGISTRATION_ENABLED=0` di server. Endpoint publik mati; formulir menampilkan
  "Pendaftaran belum dibuka." (sesuai).
- Buka hanya setelah WhatsApp tertaut DAN `PUBLIC_WA_NUMBER` diisi (nomor bot).

### 3. Timer operasional belum diaktifkan

- `bundacare-watchdog.timer` dan `bundacare-backup.timer` berstatus `disabled`.
- Aktifkan: `sudo systemctl enable --now bundacare-watchdog.timer bundacare-backup.timer`.
- `WATCHDOG_RESTART=0`: penjaga hanya memberi alarm, tidak me-restart otomatis. Isi aturan
  sudoers di `deploy/INSTALL.md` lalu set `1` kalau ingin restart otomatis.

### 4. Kebijakan privasi perlu tinjauan hukum

- Isi `site/privasi.html` sudah lengkap dan mengacu UU PDP + UU Kesehatan, tetapi sebaiknya
  ditinjau pihak yang paham hukum sebelum pendaftaran dibuka luas.
- Kontak pengelola masih `halo@bundacare.site`; pastikan surel ini aktif.

### 5. Keamanan yang perlu ditinjau sebelum buka publik

- Panel admin menyimpan data kesehatan. Wajib TLS + jangan buka port langsung (sudah TLS
  via Caddy). Pertimbangkan Cloudflare Access atau daftar IP untuk panel.
- Rotasi `SMTP_PASS` dan kunci SSH bila ada indikasi kebocoran.
- `deploy/.secrets/smtp_app_password` ada di VPS (mode 600). Jangan commit; sudah tertutup
  `.gitignore`.

## Cara menjalankan di lokal

```bash
# Landing + mock API
npm run serve:site            # http://127.0.0.1:8787/

# Bot + panel admin (WA nyata butuh sesi WhatsApp)
npm start                     # http://127.0.0.1:3030/admin

# Panel admin tanpa WA (uji cepat)
DATA_DIR=/tmp/bundacare-demo ADMIN_WEB_PASSWORD=demo node index.js

# Uji browser end-to-end (butuh Chrome; lokasi lewat PUPPETEER_EXECUTABLE_PATH)
node tests/registration-browser.test.js
```

Set `SMTP_JSON_TRANSPORT=1` untuk menguji magic link tanpa mengirim email nyata.
Saat mode ini menyala, tautan masuk juga ditulis ke `data/magic-link.txt`.

Script lain:

```bash
npm run emoji                 # ekstrak ulang emoji hero
npm run articles              # seragamkan artikel + unduh gambar Kemenkes
npm run clear-data -- --yes   # kosongkan tabel data (simpan settings & sesi admin)
```
