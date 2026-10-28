'use strict';

const assert = require('assert');
const {
  isReminderControlCommand,
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

test('perintah kendali dikenali walau sedang onboarding', () => {
  ['start', 'mulai', 'stop', 'berhenti', 'ubah jam 19:30', 'jam 7', 'set jam 17.00'].forEach(
    (text) => assert.strictEqual(isReminderControlCommand(text), true, text),
  );
  ['Bunda Sari', 'jakarta', '19:30', 'sudah'].forEach((text) =>
    assert.strictEqual(isReminderControlCommand(text), false, text),
  );
});

console.log('\nsemua tes P3 lulus');
