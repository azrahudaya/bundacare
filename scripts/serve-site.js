#!/usr/bin/env node
"use strict";

// Server lokal untuk menguji landing page bundacare.site tanpa menjalankan bot WhatsApp.
// Menyajikan folder site/ dan menyediakan mock API registrasi supaya formulir dapat dibuka.

const express = require("express");
const path = require("path");
const crypto = require("crypto");

const app = express();
app.use(express.json());

const PORT = process.env.SITE_PORT || 8787;
const HOST = process.env.SITE_HOST || "127.0.0.1";
const PUBLIC_WA_NUMBER = process.env.PUBLIC_WA_NUMBER || process.env.WA_PAIRING_NUMBER || "6280000000000";

const requests = new Map();

function randomId() {
  return crypto.randomBytes(24).toString("hex");
}

function expiryDate() {
  const d = new Date(Date.now() + 15 * 60 * 1000);
  return d.toISOString();
}

function waMeLink(phone, code) {
  const normalized = phone.replace(/\D/g, "").replace(/^0/, "62");
  const text = encodeURIComponent(`Verifikasi Bundacare #${code}`);
  return `https://wa.me/${normalized}?text=${text}`;
}

app.get("/api/registrations/availability", (_req, res) => {
  res.json({ open: true });
});

app.post("/api/registrations", (req, res) => {
  const { name, phone, reminderTime, consent } = req.body || {};
  if (!name || !phone || !reminderTime || !consent) {
    return res.status(400).json({ error: "Data tidak lengkap." });
  }
  const requestId = randomId();
  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  const record = {
    requestId,
    status: "pending_verification",
    name,
    phone,
    reminderTime,
    code,
    createdAt: new Date().toISOString(),
  };
  requests.set(requestId, record);

  res.status(201).json({
    requestId,
    verificationUrl: waMeLink(PUBLIC_WA_NUMBER, code),
    expiresAt: expiryDate(),
  });
});

app.get("/api/registrations/status", (req, res) => {
  const { requestId } = req.query;
  const record = requests.get(requestId);
  if (!record) {
    return res.status(404).json({ error: "Pendaftaran tidak ditemukan." });
  }
  // Simulasi: setelah 30 detik, status berubah jadi pending_approval
  const elapsed = Date.now() - new Date(record.createdAt).getTime();
  if (elapsed > 30_000 && record.status === "pending_verification") {
    record.status = "pending_approval";
  }
  res.json({ status: record.status });
});

// Di lokal, landing harus memanggil mock API satu origin, bukan api.bundacare.site.
// config.js asli mengarah ke produksi, jadi di sini di-override supaya formulir terbuka.
app.get("/config.js", (_req, res) => {
  res.type("application/javascript").send(
    'window.BUNDACARE_API_BASE = "";\n',
  );
});

app.use(express.static(path.join(__dirname, "..", "site"), { index: "index.html" }));

app.listen(PORT, HOST, () => {
  console.log(`Landing page Bundacare berjalan di http://${HOST}:${PORT}/`);
  console.log(`Mock API tersedia di http://${HOST}:${PORT}/api/registrations/...`);
  console.log("Tekan Ctrl+C untuk berhenti.");
});
