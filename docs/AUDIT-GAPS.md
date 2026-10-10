# Bundacare: kekurangan dan catatan audit

Catatan ini merangkum kondisi repo dan hal yang belum beres, hasil pemeriksaan lokal pada
2026-10-11. Bukan janji; ini daftar kerja.

## Sudah beres

- Test suite: 174 tes lulus (`npm test`).
- Panel admin hidup di lokal (`http://127.0.0.1:3030/admin`), landing hidup di lokal
  (`http://127.0.0.1:8787/` lewat `npm run serve:site`).
- Login panel memakai magic link ke email admin (Gmail SMTP). Token sekali pakai, hash
  SHA-256, batas laju per email dan per IP.
- Sesi panel disimpan di SQLite (`admin_sessions`), bertahan setelah restart service.
  Default rolling 30 hari, idle 14 hari. Sesi terikat IP + User-Agent.
- Landing di-host di GitHub Pages: `https://ajra.tech/bundacare/` (custom domain ajra.tech,
  path `/bundacare`). Workflow `.github/workflows/deploy-site.yml`.

## Belum beres

### 1. Backend belum ter-deploy ke VPS

- VPS: `43.157.241.188` (lihat `infra.local.md`, gitignored).
- SSH belum bisa: kunci publik `~/.ssh/bundacare_vps_ed25519.pub` belum ditempel ke server.
- Setelah akses ada: pasang Node 20+, clone repo, `npm ci`, isi `.env`, pasang service
  systemd (`deploy/*.service`, `deploy/*.timer`), lalu reverse proxy TLS.

### 2. API registrasi belum tersambung ke landing

- Landing GitHub Pages memanggil API lintas-origin. Backend harus punya TLS dan origin
  landing harus ada di `REGISTRATION_ALLOWED_ORIGINS`.
- `site/config.js` masih `BUNDACARE_API_BASE = ""` (belum diarahkan ke backend).
- Selama backend belum live, formulir menampilkan "Tidak dapat terhubung." (sesuai).

### 3. Email magic link belum diuji dengan Gmail sungguhan

- Kode jalan dengan `SMTP_JSON_TRANSPORT=1` (simulasi). Belum diuji kirim nyata.
- Perlu App Password Gmail (bukan password akun) di `SMTP_PASS`.

### 4. Kebijakan privasi masih draf

- `site/privasi.html` masih menandai kontak pengelola dan masa simpan yang belum diputuskan.
- Registrasi publik tetap tertutup (`PUBLIC_REGISTRATION_ENABLED=0`).

### 5. Aset landing

- Hero memakai ilustrasi SVG sederhana (`site/images/hero.svg`). Bisa diganti ilustrasi
  asli bila ada.

### 6. Operasional

- Backup offsite belum diisi (`BACKUP_OFFSITE_DIR` / `BACKUP_REMOTE_CMD`).
- Alarm eksternal (webhook/Telegram) belum diisi; WhatsApp mati saat WhatsApp bermasalah.
- Belum ada `robots.txt` / meta robots untuk landing.

### 7. Keamanan yang perlu ditinjau sebelum buka publik

- Panel admin menyimpan data kesehatan. Wajib TLS + jangan buka port langsung.
- Pertimbangkan Cloudflare Access atau daftar IP untuk panel.
- Rotasi `SMTP_PASS` dan kunci SSH bila ada indikasi kebocoran.

## Cara menjalankan di lokal

```bash
# Landing + mock API
npm run serve:site            # http://127.0.0.1:8787/

# Bot + panel admin (WA nyata butuh sesi WhatsApp)
npm start                     # http://127.0.0.1:3030/admin

# Panel admin tanpa WA (uji cepat)
DATA_DIR=/tmp/bundacare-demo ADMIN_WEB_PASSWORD=demo node index.js
```

Set `SMTP_JSON_TRANSPORT=1` untuk menguji magic link tanpa mengirim email nyata.
