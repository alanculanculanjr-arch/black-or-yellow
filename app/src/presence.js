// Who is connected right now, and the 2-minute disconnect grace period (spec 15.3).
//
// A player can have several tabs or reconnects open; they count as connected while at
// least one Socket.IO connection is open. When the last one closes a timer starts; if
// they haven't come back when it fires, their account becomes inactive.

const GRACE_MS = 2 * 60 * 1000;

function createPresence({ onTimeout, graceMs = GRACE_MS }) {
  const connections = new Map(); // playerId -> open socket count
  const timers = new Map(); // playerId -> grace timer

  function clearTimer(id) {
    const t = timers.get(id);
    if (t) {
      clearTimeout(t);
      timers.delete(id);
    }
  }

  function startTimer(id) {
    clearTimer(id);
    const t = setTimeout(() => {
      timers.delete(id);
      if (!connections.get(id)) onTimeout(id);
    }, graceMs);
    t.unref?.();
    timers.set(id, t);
  }

  return {
    connected(id) {
      connections.set(id, (connections.get(id) || 0) + 1);
      clearTimer(id);
    },
    disconnected(id) {
      const n = (connections.get(id) || 1) - 1;
      if (n > 0) {
        connections.set(id, n);
        return;
      }
      connections.delete(id);
      startTimer(id);
    },
    // An active player who isn't connected (after a restart, or just registered/reactivated
    // and not yet connected) gets the same grace period.
    expectConnection(id) {
      if (!connections.get(id)) startTimer(id);
    },
    isConnected: (id) => Boolean(connections.get(id)),
    stop() {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    },
  };
}

module.exports = { createPresence, GRACE_MS };
