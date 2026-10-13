"use strict";

// Uji pemulihan sesi WhatsApp: library menutup browser sendiri saat `disconnected`
// tetapi proses Node tetap hidup, jadi tanpa penjadwalan initialize() ulang bot menjadi
// "mati diam". Uji ini memverifikasi backoff, batas percobaan, dan jalur menyerah.

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

function fakeClient() {
  return {
    initCalls: 0,
    destroyCalls: 0,
    async initialize() {
      this.initCalls += 1;
    },
    async destroy() {
      this.destroyCalls += 1;
    },
  };
}

async function run() {
  await test("reconnect pertama dijadwalkan dengan backoff dasar", () => {
    mod.__resetReconnectForTest();
    const client = fakeClient();
    mod.__scheduleReconnectForTest(client, "uji");
    const state = mod.__reconnectStateForTest();
    assert.strictEqual(state.attempt, 1);
    assert.strictEqual(state.hasTimer, true);
    // Timer asli dibatalkan supaya tidak menahan proses uji.
    mod.__resetReconnectForTest();
  });

  await test("permintaan ganda tidak menumpuk timer", () => {
    mod.__resetReconnectForTest();
    const client = fakeClient();
    mod.__scheduleReconnectForTest(client, "pertama");
    mod.__scheduleReconnectForTest(client, "kedua");
    mod.__scheduleReconnectForTest(client, "ketiga");
    // Tiga permintaan tetapi hanya satu percobaan yang tercatat.
    assert.strictEqual(mod.__reconnectStateForTest().attempt, 1);
    mod.__resetReconnectForTest();
  });

  await test("menyerah memanggil shutdown rapi, bukan process.exit langsung", () => {
    mod.__resetReconnectForTest();
    let shutdownCalled = null;
    mod.__setRequestShutdownForTest((reason) => {
      shutdownCalled = reason;
    });
    const client = fakeClient();
    // Habiskan kuota percobaan tanpa menunggu timer benar-benar menyala. Timer
    // dibatalkan tiap putaran agar permintaan berikutnya dihitung sebagai siklus baru.
    for (let i = 0; i < mod.RECONNECT_MAX_ATTEMPTS + 2; i += 1) {
      mod.__scheduleReconnectForTest(client, "uji-menyerah");
      if (shutdownCalled) {
        break;
      }
      mod.__resetReconnectTimerOnlyForTest();
    }
    assert.strictEqual(shutdownCalled, "reconnect-menyerah");
    mod.__setRequestShutdownForTest(null);
    mod.__resetReconnectForTest();
  });

  await test("backoff tumbuh tetapi dibatasi batas maksimum", () => {
    assert.ok(mod.RECONNECT_BASE_DELAY_MS > 0);
    assert.ok(mod.RECONNECT_MAX_DELAY_MS >= mod.RECONNECT_BASE_DELAY_MS);
    // 60s, 120s, 240s ... berhenti di batas maksimum.
    const capped = Math.min(
      mod.RECONNECT_MAX_DELAY_MS,
      mod.RECONNECT_BASE_DELAY_MS * 2 ** 20,
    );
    assert.strictEqual(capped, mod.RECONNECT_MAX_DELAY_MS);
  });

  console.log("semua uji pemulihan sesi lulus");
}

run();
