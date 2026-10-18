# Black or Yellow: server

Phase 2 (backend foundation): player sign-up, banker login, live updates, join QR code.
Phase 3 (points): starting points (default 20), top-ups, redemptions, banker approvals,
transaction log, 5-second player notices.
Phase 4 (rounds): betting, simulated ball drop/detection, settlement, refunds, STOP,
crash vs power-cut recovery, Leave Game. Plus demo resets (spec 31) and hotspot-loss
detection (spec 29.2). Camera (Phase 5) and servos (Phase 6) are still simulated.

## Auto-start (one time, needs a read-write reboot cycle)

    sudo pi-mode rw                                   # Pi reboots writable
    sudo bash ~/project/deploy/install-autostart.sh   # installs + starts the service
    sudo pi-mode ro                                   # Pi reboots protected

After that the game runs at boot on port 80 (`http://<pi-ip>/`), restarts itself if it
crashes, and `node`/`npm` work in any terminal. Useful commands:

    sudo systemctl status black-or-yellow     # is it running?
    sudo systemctl restart black-or-yellow    # after updating the code
    journalctl -u black-or-yellow -f          # live log (Ctrl+C to stop watching)

## Run it (on the Pi)

    source ~/project/env.sh      # once per terminal: puts node/npm on PATH
    cd ~/project/app
    npm run set-banker           # first time only: choose banker username + password
    npm start                    # Ctrl+C to stop

Then on a phone on the same Wi-Fi:
- Players: `http://<pi-ip>:3000/` (the address is printed when the server starts)
- Banker:  `http://<pi-ip>:3000/banker` (shows the QR code players scan)

    npm test                     # run all tests
    npm run check-wallets        # confirm every balance matches the transaction log

## Layout

| Path | Purpose |
|---|---|
| `src/server.js` | Entry point: opens the DB and starts the web server |
| `src/app.js` | HTTP routes and Socket.IO live updates |
| `src/db.js` | SQLite settings (WAL, synchronous=FULL) and migrations |
| `src/players.js` | Registration, nickname rules, 10-player limit, reactivation |
| `src/banker.js` | Banker account and login sessions |
| `src/presence.js` | Who is online; 2-minute disconnect grace period |
| `src/auth.js` | Password hashing (scrypt), session tokens, cookies |
| `src/wallet.js` | The only code that changes balances; writes the ledger; wallet check |
| `src/points.js` | Point Store requests, banker decisions, starting points |
| `src/rounds.js` | Round state machine, bets, settlement, STOP, crash/power-cut recovery |
| `src/sim.js` | Simulated trapdoor/servos/camera (until Phases 5-6) |
| `src/resets.js` | Demo reset modes with automatic backup |
| `src/game.js` | Game state (full state machine comes in Phase 4) |
| `src/network.js` | Pi's current IP, join QR code, hotspot-loss watcher |
| `public/` | Player page (`index.html`) and banker page (`banker.html`) |
| `scripts/set-banker.js` | Create or change the banker login |
| `scripts/check-wallets.js` | Read-only wallet consistency check |

Data lives in `/data/project/data/game.db`, outside this folder, so updating the code
never touches it. Settings: `PORT` (default 3000) and `DB_PATH` environment variables.
