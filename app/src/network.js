// The Pi's current address on the hotspot, and the QR code players scan (spec 32.4).
// The address is looked up on every request because it can change after reconnecting.

const os = require('os');
const QRCode = require('qrcode');

function currentAddress() {
  const ifaces = os.networkInterfaces();
  const order = ['wlan0', 'eth0', ...Object.keys(ifaces)];
  for (const name of order) {
    for (const a of ifaces[name] || []) {
      if (a.family === 'IPv4' && !a.internal) return a.address;
    }
  }
  return null;
}

function joinUrl(port) {
  const ip = currentAddress();
  if (!ip) return null;
  return port === 80 ? `http://${ip}/` : `http://${ip}:${port}/`;
}

async function joinQrSvg(port) {
  const url = joinUrl(port);
  if (!url) return { url: null, svg: null };
  const svg = await QRCode.toString(url, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' });
  return { url, svg };
}

// Hotspot watcher (spec 29.2). A phone hotspot switching off doesn't crash the server, so
// it has to be noticed on purpose: if the Pi has no network address for graceMs in a row,
// onLost() runs once; onBack() runs when an address returns. Short Wi-Fi blips are ignored.
function watchNetwork({ onLost, onBack, intervalMs = 3000, graceMs = 10000, address = currentAddress }) {
  let lostSince = null;
  let lost = false;
  const timer = setInterval(() => {
    const ip = address();
    if (ip) {
      lostSince = null;
      if (lost) {
        lost = false;
        onBack?.(ip);
      }
      return;
    }
    lostSince ??= Date.now();
    if (!lost && Date.now() - lostSince >= graceMs) {
      lost = true;
      onLost();
    }
  }, intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer), isLost: () => lost };
}

module.exports = { currentAddress, joinUrl, joinQrSvg, watchNetwork };
