// Simulated hardware and camera, used until the real servos and vision worker exist
// (spec 40.8: keep simulated and real controls separate).
//
// The real versions (Phase 5 and 6) must offer the same functions:
//   hardware.dropBall()     open and close the trapdoor           -> Promise
//   hardware.recoverBall()  tilt board, run blower, level board   -> Promise
//   hardware.stopAll()      everything off / safe position, now   -> void
//   vision.detect(opts)     watch until the ball is still for 2 s, or 10 s pass
//                           -> Promise<{ status: 'OK', cell } | { status: 'TIMEOUT' }
//                                      | { status: 'INVALID' } | { status: 'CAMERA_LOST' }>

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function createSimHardware({ dropMs = 800, recoverMs = 3000, log = () => {} } = {}) {
  return {
    simulated: true,
    async dropBall() {
      log('[sim] trapdoor open, ball released');
      await wait(dropMs);
    },
    async recoverBall() {
      log('[sim] tilting board, blower on');
      await wait(recoverMs);
      log('[sim] blower off, board level');
    },
    stopAll() {
      log('[sim] all actuators stopped');
    },
  };
}

// opts.sim chooses the outcome: 'random' (default), '1'..'16' for a cell,
// 'timeout', 'invalid' or 'camera-lost'.
function createSimVision({ detectMs = 2500 } = {}) {
  return {
    simulated: true,
    async detect({ sim = 'random' } = {}) {
      await wait(detectMs);
      if (sim === 'timeout') return { status: 'TIMEOUT' };
      if (sim === 'invalid') return { status: 'INVALID' };
      if (sim === 'camera-lost') return { status: 'CAMERA_LOST' };
      const cell = Number(sim);
      if (Number.isInteger(cell) && cell >= 1 && cell <= 16) return { status: 'OK', cell };
      return { status: 'OK', cell: 1 + Math.floor(Math.random() * 16) };
    },
  };
}

module.exports = { createSimHardware, createSimVision };
