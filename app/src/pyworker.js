// Runs a long-lived Python helper (vision worker, hardware helper) and talks to it with one
// JSON message per line. Each request gets an id; the matching reply resolves its promise.
// If the helper crashes it is restarted, and anything still waiting gets an error.

const { spawn } = require('child_process');
const readline = require('readline');

function createPyWorker({ name, python, script, args = [], log = () => {}, onEvent = () => {}, restartMs = 2000 }) {
  let proc = null;
  let nextId = 1;
  let stopping = false;
  const pending = new Map();

  function failAll(err) {
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(err);
    }
    pending.clear();
  }

  function start() {
    if (proc) return;
    stopping = false;
    proc = spawn(python, ['-u', script, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    readline.createInterface({ input: proc.stdout }).on('line', (line) => {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        log(`[${name}] ${line}`);
        return;
      }
      if (msg.id != null && pending.has(msg.id)) {
        const { resolve, reject, timer } = pending.get(msg.id);
        pending.delete(msg.id);
        clearTimeout(timer);
        if (msg.ok) resolve(msg);
        else reject(new Error(msg.error || `${name} failed`));
      } else if (msg.event) {
        onEvent(msg);
      }
    });
    readline.createInterface({ input: proc.stderr }).on('line', (line) => log(`[${name}] ${line}`));
    proc.on('exit', (code, signal) => {
      proc = null;
      failAll(new Error(`${name} stopped (${signal || code})`));
      if (!stopping) {
        log(`[${name}] stopped unexpectedly (${signal || code}); restarting`);
        setTimeout(start, restartMs).unref();
      }
    });
    proc.on('error', (e) => log(`[${name}] could not start: ${e.message}`));
  }

  function call(cmd, params = {}, timeoutMs = 15000) {
    start();
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${name}: no answer to ${cmd} within ${timeoutMs / 1000}s`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      proc.stdin.write(JSON.stringify({ id, cmd, ...params }) + '\n');
    });
  }

  function stop() {
    stopping = true;
    if (proc) proc.kill('SIGTERM');
  }

  return { start, call, stop };
}

module.exports = { createPyWorker };
