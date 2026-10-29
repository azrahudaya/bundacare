"use strict";

const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const { DateTime } = require("luxon");

const TIMEZONE = "Asia/Jakarta";
const ROOT = path.join(__dirname, "..");
// Hormati DATA_DIR supaya seed demo tidak pernah menimpa basis data kerja.
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, "data");
const DB_PATH = path.join(DATA_DIR, "bundacare.db");

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      return resolve(this);
    });
  });
}

function close(db) {
  return new Promise((resolve, reject) => {
    db.close((err) => (err ? reject(err) : resolve()));
  });
}

function toDateKey(dt) {
  return dt.toFormat("yyyy-LL-dd");
}

function iso(dt) {
  return dt.toISO({ suppressMilliseconds: true });
}

function hashInt(input) {
  let h = 2166136261;
  const str = String(input || "");
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h +=
      (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return Math.abs(h >>> 0);
}

function randomResponseForDay(seed, dayIndex, responseRate = 0.7) {
  const r = (hashInt(`${seed}-resp-${dayIndex}`) % 1000) / 1000;
  if (r > responseRate) {
    return null;
  }
  const belumRoll = hashInt(`${seed}-belum-${dayIndex}`) % 100;
  return belumRoll < 22 ? "Belum" : "Sudah";
}

function buildReminderCreatedAt(dateKey, seed, dayIndex) {
  const minute = hashInt(`${seed}-minute-${dayIndex}`) % 13;
  const second = hashInt(`${seed}-second-${dayIndex}`) % 60;
  const hourOffset = hashInt(`${seed}-hour-${dayIndex}`) % 2;
  const hour = 20 + hourOffset;
  return `${dateKey}T${String(hour).padStart(2, "0")}:${String(minute).padStart(
    2,
    "0",
  )}:${String(second).padStart(2, "0")}+07:00`;
}

async function createSchema(db) {
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wa_id TEXT UNIQUE NOT NULL,
      name TEXT,
      age TEXT,
      pregnancy_number TEXT,
      routine_meds INTEGER,
      tea INTEGER,
      reminder_person TEXT,
      allow_remindcare INTEGER,
      reminder_time TEXT,
      is_admin INTEGER NOT NULL DEFAULT 0,
      is_allowed INTEGER NOT NULL DEFAULT 0,
      is_blocked INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'onboarding',
      onboarding_step INTEGER NOT NULL DEFAULT 1,
      last_reminder_date TEXT,
      last_poll_message_id TEXT,
      last_reminder_text_date TEXT,
      fe_poll_last_attempt_at TEXT,
      fe_poll_fail_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  );

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS reminder_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wa_id TEXT NOT NULL,
      reminder_date TEXT NOT NULL,
      response TEXT,
      response_count INTEGER NOT NULL DEFAULT 0,
      response_sudah_count INTEGER NOT NULL DEFAULT 0,
      response_belum_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      UNIQUE(wa_id, reminder_date)
    )`,
  );
}

async function insertUser(db, fields) {
  const base = {
    name: null,
    age: null,
    pregnancy_number: null,
    routine_meds: 1,
    tea: 0,
    reminder_person: "Suami",
    allow_remindcare: 1,
    reminder_time: "20:00",
    is_admin: 0,
    is_allowed: 1,
    is_blocked: 0,
    status: "active",
    onboarding_step: 0,
    last_reminder_date: null,
    last_poll_message_id: null,
    last_reminder_text_date: null,
    fe_poll_last_attempt_at: null,
    fe_poll_fail_count: 0,
  };
  const row = { ...base, ...fields };
  const cols = Object.keys(row);
  const sql = `INSERT INTO users (${cols.join(", ")}) VALUES (${cols
    .map(() => "?")
    .join(", ")})`;
  await run(db, sql, cols.map((c) => row[c]));
}

async function seedReminderLogs(db, waId, startDateIso, endDateIso, rate, seed) {
  const start = DateTime.fromISO(startDateIso, { zone: TIMEZONE });
  const end = DateTime.fromISO(endDateIso, { zone: TIMEZONE });
  const totalDays = Math.floor(end.diff(start, "days").days) + 1;
  for (let i = 0; i < totalDays; i += 1) {
    const day = start.plus({ days: i });
    const dateKey = toDateKey(day);
    const response = randomResponseForDay(seed, i, rate);
    const createdAt = buildReminderCreatedAt(dateKey, seed, i);
    await run(
      db,
      `INSERT INTO reminder_logs (
        wa_id, reminder_date, response, response_count,
        response_sudah_count, response_belum_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        waId,
        dateKey,
        response,
        response ? 1 : 0,
        response === "Sudah" ? 1 : 0,
        response === "Belum" ? 1 : 0,
        createdAt,
      ],
    );
  }
}

async function main() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  let resetByDrop = false;
  if (fs.existsSync(DB_PATH)) {
    try {
      fs.unlinkSync(DB_PATH);
    } catch (err) {
      if (err && err.code === "EBUSY") {
        resetByDrop = true;
      } else {
        throw err;
      }
    }
  }

  const db = new sqlite3.Database(DB_PATH);
  if (resetByDrop) {
    await run(db, "DROP TABLE IF EXISTS reminder_logs");
    await run(db, "DROP TABLE IF EXISTS users");
  }
  await createSchema(db);

  const users = [
    {
      wa_id: "6281200000001@c.us",
      name: "Ibu Demo Satu",
      age: "22",
      pregnancy_number: "1",
      reminder_person: "Suami",
      is_admin: 1,
      status: "active",
      last_reminder_date: "2026-04-21",
      created_at: "2026-02-25T08:00:00+07:00",
      updated_at: "2026-04-21T20:30:00+07:00",
      logs: ["2026-02-25", "2026-04-21", 0.73, "demo1"],
    },
    {
      wa_id: "6281200000002@c.us",
      name: "Ibu Demo Dua",
      age: "27",
      pregnancy_number: "2",
      reminder_time: "19:30",
      status: "active",
      created_at: "2026-03-10T09:15:00+07:00",
      updated_at: "2026-05-30T19:35:00+07:00",
      logs: ["2026-03-10", "2026-05-30", 0.68, "demo2"],
    },
    {
      wa_id: "6281200000003@c.us",
      name: "Ibu Demo Tiga",
      age: "30",
      pregnancy_number: "1",
      reminder_time: "21:00",
      status: "active",
      created_at: "2026-03-01T11:00:00+07:00",
      updated_at: "2026-05-30T21:05:00+07:00",
      logs: ["2026-03-01", "2026-05-30", 0.62, "demo3"],
    },
    {
      wa_id: "6281200000004@c.us",
      name: "Ibu Demo Empat",
      age: "20",
      pregnancy_number: null,
      reminder_time: null,
      status: "onboarding",
      onboarding_step: 4,
      allow_remindcare: 0,
      created_at: "2026-05-29T14:10:00+07:00",
      updated_at: "2026-05-30T09:00:00+07:00",
      logs: null,
    },
  ];

  let totalReminderLogs = 0;
  for (const u of users) {
    const { logs, ...userFields } = u;
    const createdAtIso = u.created_at || iso(DateTime.now().setZone(TIMEZONE));
    const updatedAtIso = u.updated_at || createdAtIso;
    await insertUser(db, {
      ...userFields,
      created_at: createdAtIso,
      updated_at: updatedAtIso,
    });

    if (Array.isArray(logs)) {
      const [startIso, endIso, rate, seed] = logs;
      const start = DateTime.fromISO(startIso, { zone: TIMEZONE });
      const end = DateTime.fromISO(endIso, { zone: TIMEZONE });
      totalReminderLogs += Math.floor(end.diff(start, "days").days) + 1;
      await seedReminderLogs(db, u.wa_id, startIso, endIso, rate, seed);
    }
  }

  await close(db);
  console.log(`DB reset berhasil: ${DB_PATH}`);
  console.log(`Total users: ${users.length}`);
  console.log(`Total reminder logs: ${totalReminderLogs}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
