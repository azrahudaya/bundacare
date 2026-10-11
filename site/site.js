"use strict";

// Dibungkus IIFE: `return` di top-level tidak sah di browser dan membuat seluruh
// skrip gagal di-parse (form tidak pernah aktif). Di Node ini lolos, di browser tidak.
(function () {
// Landing page bisa di-host di origin berbeda dari API bot (GitHub Pages + backend VPS).
// Semua panggilan API lewat helper ini supaya base URL diatur di satu tempat.
const API_BASE = (window.BUNDACARE_API_BASE || "").replace(/\/+$/, "");
const apiUrl = (path) => `${API_BASE}${path}`;

const form = document.querySelector("#registration-form");
if (!form) return;

const availability = document.querySelector("#availability");
const feedback = document.querySelector("#form-feedback");
const result = document.querySelector("#registration-result");
const checkButton = document.querySelector("#check-status");
const submitButton = document.querySelector("#submit-button");
const statusTitle = document.querySelector("#status-title");
const statusDescription = document.querySelector("#status-description");
const fields = ["name", "phone", "reminderTime", "consent"].map(id => document.getElementById(id));
let requestId = "";
let verifying = false;
const pendingKey = "bundacare-pending";

const setEnabled = enabled => {
  fields.forEach(f => f.disabled = !enabled);
  submitButton.disabled = !enabled;
};

const showError = (id, text) => {
  const el = document.getElementById(id);
  el.setCustomValidity(text);
  el.reportValidity();
};

const clearErrors = () => {
  fields.forEach(f => f.setCustomValidity(""));
  feedback.hidden = true;
};

const apiError = async res => {
  try {
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const data = await res.json();
      if (data.error) return data.error;
    }
  } catch (_) {}
  return res.status === 503
    ? "Pendaftaran pilot belum dibuka."
    : "Permintaan gagal. Coba lagi.";
};

const showVerification = (id, url, expiresAt) => {
  const u = new URL(url);
  if (u.protocol !== "https:" || !/^[a-f0-9]{48}$/.test(id) || !Date.parse(expiresAt)) {
    throw new Error("invalid response");
  }
  requestId = id;
  document.querySelector("#verification-link").href = u.href;
  document.querySelector("#expiry-note").textContent = `Kirim pesan sebelum ${new Date(expiresAt).toLocaleString("id-ID")}.`;
  form.hidden = true;
  result.hidden = false;
  statusTitle.textContent = "Menunggu verifikasi";
  statusDescription.textContent = "Kirim pesan verifikasi dari nomor yang didaftarkan.";
};

async function checkAvailability() {
  setEnabled(false);
  availability.textContent = "Memeriksa…";
  try {
    const res = await fetch(apiUrl("/api/registrations/availability"), { headers: { Accept: "application/json" }, cache: "no-store" });
    const data = await res.json();
    if (res.ok && data.open) {
      availability.textContent = "Pendaftaran pilot tersedia.";
      setEnabled(true);
    } else {
      availability.textContent = "Pendaftaran belum dibuka.";
    }
  } catch (_) {
    availability.textContent = "Tidak dapat terhubung.";
  }
}

function validate() {
  clearErrors();
  const name = document.getElementById("name").value.trim();
  const rawPhone = document.getElementById("phone").value.replace(/[\s()+.-]/g, "");
  const phone = rawPhone.startsWith("0") ? `62${rawPhone.slice(1)}` : rawPhone;
  const reminderTime = form.reminderTime.value;
  let ok = true;
  const fail = (id, msg) => { showError(id, msg); ok = false; };

  if (name.length < 2 || name.length > 100) fail("name", "Nama minimal 2 huruf.");
  if (!/^628\d{8,12}$/.test(phone)) fail("phone", "Nomor tidak valid.");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(reminderTime)) fail("reminderTime", "Pilih jam.");
  if (!form.consent.checked) fail("consent", "Centang persetujuan.");

  return ok ? { name, phone, reminderTime, consent: true } : null;
}

form.addEventListener("submit", async e => {
  e.preventDefault();
  if (submitButton.disabled) return;
  const data = validate();
  if (!data) return;
  submitButton.disabled = true;
  submitButton.textContent = "Mengirim…";
  try {
    const res = await fetch(apiUrl("/api/registrations"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(data),
      cache: "no-store"
    });
    if (!res.ok) {
      feedback.textContent = await apiError(res);
      feedback.hidden = false;
      if (res.status === 503) setEnabled(false);
      return;
    }
    const body = await res.json();
    showVerification(body.requestId, body.verificationUrl, body.expiresAt);
    sessionStorage.setItem(pendingKey, JSON.stringify({ requestId: body.requestId, verificationUrl: body.verificationUrl, expiresAt: body.expiresAt }));
  } catch (_) {
    feedback.textContent = "Gagal mengirim. Periksa koneksi dan coba lagi.";
    feedback.hidden = false;
  } finally {
    submitButton.textContent = "Daftar pengingat";
    submitButton.disabled = false;
  }
});

const states = {
  pending_verification: ["Menunggu verifikasi", "Kirim pesan melalui tautan di atas."],
  pending_approval: ["Menunggu persetujuan", "Nomor sudah diverifikasi. Pengelola akan menyetujui."],
  active: ["Pengingat aktif", "Pengingat akan dikirim sesuai jam yang dipilih."],
  expired: ["Kedaluwarsa", "Kode tidak berlaku. Isi ulang formulir."],
  paused: ["Dihentikan", "Pengingat dihentikan. Hubungi pengelola."]
};

checkButton.addEventListener("click", async () => {
  if (!requestId || verifying) return;
  verifying = true;
  checkButton.disabled = true;
  statusTitle.textContent = "Memeriksa…";
  try {
    const res = await fetch(apiUrl(`/api/registrations/status?requestId=${encodeURIComponent(requestId)}`), { headers: { Accept: "application/json" }, cache: "no-store" });
    if (!res.ok) throw new Error(await apiError(res));
    const data = await res.json();
    if (!states[data.status]) throw new Error("Status tidak dikenal.");
    [statusTitle.textContent, statusDescription.textContent] = states[data.status];
    if (data.status === "expired" || data.status === "paused") sessionStorage.removeItem(pendingKey);
  } catch (err) {
    statusTitle.textContent = "Status belum dapat diperiksa";
    statusDescription.textContent = err.message || "Coba lagi.";
  } finally {
    verifying = false;
    checkButton.disabled = false;
  }
});

document.querySelector("#start-over").addEventListener("click", () => {
  requestId = "";
  sessionStorage.removeItem(pendingKey);
  result.hidden = true;
  form.hidden = false;
  form.reset();
  clearErrors();
  checkAvailability();
});

let restored = false;
try {
  const saved = JSON.parse(sessionStorage.getItem(pendingKey) || "null");
  if (saved) {
    showVerification(saved.requestId, saved.verificationUrl, saved.expiresAt);
    restored = true;
    checkButton.click();
  }
} catch (_) { sessionStorage.removeItem(pendingKey); }

if (!restored) checkAvailability();
})();
