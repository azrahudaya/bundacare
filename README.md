# Bundacare

![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=flat&logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-4.22-000000?style=flat&logo=express&logoColor=white)
![SQLite3](https://img.shields.io/badge/SQLite3-5.1-003B57?style=flat&logo=sqlite&logoColor=white)
![whatsapp-web.js](https://img.shields.io/badge/WhatsApp-web.js-25D366?style=flat&logo=whatsapp&logoColor=white)
![Luxon](https://img.shields.io/badge/Luxon-3.7-FF8033?style=flat)
![License](https://img.shields.io/badge/License-MIT-green?style=flat)

Automated maternal health WhatsApp bot that manages daily iron supplement (tablet tambah darah / FE) reminders, tracks patient adherence, validates delivery timelines, and schedules postpartum care visits. Built with an integrated web dashboard for healthcare providers and midwives.

## Architecture

```text
+-------------------------------------------------------------+
| Patient (Expectant / Postpartum Mother)                     |
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
|  [Delivery Tracking]  : Automated check at week 39+ (HPL)   |
|  [Postpartum Care]    : KF1, KF2, KF3 visit scheduling      |
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

- Daily supplement reminders: automated morning and evening WhatsApp polls to track iron tablet compliance with deterministic per-user question variations.
- Natural language parsing: recognizes casual Indonesian responses (ya, sudah, belum, baru mau minum) and validates custom reminder time preferences.
- Pregnancy and delivery lifecycle: calculates estimated delivery date (HPL) from last menstrual period (HPHT), initiates delivery verification at week 39+, and transitions into postpartum visit reminders (KF1, KF2, KF3).
- WhatsApp traffic hardening: strict rate limiting, serial message queueing, send-time jitter, session warm-up curve, and circuit breakers to prevent account restrictions.
- Web admin dashboard: secure operator portal featuring 7-day adherence charts, inactive patient lists, CSRF protection, and CSV export.
- External watchdog monitor: automated background heartbeat check with multi-channel alerts via Telegram and webhooks if the bot process degrades.

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
ADMIN_PHONE=628xxxxxxxxxx
ADMIN_PASSWORD=change-this-secure-password
ADMIN_SESSION_SECRET=your-random-32-character-secret
TIMEZONE=Asia/Jakarta
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
http://127.0.0.1:3000/admin
```

## Production Deployment

Bundacare includes hardened systemd service and timer templates in `deploy/`:
- `bundacare-bot.service`: main bot process with strict Linux sandboxing.
- `bundacare-watchdog.timer`: 5-minute health check daemon.
- `bundacare-backup.timer`: automated SQLite database backup service.

See [`deploy/INSTALL.md`](deploy/INSTALL.md) for full deployment instructions.

## Documentation

- Technical specifications and flows: [`docs/technical-guide.pdf`](docs/technical-guide.pdf).
- Operational deployment guide: [`deploy/INSTALL.md`](deploy/INSTALL.md).

## License

This project is licensed under the [MIT License](LICENSE).
