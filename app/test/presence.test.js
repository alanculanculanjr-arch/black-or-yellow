const test = require('node:test');
const assert = require('node:assert/strict');
const { createPresence } = require('../src/presence');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('timeout fires only after the last connection has been gone for the grace period', async () => {
  const timedOut = [];
  const p = createPresence({ graceMs: 50, onTimeout: (id) => timedOut.push(id) });

  p.connected(1);
  p.connected(1); // second tab
  p.disconnected(1);
  await wait(80);
  assert.deepEqual(timedOut, [], 'one tab still open');

  p.disconnected(1);
  assert.equal(p.isConnected(1), false);
  await wait(80);
  assert.deepEqual(timedOut, [1]);
  p.stop();
});

test('reconnecting within the grace period keeps the player active', async () => {
  const timedOut = [];
  const p = createPresence({ graceMs: 60, onTimeout: (id) => timedOut.push(id) });
  p.connected(2);
  p.disconnected(2);
  await wait(30);
  p.connected(2);
  await wait(60);
  assert.deepEqual(timedOut, []);
  p.stop();
});

test('expectConnection starts the timer for players who never connect', async () => {
  const timedOut = [];
  const p = createPresence({ graceMs: 40, onTimeout: (id) => timedOut.push(id) });
  p.expectConnection(3);
  p.connected(4);
  p.expectConnection(4); // already connected: no timer
  await wait(70);
  assert.deepEqual(timedOut, [3]);
  p.stop();
});
