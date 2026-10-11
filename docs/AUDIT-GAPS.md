# Bundacare: kekurangan dan catatan audit

Catatan ini merangkum kondisi repo dan hal yang belum beres, hasil pemeriksaan lokal pada
2026-10-11. Bukan janji; ini daftar kerja.

## Sudah beres

- Test suite: 176 tes lulus (`npm test`).
- Panel admin hidup di lokal (`http://127.0.0.1:3030/admin`), landing hidup di lokal
  (`http://127.0.0.1:8787/` lewat `npm run serve:site`).
- Login panel memakai magic link ke email admin (Gmail SMTP). Token sekali pakai, hash
  SHA-256, batas laju per email dan per IP.
- Sesi panel disimpan di SQLite (`admin_sessions`), bertahan setelah restart service.
  Default rolling 30 hari, idle 14 hari. Sesi terikat IP + User-Agent.
- Landing di-host di GitHub Pages: `https://ajra.tech/bundacare/` (custom domain ajra.tech,
  path `/bundacare`). Workflow `.github/workflows/deploy-site.yml`.
- Fitur HPHT/HPL/persalinan/nifas sudah dihapus dari onboarding WA, formulir, dan panel
  admin. Fokus kini hanya pengingat tablet tambah darah harian.
- Enam artikel bacaan asli di `site/artikel-*.html`, materinya dari publikasi Kemenkes,
  gambar di-self-host di `site/images/artikel/` (bukan hotlink), tiap artikel mencantumkan
  sumbernya. Diseragamkan dengan `npm run articles`.
- Halaman `site/tentang.html` dan kebijakan privasi di `site/privasi.html` yang mengacu
  UU PDP No. 27/2022 dan UU Kesehatan No. 17/2023.

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

### 4. Kebijakan privasi perlu tinjauan hukum

- Isi `site/privasi.html` sudah lengkap dan mengacu UU PDP + UU Kesehatan, tetapi sebaiknya
  ditinjau pihak yang paham hukum sebelum pendaftaran dibuka luas.
- Kontak pengelola masih `halo@bundacare.site`; pastikan surel ini aktif.
- Registrasi publik tetap tertutup (`PUBLIC_REGISTRATION_ENABLED=0`).

### 5. Aset landing

- Hero memakai gambar tangkapan layar aplikasi (`site/images/hero-bundacare.webp`,
  WebP dari PNG 1254x1254). Ditampilkan sebagai kartu putih bersudut bulat di atas
  hero merah. Sumber PNG aslinya tidak ikut repo; kalau perlu ubah, konversi ulang
  ke WebP.
- Tiga emoji stiker di hero memakai Fluent Emoji (Microsoft, MIT), diekstrak ke
  `site/images/emoji/` oleh `npm run emoji`. Hanya emoji yang dipakai yang ditulis,
  bukan seluruh paket (icons.json 99 MB).
- `site/images/hero.svg` dan `placeholder.svg` sudah tidak dipakai, boleh dihapus.

### 6. Operasional

- Backup offsite belum diisi (`BACKUP_OFFSITE_DIR` / `BACKUP_REMOTE_CMD`).
- Alarm eksternal (webhook/Telegram) belum diisi; WhatsApp mati saat WhatsApp bermasalah.
- Belum ada `robots.txt` / meta robots untuk landing.
- Database pernah dikosongkan dengan `npm run clear-data -- --yes` (menyimpan settings dan
  sesi admin). Backup sebelum pembersihan ada di `/tmp/bundacare-backup-*.db`.

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
Saat mode ini menyala, tautan masuk juga ditulis ke `data/magic-link.txt`.

Script lain:

```bash
npm run emoji                 # ekstrak ulang emoji hero
npm run articles              # seragamkan artikel + unduh gambar Kemenkes
npm run clear-data -- --yes   # kosongkan tabel data (simpan settings & sesi admin)
```
