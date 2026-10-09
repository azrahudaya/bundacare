"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sqlite3 = require("sqlite3");

const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "bundacare-vote-tests-"));
const DATA_DIR = path.join(WORK, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

process.env.DATA_DIR = DATA_DIR;
process.env.ENFORCE_ALLOWLIST = "1";
process.env.ALLOWLIST_WA_IDS = "6282240269818,62811112222";
process.env.ADMIN_WA_IDS = "6282240269818";
process.env.SEND_MIN_GAP_MS = "5";
process.env.SEND_JITTER_MS = "5";
process.env.REPLY_MIN_GAP_MS = "5";
process.env.REPLY_JITTER_MS = "5";
process.env.SEND_WINDOW_START_HOUR = "0";
process.env.SEND_WINDOW_END_HOUR = "23";
process.env.SEND_WINDOW_END_MINUTE = "59";

const mod = require("../index.js");

function wibDay(offsetDays = 0) {
  return require("luxon")
    .DateTime.now()
    .setZone("Asia/Jakarta")
    .minus({ days: offsetDays })
    .toISODate();
}

async function test(name, fn) {
  try {
    await fn();
    console.log("ok -", name);
  } catch (err) {
    console.error("FAIL -", name);
    console.error(err);
    process.exit(1);
  }
}

function makeClient(sent) {
  return {
    sendMessage: async (target, text) => {
      const body = typeof text === "string" ? text : (text && text.title ? text.title : String(text));
      sent.push({ target, body });
      return { id: { _serialized: `true_${target}_msg_${Date.now()}` } };
    },
    getContactById: async (id) => null,
  };
}

(async () => {
  const db = new sqlite3.Database(":memory:");
  await mod.__initDbForTest(db);
  mod.__setSendReadyForTest(true);

  const sent = [];
  const client = makeClient(sent);
  const PATIENT = "62811112222@c.us";
  const PATIENT_LID = "204930287689898@lid";
  const today = wibDay();

  // 1. Setup user active dengan last_poll_message_id
  await db.run(
    `INSERT INTO users (wa_id, name, hpht, hpht_iso, status, allow_remindcare, reminder_time, last_reminder_date, last_poll_message_id, is_allowed, is_admin, created_at, updated_at)
     VALUES (?, ?, '10-01-2026', '2026-01-10', 'active', 1, '19:00', ?, ?, 1, 0, datetime('now'), datetime('now'))`,
    [PATIENT, "Siti", today, `true_${PATIENT}_poll_12345`],
  );

  await test("vote_update standar mencatat respon FE poll ke reminder_logs", async () => {
    sent.length = 0;
    const vote = {
      voter: PATIENT,
      parentMessage: { id: { _serialized: `true_${PATIENT}_poll_12345` } },
      selectedOptions: [{ name: "Sudah", localId: 0 }],
    };
    await mod.__handleVoteUpdateForTest(db, client, vote);

    const log = await new Promise((res, rej) => {
      db.get("SELECT * FROM reminder_logs WHERE wa_id = ? AND reminder_date = ?", [PATIENT, today], (err, r) => err ? rej(err) : res(r));
    });
    assert.ok(log, "reminder_log harus ada");
    assert.strictEqual(log.response, "Sudah");
    assert.strictEqual(Number(log.response_sudah_count), 1);
    assert.ok(sent.some((m) => /Terima kasih/.test(m.body)), "harus ada pesan konfirmasi");
  });

  await test("vote_update lewat identitas @lid berhasil dipetakan lewat tabel alias", async () => {
    await mod.recordAlias(db, PATIENT_LID, PATIENT);
    sent.length = 0;
    const vote = {
      voter: PATIENT_LID,
      parentMsgKey: { _serialized: `true_${PATIENT}_poll_12345`, id: "poll_12345" },
      selectedOptions: [{ name: "Belum", localId: 1 }],
    };
    await mod.__handleVoteUpdateForTest(db, client, vote);

    const log = await new Promise((res, rej) => {
      db.get("SELECT * FROM reminder_logs WHERE wa_id = ? AND reminder_date = ?", [PATIENT, today], (err, r) => err ? rej(err) : res(r));
    });
    assert.strictEqual(log.response, "Belum");
    assert.strictEqual(Number(log.response_belum_count), 1);
    assert.ok(sent.some((m) => /jangan lupa diminum/.test(m.body)));
  });

  await test("vote_update dengan nama opsi undefined (hanya localId) tetap terdeteksi", async () => {
    sent.length = 0;
    const vote = {
      voter: PATIENT,
      parentMsgKey: { remote: PATIENT, id: "poll_12345", fromMe: true },
      selectedOptions: [{ name: undefined, localId: 0 }],
    };
    await mod.__handleVoteUpdateForTest(db, client, vote);

    const log = await new Promise((res, rej) => {
      db.get("SELECT * FROM reminder_logs WHERE wa_id = ? AND reminder_date = ?", [PATIENT, today], (err, r) => err ? rej(err) : res(r));
    });
    assert.strictEqual(log.response, "Sudah");
    assert.strictEqual(Number(log.response_sudah_count), 2);
  });

  await test("start saat onboarding step 5 tidak melompat ke step 9 melainkan mengulang step 5", async () => {
    const ONBOARD_USER = "62899990001@c.us";
    await mod.addPanelAllowedNumber(db, ONBOARD_USER, null, "panel", "admin");
    await db.run(
      `INSERT INTO users (wa_id, name, hpht, hpht_iso, status, onboarding_step, allow_remindcare, is_allowed, created_at, updated_at)
       VALUES (?, 'Bunda Nur', '10-01-2026', '2026-01-10', 'onboarding', 5, 1, 1, datetime('now'), datetime('now'))`,
      [ONBOARD_USER],
    );

    sent.length = 0;
    await mod.__handleMessageForTest(db, client, {
      from: ONBOARD_USER,
      body: "start",
      fromMe: false,
      id: { _serialized: "msg_onboard_start" },
    });

    const user = await new Promise((res, rej) => {
      db.get("SELECT * FROM users WHERE wa_id = ?", [ONBOARD_USER], (err, r) => err ? rej(err) : res(r));
    });
    assert.strictEqual(Number(user.onboarding_step), 5, "Step harus tetap 5");
    assert.ok(sent.some((m) => /Pertanyaan 5 dari \d+/.test(m.body)), "Harus menanyakan pertanyaan 5");
  });

  await test("normalizeBirthWeightGram mengonversi kg dan memvalidasi rentang klinis", () => {
    assert.strictEqual(mod.normalizeBirthWeightGram("3200 gram"), "3200 gram");
    assert.strictEqual(mod.normalizeBirthWeightGram("3200"), "3200 gram");
    assert.strictEqual(mod.normalizeBirthWeightGram("3.2 kg"), "3200 gram");
    assert.strictEqual(mod.normalizeBirthWeightGram("3,2 kg"), "3200 gram");
    assert.strictEqual(mod.normalizeBirthWeightGram("3.2"), "3200 gram");
    assert.strictEqual(mod.normalizeBirthWeightGram("3 kg"), "3000 gram");
    assert.strictEqual(mod.normalizeBirthWeightGram("3"), "3000 gram");
    // Di luar batas wajar bayi lahir (500g - 6000g)
    assert.strictEqual(mod.normalizeBirthWeightGram("32"), null);
    assert.strictEqual(mod.normalizeBirthWeightGram("300 gram"), null);
    assert.strictEqual(mod.normalizeBirthWeightGram("8000 gram"), null);
  });

  await test("perintah ganti jam dan lanjut bekerja konsisten dengan start dan ubah jam", async () => {
    sent.length = 0;
    await mod.__handleMessageForTest(db, client, {
      from: PATIENT,
      body: "ganti jam 18:30",
      fromMe: false,
      id: { _serialized: "msg_ganti_jam" },
    });
    const u1 = await new Promise((res, rej) => db.get("SELECT * FROM users WHERE wa_id = ?", [PATIENT], (e, r) => e ? rej(e) : res(r)));
    assert.strictEqual(u1.reminder_time, "18:30");
    assert.ok(sent.some((m) => /Jam pengingat diubah ke 18:30/.test(m.body)));

    sent.length = 0;
    await mod.__handleMessageForTest(db, client, {
      from: PATIENT,
      body: "lanjut",
      fromMe: false,
      id: { _serialized: "msg_lanjut" },
    });
    assert.ok(sent.some((m) => /Siap, bundacare aktif lagi/.test(m.body)));
  });

  await test("sapaan santai khas Indonesia (assalamu'alaikum, selamat pagi, p) dikenali", async () => {
    sent.length = 0;
    await mod.__handleMessageForTest(db, client, {
      from: PATIENT,
      body: "assalamu'alaikum",
      fromMe: false,
      id: { _serialized: "msg_salam" },
    });
    assert.ok(sent.some((m) => /Halo, Siti/.test(m.body)));

    sent.length = 0;
    await mod.__handleMessageForTest(db, client, {
      from: PATIENT,
      body: "selamat pagi",
      fromMe: false,
      id: { _serialized: "msg_pagi" },
    });
    assert.ok(sent.some((m) => /Halo, Siti/.test(m.body)));
  });

  db.close();
  console.log("semua uji perbaikan poll vote dan validasi lulus");
})();
