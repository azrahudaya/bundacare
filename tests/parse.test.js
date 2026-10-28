'use strict';

const assert = require('assert');
const { DateTime } = require('luxon');
const {
  parseYesNo,
  normalizeTimeInput,
  shouldSendNow,
  getRetryDelayMs,
  canAttemptByBackoff,
} = require('../index');

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`fail - ${name}`);
    throw err;
  }
}

test('parseYesNo returns boolean or null', () => {
  assert.strictEqual(parseYesNo('ya'), true);
  assert.strictEqual(parseYesNo('tidak'), false);
  assert.strictEqual(parseYesNo('belum'), false);
  assert.strictEqual(parseYesNo('mungkin'), null);
});

test('normalizeTimeInput handles common inputs', () => {
  assert.strictEqual(normalizeTimeInput('7'), '07:00');
  assert.strictEqual(normalizeTimeInput('730'), '07:30');
  assert.strictEqual(normalizeTimeInput('17.05'), '17:05');
  assert.strictEqual(normalizeTimeInput('17:5'), '17:05');
  assert.strictEqual(normalizeTimeInput('2460'), null);
});

test('shouldSendNow returns true after scheduled time', () => {
  const now = DateTime.fromISO('2024-01-01T10:05:00', { zone: 'Asia/Jakarta' });
  assert.strictEqual(shouldSendNow('10:00', now), true);
  assert.strictEqual(shouldSendNow('10:30', now), false);
  const exact = DateTime.fromISO('2024-01-01T10:00:00', { zone: 'Asia/Jakarta' });
  assert.strictEqual(shouldSendNow('10:00', exact), true);
});

test('retry backoff delay increases and caps', () => {
  assert.strictEqual(getRetryDelayMs(0), 0);
  assert.ok(getRetryDelayMs(1) > 0);
  assert.ok(getRetryDelayMs(4) >= getRetryDelayMs(3));
  assert.ok(getRetryDelayMs(20) <= 30 * 60 * 1000);
});

test('canAttemptByBackoff blocks during delay and allows after delay', () => {
  const now = DateTime.fromISO('2026-02-19T10:00:00', { zone: 'Asia/Jakarta' });
  const oneMinuteAgo = now.minus({ minutes: 1 }).toISO();
  const tenMinutesAgo = now.minus({ minutes: 10 }).toISO();
  assert.strictEqual(canAttemptByBackoff(oneMinuteAgo, 1, now), false);
  assert.strictEqual(canAttemptByBackoff(tenMinutesAgo, 1, now), true);
  assert.strictEqual(canAttemptByBackoff(null, 2, now), true);
});
