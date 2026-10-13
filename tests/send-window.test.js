"use strict";

// Uji validasi jam pengingat terhadap jendela kirim.
//
// Bug yang dicegah: user memilih jam di luar jendela kirim (mis. 22:10 padahal jendela
// 06:00–21:30). Loop pengingat berhenti di `isWithinSendWindow()` sebelum sempat
// memproses user, sehingga pengingat tidak pernah terkirim dan tidak ada peringatan apa
// pun — user mengira sudah dijadwalkan padahal tidak.

const assert = require("assert");

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

  console.log("semua uji jendela kirim lulus");
}

run();
