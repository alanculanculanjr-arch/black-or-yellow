const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createPyWorker } = require('../src/pyworker');

const make = () => createPyWorker({
  name: 'echo', python: 'python3', script: path.join(__dirname, 'fixtures', 'echo_worker.py'), restartMs: 50,
});

test('replies are matched to their requests, errors become rejections', async (t) => {
  const w = make();
  t.after(() => w.stop());
  const [a, b] = await Promise.all([w.call('echo', { value: 1 }), w.call('echo', { value: 2 })]);
  assert.deepEqual([a.value, b.value], [1, 2]);
  await assert.rejects(w.call('fail'), /boom/);
});

test('a request with no answer times out', async (t) => {
  const w = make();
  t.after(() => w.stop());
  await assert.rejects(w.call('slow', {}, 100), /no answer/);
});

test('a crashed helper fails what was waiting and is restarted', async (t) => {
  const w = make();
  t.after(() => w.stop());
  await assert.rejects(w.call('die', {}, 2000), /stopped/);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal((await w.call('echo', { value: 'back' })).value, 'back');
});
