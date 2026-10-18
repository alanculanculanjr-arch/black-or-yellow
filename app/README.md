# Black or Yellow: server

The game server: player sign-up, banker login, live updates, join QR code, points
(starting points, top-ups, redemptions), rounds (betting, ball drop, detection,
settlement, refunds, STOP, crash and power-cut recovery), Leave Game, demo resets and
hotspot-loss detection. The relay, servo and camera are real or simulated depending on
`config.json` in the project folder.

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
| `src/sim.js` | Simulated relay, servo and camera (when config says "sim") |
| `src/real.js` | Real relay, servo and camera, through the Python helpers |
| `src/pyworker.js` | Starts a Python helper and talks to it in JSON lines; restarts it if it crashes |
| `src/resets.js` | Demo reset modes with automatic backup |
| `src/game.js` | Game state |
| `src/network.js` | Pi's current IP, join QR code, hotspot-loss watcher |
| `public/` | Player page (`index.html`) and banker page (`banker.html`) |
| `scripts/set-banker.js` | Create or change the banker login |
| `scripts/check-wallets.js` | Read-only wallet consistency check |

Data lives in `data/game.db` in the project folder (outside `app/`), so updating the code
never touches it. Settings: `PORT` (default 3000) and `DB_PATH` environment variables.
