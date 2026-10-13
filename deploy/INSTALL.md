# Cara pasang di server Linux

Perintah di bawah dijalankan sebagai user yang akan menjalankan bot (contoh: `ubuntu`).

Catatan nama: nama berkas unit (`bundacare-bot.service` dan kawan-kawan), jalur
`/opt/bundacare`, nama berkas basis data, dan `WA_CLIENT_ID` sengaja tidak ikut memakai nama
produk ini, supaya cocok dengan pemasangan yang sudah berjalan di VPS. Menggantinya harus
dikerjakan bersamaan: ganti nama unit, pindahkan folder aplikasi, pindahkan basis data, lalu
taut ulang sesi WhatsApp (client id menentukan nama folder sesi, jadi mengubahnya membuat
sesi lama tidak terbaca).

```bash
sudo mkdir -p /opt/bundacare
sudo chown "$USER":"$USER" /opt/bundacare
# salin isi repo ke /opt/bundacare (rsync, git clone, atau tar)
cd /opt/bundacare
npm install
cp .env.example .env
# isi .env minimal: ADMIN_WA_IDS, ALLOWLIST_WA_IDS, ENFORCE_ALLOWLIST, ADMIN_WEB_PASSWORD (opsional)
node index.js          # pairing pertama, pindai QR, lalu Ctrl+C
```

Setelah QR berhasil dipindai, cadangkan folder sesi sebelum menyalakan service:

```bash
tar czf ~/bundacare-session-$(date +%F).tar.gz .wwebjs_auth
```

Pasang service bot dan timer backup:

```bash
sudo cp deploy/bundacare-bot.service /etc/systemd/system/
sudo cp deploy/bundacare-backup.service deploy/bundacare-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now bundacare-bot.service
sudo systemctl enable --now bundacare-backup.timer
systemctl status bundacare-bot --no-pager
journalctl -u bundacare-bot -n 50 --no-pager
```

Penting: `enable --now` untuk timer, bukan `enable` saja. Perintah `enable` tanpa `--now`
hanya mendaftarkan timer supaya hidup saat boot, tetapi timer-nya tidak jalan di sesi ini,
sehingga backup tidak pernah dijalankan sampai server di-reboot.

Verifikasi bahwa timer benar-benar terjadwal:

```bash
systemctl is-active bundacare-backup.timer          # harus active
systemctl list-timers bundacare-backup.timer        # baris NEXT harus terisi
systemctl start bundacare-backup.service            # jalankan sekali untuk uji
journalctl -u bundacare-backup -n 5 --no-pager      # harus muncul "Backup ok"
```

## Menautkan sesi tanpa QR (server tanpa layar)

QR di journal sulit dipindai dari jarak jauh. Isi `WA_PAIRING_NUMBER` di `.env` dengan
nomor bot, format `628xxxxxxxxxx`, lalu jalankan bot. WhatsApp tidak lagi meminta QR: bot
meminta kode 8 digit dan menuliskannya ke journal sekaligus ke `data/pairing-code.txt`.

```bash
grep WA_PAIRING_NUMBER .env
sudo systemctl restart bundacare-bot
sleep 20
cat data/pairing-code.txt
```

Masukkan kode itu di WhatsApp nomor bot: Perangkat tertaut > Tautkan perangkat >
Tautkan dengan nomor telepon. Kode berlaku beberapa menit saja; kalau kedaluwarsa, bot
otomatis meminta kode baru setiap `WA_PAIRING_CODE_REFRESH_MS` (default 3 menit).
`data/pairing-code.txt` dihapus sendiri begitu sesi tersambung. Setelah tersambung,
kosongkan `WA_PAIRING_NUMBER` kalau mau kembali ke jalur QR.

Verifikasi sesi benar-benar tersambung, jangan hanya melihat kode muncul:

```bash
journalctl -u bundacare-bot -n 5 --no-pager | grep -i "siap digunakan"
ss -ltn | grep 3030                                   # panel admin mendengarkan
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3030/admin/login   # harus 200
```

Endpoint kesehatan butuh sesi admin, jadi masuk dulu lewat panel. Login utama memakai
magic link ke email admin; fallback password hanya kalau `ADMIN_WEB_PASSWORD` diisi.
Kalau log tidak memuat "siap digunakan", taut ulang sesinya.

## Masuk panel: magic link (default)

Login tidak lagi memakai password. Operator memasukkan email admin, lalu tautan masuk
dikirim ke email itu. Isi `.env`:

```env
ADMIN_EMAILS=hudaya.azra@gmail.com
ADMIN_WEB_PUBLIC_URL=https://bot.bundacare.site   # URL publik panel, untuk menyusun tautan
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=alamat@gmail.com
SMTP_PASS=app-password-16-karakter
MAIL_FROM="Bundacare <alamat@gmail.com>"
```

- `SMTP_PASS` adalah App Password Gmail (Google Account > Security > 2-Step Verification >
  App passwords), bukan password akun.
- Tautan berumur pendek (default 15 menit, `MAGIC_LINK_TTL_MS`) dan sekali pakai.
- Token magic link dan token sesi disimpan hanya sebagai hash SHA-256 di SQLite.
- Sesi disimpan di tabel `admin_sessions`, jadi restart service tidak memaksa masuk ulang.
  Masa berlaku default rolling 30 hari (`ADMIN_WEB_SESSION_TTL_MS`), idle 14 hari
  (`ADMIN_WEB_IDLE_TIMEOUT_MS`). Sesi terikat alamat IP dan User-Agent saat login.
- Untuk menguji tanpa mengirim email nyata, set `SMTP_JSON_TRANSPORT=1`.

Fallback darurat berbasis password (opsional): isi `ADMIN_WEB_PASSWORD` dan kirim form ke
`POST /admin/login` (form di halaman login memakai `/admin/login/magic`). Kalau
`ADMIN_WEB_PASSWORD` kosong, login password mati.

Password disimpan sebagai hash scrypt di tabel `settings` (`admin_password_hash` dan
`admin_password_hash_salt`). Tidak ada berkas password plaintext di `data/`.

```bash
# ganti password darurat tanpa menyentuh .env
node scripts/rotate-admin-password.js            # mengikuti petunjuk di skrip
```

Setelah hash berubah, semua sesi panel yang sedang aktif dicabut otomatis (diperiksa tiap
5 menit), jadi tidak ada sesi lama yang tertinggal setelah password diputar.

## Sandbox Chromium di Ubuntu 24

Chrome hanya mau menyalakan sandbox-nya kalau user namespace tidak diblokir AppArmor.
Ubuntu 23.10 ke atas memblokirnya secara default, dan tanpa perbaikan ini bot hanya jalan
dengan `PUPPETEER_NO_SANDBOX=1` (sandbox mati).

```bash
printf 'kernel.apparmor_restrict_unprivileged_userns=0\n' | sudo tee /etc/sysctl.d/99-bundacare-userns.conf
sudo sysctl -p /etc/sysctl.d/99-bundacare-userns.conf
# di .env: PUPPETEER_NO_SANDBOX=0
sudo systemctl restart bundacare-bot
pgrep -a -f chrome-linux64/chrome | grep -c -- "--no-sandbox"   # harus 0
```

## Ringkasan mingguan untuk operator

Tiap Senin di dalam jam kirim, bot mengirim satu pesan ringkasan ke nomor di `ADMIN_WA_IDS`:
jumlah pasien aktif, pendataan yang belum selesai, pengingat terkirim seminggu, berapa yang
dijawab beserta persentasenya, dan daftar nomor yang tidak menjawab 3 hari terakhir. Angka
diambil dari catatan pengingat, akun admin tidak ikut dihitung, dan kalau belum ada data
pesannya menyatakannya apa adanya. Matikan dengan `WEEKLY_DIGEST_ENABLED=0`.

Tanggal kirim terakhir disimpan di tabel `settings` pada kunci `last_weekly_digest_date`,
jadi restart bot tidak membuat ringkasan terkirim dua kali.

## Uji klik panel admin

Selain `npm test`, ada uji klik memakai Chrome sungguhan lewat Playwright:

```bash
pip install playwright && playwright install chrome   # sekali saja
npm run test:ui
```

Skripnya membangun pratinjau halaman admin dengan jaringan yang dimock, lalu memeriksa
tombol, state muat/kosong/gagal, aria-busy, dan tampilan 390 px. Bukti yang dihasilkan
71 pemeriksaan di empat berkas.

## Alarm di luar WhatsApp

Alarm dari dalam bot dikirim ke tiga jalur: webhook, Telegram, dan WhatsApp admin. Jalur
WhatsApp justru mati pada saat WhatsApp bermasalah, jadi isi minimal satu jalur luar:

```bash
ALERT_WEBHOOK_URL=https://contoh.internal/hooks/bundacare
# atau
ALERT_TELEGRAM_TOKEN=123456:ABC...
ALERT_TELEGRAM_CHAT_ID=123456789
```

Cara membuat token Telegram: kirim pesan ke @BotFather, buat bot, salin token, lalu kirim
satu pesan ke bot itu dan ambil `chat_id` dari `https://api.telegram.org/bot<token>/getUpdates`.

## Penjaga luar proses (watchdog)

Bot menulis `data/heartbeat.json` tiap 30 detik. Timer systemd menjalankan
`scripts/watchdog.js` tiap 5 menit: kalau denyut basi atau sesi WhatsApp belum siap terlalu
lama, penjaga mengirim alarm lewat jalur luar di atas. Ini menangkap kasus yang tidak
terlihat dari luar: proses hidup tetapi menggantung.

```bash
cd /opt/bundacare
sudo cp deploy/bundacare-watchdog.service /etc/systemd/system/
sudo cp deploy/bundacare-watchdog.timer /etc/systemd/system/
# samakan User, Group, dan WorkingDirectory dengan unit bot
sudo systemctl daemon-reload
sudo systemctl enable --now bundacare-watchdog.timer
systemctl list-timers bundacare-watchdog.timer
journalctl -u bundacare-watchdog -n 20 --no-pager
```

Uji tanpa mengirim apa pun:

```bash
sudo -u bundacare node scripts/watchdog.js --dry-run   # harus melaporkan keadaan wajar
```

Penjaga juga bisa merestart bot sendiri kalau `WATCHDOG_RESTART=1`. Itu butuh izin sempit
lewat sudoers, bukan sudo penuh:

```bash
echo 'bundacare ALL=(root) NOPASSWD: /usr/bin/systemctl restart bundacare-bot' \
  | sudo tee /etc/sudoers.d/bundacare-watchdog
sudo chmod 0440 /etc/sudoers.d/bundacare-watchdog
sudo visudo -c
```

## Mengunci layanan bot (systemd hardening)

Bot ini menjalankan Chromium dan menyimpan data kesehatan, jadi haknya dibatasi. Tambahkan
ke `[Service]`, lalu `sudo systemctl daemon-reload` dan restart:

```ini
NoNewPrivileges=true
PrivateTmp=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
MemoryMax=1500M
```

`ProtectSystem=strict` juga bisa dipakai, tetapi Chromium perlu menulis ke
`/home/<user>/.cache`, `/home/<user>/.config`, dan direktori sesi WhatsApp, jadi tambahkan
`ReadWritePaths` untuk ketiganya dan uji ulang sesi WhatsApp setelah restart.

## Backup di luar VPS

`scripts/backup-db.js` menguji setiap backup (integritas, tabel inti, data terbaca) sebelum
diakui sah. Backup yang hanya ada di VPS yang sama belum aman, jadi isi salah satu:

```bash
BACKUP_OFFSITE_DIR=/mnt/backup-bundacare     # direktori mount (rclone, S3, NFS)
BACKUP_REMOTE_CMD=rclone copy %f remote:bundacare-backups/   # perintah sendiri, %f = berkas backup
```

Tanpa keduanya, skrip tetap jalan tetapi mencetak peringatan bahwa salinan luar VPS belum ada.

## Backup sesi WhatsApp (terenkripsi)

`scripts/backup-session.js` mengarsipkan `.wwebjs_auth` tanpa menghentikan bot. Arsip ini
berisi kredensial tertaut — siapa pun yang memegangnya bisa memakai sesi WhatsApp bot —
jadi skrip **menolak jalan tanpa enkripsi**:

```bash
# isi passphrase di .env (JANGAN commit)
BACKUP_SESSION_PASSPHRASE=passphrase-panjang-acak
```

Pasang timer (mirip backup database, jalan 04:00):

```bash
sudo cp deploy/bundacare-backup-session.service deploy/bundacare-backup-session.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now bundacare-backup-session.timer
sudo systemctl start bundacare-backup-session.service   # uji sekali
journalctl -u bundacare-backup-session -n 5 --no-pager  # harus "Backup sesi ok"
```

Cache Chromium (`Cache`, `Code Cache`, `GPUCache`, dll.) dikecualikan supaya arsip turun
dari ~227 MB menjadi belasan MB. Pemulihan: lihat "Memulihkan sesi WhatsApp" di bawah —
dekripsi dulu dengan `gpg -d`.

## Pemulihan otomatis sesi WhatsApp

`whatsapp-web.js` menutup browser sendiri saat event `disconnected` (mis. `TIMEOUT`,
`CONFLICT`), tetapi proses Node tetap hidup. Tanpa penanganan, bot menjadi "mati diam":
`Restart=always` systemd tidak pernah aktif karena prosesnya tidak keluar. Karena itu bot
menjadwalkan `initialize()` ulang dengan backoff (`WA_RECONNECT_BASE_DELAY_MS`, default 60
detik, digandakan sampai `WA_RECONNECT_MAX_DELAY_MS`). Kalau `WA_RECONNECT_MAX_ATTEMPTS`
(default 8) habis, proses keluar dengan rapi supaya systemd memulai ulang dari nol.

`disconnected` dengan alasan `LOGOUT` tidak disambung ulang otomatis — sesi memang dicabut
dan butuh penautan manual (QR atau `WA_PAIRING_NUMBER`).

Pastikan `Restart=always` ada di `bundacare-bot.service`; tanpa itu proses yang keluar
tidak akan dihidupkan kembali.

## Memulihkan sesi WhatsApp

Sesi ter-logout (biasanya karena WhatsApp Web diperbarui, atau ada dua proses yang
memakai folder `.wwebjs_auth` yang sama):

```bash
sudo systemctl stop bundacare-bot
rm -rf .wwebjs_auth
# arsip dari scripts/backup-session.js terenkripsi; dekripsi dulu:
gpg -d data/backups/bundacare-session-TANGGAL-JAM.tar.gz.gpg > /tmp/session.tar.gz
tar xzf /tmp/session.tar.gz
rm -f /tmp/session.tar.gz
sudo systemctl start bundacare-bot
```

Kalau backup sesi tidak ada, jalankan `node index.js` untuk memindai QR baru.

## Memulihkan database

Pakai berkas hasil backup (`VACUUM INTO`), bukan salinan manual `data/bundacare.db`:
salinan manual tidak memuat isi WAL terakhir, jadi transaksi paling baru bisa hilang.

```bash
cd /opt/bundacare
sudo systemctl stop bundacare-bot
ls -la data/backups/                       # pilih berkas terbaru
sudo -u bundacare node -e "
const s=require('sqlite3').verbose();const d=new s.Database('data/backups/bundacare-TANGGAL-JAM.db');
d.get('PRAGMA integrity_check',(e,r)=>{console.log(e?e.message:r);d.close();});
"
cp data/backups/bundacare-TANGGAL-JAM.db data/bundacare.db
rm -f data/bundacare.db-wal data/bundacare.db-shm
sudo chown bundacare:bundacare data/bundacare.db
sudo systemctl start bundacare-bot
journalctl -u bundacare-bot -n 20 --no-pager | grep -iE "siap digunakan|integrity"
```

Kalau `integrity_check` gagal saat start, bot menahan semua pengiriman dan mengirim alarm.
Pulihkan dulu dari backup sebelum mengaktifkan lagi.

## Yang tidak boleh masuk git

Folder `data/` (database, audio, backup, file password admin) dan `.wwebjs_auth/`.
`.gitignore` sudah menutupinya dengan pola `data*/`. Periksa dengan `git ls-files`
sebelum setiap commit.

## Pendaftaran web pilot

Belum ada deploy produksi dalam pekerjaan ini.

Registrasi mati secara default (`PUBLIC_REGISTRATION_ENABLED=0`). Sediakan `PUBLIC_WA_NUMBER=628...` jika bot dipasangkan lewat QR; jika pairing memakai nomor, `WA_PAIRING_NUMBER` dapat dipakai sebagai tujuan tautan. Jangan aktifkan sampai kebijakan privasi, permintaan penghapusan, dan jalur HTTPS dari `bundacare.site` ke Express di port admin tersedia. Cloudflare Pages tidak otomatis mem-proxy `/api/registrations`: atur reverse proxy satu origin dan uji dulu, jangan mengekspos port panel admin langsung ke internet.

Sebelum uji coba, cadangkan `data/bundacare.db` dengan `npm run backup` dan folder sesi `.wwebjs_auth`. Gunakan nomor pilot milik pengelola, bukan nomor pasien. Uji di DB sementara dengan `npm test`, kemudian verifikasi POST, status, pesan masuk dari nomor yang sama, daftar admin `GET /admin/api/registrations`, dan persetujuan `POST /admin/api/registrations/:requestId/approve` menggunakan cookie sesi serta header `x-csrf-token`. Persetujuan mengaktifkan akun yang baru atau akun onboarding lama milik nomor yang sudah terverifikasi; akun yang diblokir tidak bisa diaktifkan lewat jalur ini. Kuota aktivasi pilot tercatat terpisah dari data kesehatan agar penghapusan akun tidak mereset batas harian. Status publik tidak menampilkan data ibu. RequestId adalah identitas status, bukan kredensial admin.

WhatsApp hanya menerima kode setelah ibu mengirim sendiri pesan yang dibuka melalui `wa.me`; aplikasi tidak mengirim kode otomatis. Kode berlaku 15 menit dan tidak disimpan plaintext. Nomor yang sudah terdaftar atau sedang menunggu menerima respons web dengan bentuk sama tetapi kode baru tidak mengubah akun; hubungi pengelola bila perlu. Pendaftaran yang kedaluwarsa bisa dicoba ulang dari formulir. Tidak ada jalur uji yang boleh mengirim pesan ke pasien. Pengingat tetap hanya untuk `users.status='active'` dan pengguna yang tidak diblokir. `stop` menjeda.

Selama pilot pantau antrean kirim, kegagalan WA Web, status dan persetujuan secara manual. `whatsapp-web.js` bukan API resmi. Jangan menjanjikan pengiriman atau kestabilan akun. Tutup kembali `PUBLIC_REGISTRATION_ENABLED=0` jika ada masalah.
