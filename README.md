# Bundacare

![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=flat&logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-4.22-000000?style=flat&logo=express&logoColor=white)
![SQLite3](https://img.shields.io/badge/SQLite3-5.1-003B57?style=flat&logo=sqlite&logoColor=white)
![whatsapp-web.js](https://img.shields.io/badge/WhatsApp-web.js-25D366?style=flat&logo=whatsapp&logoColor=white)
![Luxon](https://img.shields.io/badge/Luxon-3.7-FF8033?style=flat)
![License](https://img.shields.io/badge/License-MIT-green?style=flat)

Automated WhatsApp bot for daily iron supplement (tablet tambah darah / FE) reminders. Tracks patient adherence through daily polls and natural-language replies, with an integrated web dashboard for healthcare providers and midwives.

## Architecture

```text
+-------------------------------------------------------------+
| Patient (Expectant Mother)                                  |
|   - Daily Iron Tablet (FE) Intake Check via WhatsApp Poll   |
|   - Natural Language Responses (Ya/Sudah/Belum)             |
+------------------------------|------------------------------+
                               |
                               v
+-------------------------------------------------------------+
| Bundacare Engine (whatsapp-web.js)                          |
|                                                             |
|  [Traffic Guard]      : Rate limiter, warm-up, breaker      |
|  [Adherence Core]     : Scheduled daily FE reminder poll    |
|  [Watchdog Timer]     : Process heartbeat and alerts        |
|  [Storage]            : SQLite3 local database              |
+------------------------------|------------------------------+
                               |
                               v
+-------------------------------------------------------------+
| Healthcare Provider / Operator Panel                        |
|   - Web Dashboard: 7-day adherence card and patient triage  |
|   - Weekly Digest: Automated Monday morning summary         |
|   - Multi-channel Alerts: WhatsApp, Telegram, Webhook       |
+-------------------------------------------------------------+
```

## Key Features

- Daily supplement reminders: automated WhatsApp reminders to track iron tablet (TTD) compliance, with deterministic per-user question variations.
- Natural language parsing: recognizes casual Indonesian responses (ya, sudah, belum, baru mau minum) and validates custom reminder time preferences.
- WhatsApp traffic hardening: strict rate limiting, serial message queueing, send-time jitter, session warm-up curve, and circuit breakers to prevent account restrictions.
- Web admin dashboard: secure operator portal featuring 7-day adherence charts, inactive patient lists, CSRF protection, and CSV export.
- Passwordless admin login: magic link sent by email (Gmail SMTP), single-use short-lived tokens, sessions stored in SQLite so they survive restarts.
- External watchdog monitor: automated background heartbeat check with multi-channel alerts via Telegram and webhooks if the bot process degrades.

## Pendaftaran web pilot

Ibu mengisi formulir di website, mengirim satu kode dari nomor WhatsApp sendiri, lalu menunggu persetujuan pengelola. Landing di `bundacare.site` sudah terhubung ke API di `api.bundacare.site`, tetapi pendaftaran belum dibuka: `PUBLIC_REGISTRATION_ENABLED=0` dan nomor bot belum diisi, jadi formulir menampilkan "Pendaftaran belum dibuka."

Kontrak API dan penyiapan pilot ada di [`deploy/INSTALL.md`](deploy/INSTALL.md). Antarmuka dan arah visual ada di [`DESIGN.md`](DESIGN.md). Uji integrasi browser tanpa mengirim WA nyata: `node tests/registration-browser.test.js` (memerlukan Google Chrome; lokasi dapat diatur lewat `PUPPETEER_EXECUTABLE_PATH`).

Status lokal: formulir mengirim ke API satu origin ketika `PUBLIC_REGISTRATION_ENABLED=1` dan nomor bot dikonfigurasi; ketika pilot tutup atau situs statis tanpa API, formulir tetap nonaktif. Dokumen privasi di `site/privasi.html` masih menandai kontak pengelola dan masa simpan yang belum diputuskan. Jangan membuka pendaftaran umum sebelum dua hal itu ditetapkan dan jalur HTTPS teruji.

## Quick Start

### Prerequisites
- Node.js 18+ and npm
- Chromium / Google Chrome
- WhatsApp account

### Installation

```bash
git clone git@github.com:azrahudaya/bundacare.git
cd bundacare
npm install
cp .env.example .env
```

Configure `.env` with your settings:

```env
ADMIN_WA_IDS=628xxxxxxxxxx
ALLOWLIST_WA_IDS=628xxxxxxxxxx
ENFORCE_ALLOWLIST=1
TIMEZONE=Asia/Jakarta
# Login panel admin (magic link lewat email)
ADMIN_EMAILS=hudaya.azra@gmail.com
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=alamat@gmail.com
SMTP_PASS=app-password-16-karakter
```

Run test suite:

```bash
npm test
```

Start the bot:

```bash
npm start
```

Connect your WhatsApp session by scanning the QR code in the terminal or by specifying `WA_PAIRING_NUMBER` in `.env` to use an 8-digit pairing code.

The admin web dashboard is accessible at:
```text
http://127.0.0.1:3030/admin
```

Sign in with a magic link: enter the admin email and the login link is sent to that inbox.
Sessions live in SQLite, so they survive restarts (default rolling 30 days, 14 days idle).
Set `SMTP_JSON_TRANSPORT=1` to test the flow without sending real email.

## Production Deployment

Bundacare includes hardened systemd service and timer templates in `deploy/`:
- `bundacare-bot.service`: main bot process with strict Linux sandboxing.
- `bundacare-watchdog.timer`: 5-minute health check daemon.
- `bundacare-backup.timer`: automated SQLite database backup service.

See [`deploy/INSTALL.md`](deploy/INSTALL.md) for full deployment instructions.

## Documentation

- Technical specifications and flows: [`docs/technical-guide.pdf`](docs/technical-guide.pdf).
- Operational deployment guide: [`deploy/INSTALL.md`](deploy/INSTALL.md).

## Credits

- Emoji stickers in the landing page hero: [Fluent Emoji](https://github.com/microsoft/fluentui-emoji) by Microsoft, licensed [MIT](https://github.com/microsoft/fluentui-emoji/blob/main/LICENSE). The used SVGs are extracted into `site/images/emoji/`; regenerate with `npm run emoji`.

## License

This project is licensed under the [MIT License](LICENSE).
