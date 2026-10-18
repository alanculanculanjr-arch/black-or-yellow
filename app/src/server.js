// Entry point: `npm start`. Opens the database and starts the web server.
//
// Settings come from environment variables so the systemd service can set them later:
//   PORT     web port (default 3000)
//   DB_PATH  database file (default /data/project/data/game.db, outside the app folder
//            so a new release never replaces the data)

const fs = require('fs');
const path = require('path');
const { openDatabase } = require('./db');
const { createApp } = require('./app');
const { joinUrl } = require('./network');
const { createSimHardware, createSimVision } = require('./sim');
const { createRealHardware, createRealVision } = require('./real');

const PORT = Number(process.env.PORT || 3000);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'game.db');

// Settings: /data/project/config.json ("real" or "sim" for hardware and vision, camera address,
// drop/tilt timings). Missing file or keys fall back to the simulation defaults below.
const CONFIG_PATH = process.env.CONFIG_PATH || path.resolve(__dirname, '..', '..', 'config.json');
const cfg = {
  hardware: 'sim', vision: 'sim', camera: '192.168.137.123:8080',
  dropRelaySeconds: 3, tiltAngle: 70, tiltHoldSeconds: 3, levelAngle: 0, detectTimeoutSeconds: 10,
  ...(fs.existsSync(CONFIG_PATH) ? JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) : {}),
};
const hardware = cfg.hardware === 'real' ? createRealHardware({ cfg, log: console.log }) : createSimHardware({ log: console.log });
const vision = cfg.vision === 'real' ? createRealVision({ cfg, log: console.log }) : createSimVision();
console.log(`Hardware: ${cfg.hardware}. Camera: ${cfg.vision === 'real' ? cfg.camera : 'simulated'}.`);

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = openDatabase(DB_PATH);
const { server, close, banker } = createApp({
  db, port: PORT, backupDir: path.join(path.dirname(DB_PATH), 'backups'), hardware, vision,
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Black or Yellow running. Database: ${DB_PATH}`);
  console.log(`Players: ${joinUrl(PORT) || `http://<pi-address>:${PORT}/`}`);
  console.log(`Banker:  ${(joinUrl(PORT) || `http://<pi-address>:${PORT}/`)}banker`);
  if (!banker.exists()) console.log('No banker account yet. Run: npm run set-banker');
});

function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  close();
  hardware.stopAll();
  setTimeout(() => {            // give the hardware helper a moment to switch everything off
    hardware.close?.();
    vision.close?.();
    db.close();
    process.exit(0);
  }, 800);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
