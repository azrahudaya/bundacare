"use strict";

// Uji validasi jam pengingat terhadap jendela kirim.
//
// Bug yang dicegah: user memilih jam di luar jendela kirim (mis. 22:10 padahal jendela
// 06:00–21:30). Loop pengingat berhenti di `isWithinSendWindow()` sebelum sempat
// memproses user, sehingga pengingat tidak pernah terkirim dan tidak ada peringatan apa
// pun — user mengira sudah dijadwalkan padahal tidak.

const assert = require("assert");

// Jendela kirim eksplisit supaya uji ini menguji PERILAKU jendela, bukan nilai
// deploy saat ini. Tanpa ini, mengubah jendela deploy (mis. jadi 24 jam) akan
// membuat uji "jam di luar jendela ditolak" gagal padahal kodenya benar.
process.env.SEND_WINDOW_START_HOUR = "6";
process.env.SEND_WINDOW_END_HOUR = "21";
process.env.SEND_WINDOW_END_MINUTE = "30";

const mod = require("../index.js");

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

async function run() {
  await test("jam di dalam jendela kirim diterima", () => {
    const { startHour, endHour, endMinute } = mod.getSendWindow();
    const start = `${String(startHour).padStart(2, "0")}:00`;
    const end = `${String(endHour).padStart(2, "0")}:${String(endMinute).padStart(2, "0")}`;
    assert.strictEqual(mod.parseReminderTime(start).ok, true);
    assert.strictEqual(mod.parseReminderTime(end).ok, true);
    assert.strictEqual(mod.parseReminderTime("17:00").ok, true);
  });

  await test("jam di luar jendela kirim ditolak dengan alasan window", () => {
    // 22:10 adalah kasus nyata yang membuat pengingat tidak terkirim.
    const late = mod.parseReminderTime("22:10");
    assert.strictEqual(late.ok, false);
    assert.strictEqual(late.reason, "window");
    const early = mod.parseReminderTime("03:00");
    assert.strictEqual(early.ok, false);
    assert.strictEqual(early.reason, "window");
  });

  await test("format jam salah ditolak dengan alasan format", () => {
    assert.strictEqual(mod.parseReminderTime("abc").reason, "format");
    assert.strictEqual(mod.parseReminderTime("25:00").reason, "format");
    assert.strictEqual(mod.parseReminderTime("").reason, "format");
  });

  await test("isWithinSendWindowTime konsisten dengan jendela", () => {
    const { startHour, endHour, endMinute } = mod.getSendWindow();
    const startMinutes = startHour * 60;
    const endMinutes = endHour * 60 + endMinute;
    assert.strictEqual(mod.isWithinSendWindowTime("00:00"), startMinutes <= 0);
    assert.strictEqual(mod.isWithinSendWindowTime("23:59"), endMinutes >= 23 * 60 + 59);
    assert.strictEqual(mod.isWithinSendWindowTime(null), false);
    assert.strictEqual(mod.isWithinSendWindowTime("bukan jam"), false);
  });

  await test("pesan error menyebut rentang jam yang benar", () => {
    const windowMsg = mod.reminderTimeErrorText("window");
    assert.ok(windowMsg.includes(mod.sendWindowLabel()));
    assert.ok(windowMsg.includes("WIB"));
    const formatMsg = mod.reminderTimeErrorText("format", "17:00");
    assert.ok(formatMsg.includes("17:00"));
  });

  await test("user dengan jam di luar jendela ditandai di daftar perlu tindakan", () => {
    const outsideHour = mod.getSendWindow().endHour + 1;
    const jam = `${String(Math.min(outsideHour, 23)).padStart(2, "0")}:10`;
    const items = mod.buildNeedsAction([
      { wa_id: "6281@c.us", name: "Uji", status: "active", reminder_time: jam, allow_remindcare: 1 },
    ]);
    const found = items.find((item) => item.reason === "outside_window");
    assert.ok(found, "user dengan jam di luar jendela harus muncul di daftar perlu tindakan");
    assert.ok(found.detail.includes(jam));
  });

  await test("jendela yang melewati tengah malam didukung (22:00-01:55)", () => {
    const { createSendGuard } = require("../lib/send-guard.js");
    const makeGuard = (nowH, nowM) =>
      createSendGuard({
        env: {
          SEND_WINDOW_START_HOUR: "22",
          SEND_WINDOW_END_HOUR: "1",
          SEND_WINDOW_END_MINUTE: "55",
        },
        logger: { warn() {}, error() {}, log() {} },
        localNow: () => ({ hour: nowH, minute: nowM }),
      });
    // Sebelum ini, end < start membuat syarat tidak pernah benar -> semua kirim mati.
    assert.strictEqual(makeGuard(21, 59).isWithinSendWindow(), false);
    assert.strictEqual(makeGuard(22, 0).isWithinSendWindow(), true);
    assert.strictEqual(makeGuard(23, 30).isWithinSendWindow(), true);
    assert.strictEqual(makeGuard(0, 30).isWithinSendWindow(), true);
    assert.strictEqual(makeGuard(1, 55).isWithinSendWindow(), true);
    assert.strictEqual(makeGuard(1, 56).isWithinSendWindow(), false);
    assert.strictEqual(makeGuard(12, 0).isWithinSendWindow(), false);

    const g = makeGuard(12, 0);
    assert.strictEqual(g.isTimeWithinSendWindow("23:30"), true);
    assert.strictEqual(g.isTimeWithinSendWindow("01:55"), true);
    assert.strictEqual(g.isTimeWithinSendWindow("01:56"), false);
    assert.strictEqual(g.isTimeWithinSendWindow("12:00"), false);
    assert.strictEqual(g.sendWindowLabel(), "22:00\u201301:55");
  });

  await test("jendela normal dan jendela 24 jam tetap benar", () => {
    const { createSendGuard } = require("../lib/send-guard.js");
    const normal = createSendGuard({
      env: { SEND_WINDOW_START_HOUR: "6", SEND_WINDOW_END_HOUR: "21", SEND_WINDOW_END_MINUTE: "30" },
      logger: { warn() {}, error() {}, log() {} },
      localNow: () => ({ hour: 12, minute: 0 }),
    });
    assert.strictEqual(normal.isTimeWithinSendWindow("06:00"), true);
    assert.strictEqual(normal.isTimeWithinSendWindow("21:30"), true);
    assert.strictEqual(normal.isTimeWithinSendWindow("21:31"), false);
    assert.strictEqual(normal.isTimeWithinSendWindow("22:10"), false);
    // start == end berarti jendela penuh 24 jam, bukan kosong.
    const full = createSendGuard({
      env: { SEND_WINDOW_START_HOUR: "0", SEND_WINDOW_END_HOUR: "0", SEND_WINDOW_END_MINUTE: "0" },
      logger: { warn() {}, error() {}, log() {} },
      localNow: () => ({ hour: 3, minute: 0 }),
    });
    assert.strictEqual(full.isWithinSendWindow(), true);
    assert.strictEqual(full.isTimeWithinSendWindow("15:00"), true);
  });

  console.log("semua uji jendela kirim lulus");
}

run();
