// Real hardware and camera, through the two Python helpers. Same interface as sim.js:
//   hardware.dropBall()     relay ON for dropRelaySeconds (releases the ball)
//   hardware.recoverBall()  tilt servo to tiltAngle, hold tiltHoldSeconds, back to levelAngle
//   hardware.stopAll()      relay off now, servo back to level and released
//   vision.detect()         green ball still for 2 s -> { status: 'OK', cell } | INVALID | TIMEOUT | CAMERA_LOST
// Timings and angles come from /data/project/config.json (see server.js).

const path = require('path');
const { createPyWorker } = require('./pyworker');

const ROOT = path.resolve(__dirname, '..', '..');
const PYTHON = path.join(ROOT, 'venv', 'bin', 'python');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function createRealHardware({ cfg, log = () => {} }) {
  const w = createPyWorker({ name: 'hardware', python: PYTHON, script: path.join(ROOT, 'hardware', 'hw_helper.py'), log });
  w.start();
  let epoch = 0;     // bumped by stopAll so a sequence in progress stops at its next step
  return {
    simulated: false,
    async dropBall() {
      log(`[hardware] relay ON for ${cfg.dropRelaySeconds}s (ball release)`);
      await w.call('relay_pulse', { seconds: cfg.dropRelaySeconds }, (cfg.dropRelaySeconds + 5) * 1000);
    },
    async recoverBall() {
      const my = ++epoch;
      log(`[hardware] tilt to ${cfg.tiltAngle}° for ${cfg.tiltHoldSeconds}s, then back to ${cfg.levelAngle}°`);
      await w.call('servo', { angle: cfg.tiltAngle });
      await sleep(cfg.tiltHoldSeconds * 1000);
      if (my !== epoch) return;
      await w.call('servo', { angle: cfg.levelAngle });
      await sleep(700);                       // let it arrive before letting go
      if (my !== epoch) return;
      await w.call('servo_release');
    },
    stopAll() {
      epoch++;
      w.call('all_off').catch((e) => log('[hardware] all_off failed:', e.message));
    },
    close: () => w.stop(),
  };
}

function createRealVision({ cfg, log = () => {} }) {
  const w = createPyWorker({
    name: 'vision', python: PYTHON, script: path.join(ROOT, 'vision', 'worker.py'), args: [cfg.camera], log,
  });
  w.start();
  let last = null;   // last result + snapshot, kept in memory only (spec 6.5)
  return {
    simulated: false,
    async detect() {
      last = null;
      const r = await w.call('detect', { timeout: cfg.detectTimeoutSeconds, still: 2 }, (cfg.detectTimeoutSeconds + 15) * 1000);
      last = { ...r, snapshot: r.snapshot ? Buffer.from(r.snapshot, 'base64') : null, at: Date.now() };
      log(`[vision] ${r.status}` + (r.cell ? ` cell ${r.cell} ${r.shares}` : '') + (r.error ? ` ${r.error}` : ''));
      return { status: r.status, cell: r.cell };
    },
    lastResult: () => last && { status: last.status, cell: last.cell, colour: last.colour, shares: last.shares, edge: last.edge, at: last.at },
    lastSnapshot: () => (last ? last.snapshot : null),
    clear: () => { last = null; },
    check: () => w.call('check', {}, 10000),
    close: () => w.stop(),
  };
}

module.exports = { createRealHardware, createRealVision };
