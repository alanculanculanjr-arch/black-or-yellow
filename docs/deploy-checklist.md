# Deploy Checklist: Black or Yellow on pi5

**Date:** ____________ | **Deployer:** ____________ | **Release:** ____________

Use this every time a new version goes onto the Pi, including small fixes. "Deploy" here means
copying a new release to `/data/project`, restarting the service and checking the game works.
There's no CI or staging server: the **simulated-ball mode** is staging and the **real board**
is production.

## Pre-Deploy (before touching the Pi)

### Code and tests
- [ ] All tests pass on the Pi: `source ~/project/env.sh && npm test`
- [ ] Money tests pass: double-click APPROVE credits once, duplicate bet is rejected, settle twice pays once, cancel refunds once (spec 24)
- [ ] Wallet check passes: `npm run check-wallets` prints OK
- [ ] Nothing from spec section 37 has come back (Black vs Red, 4× payout, wallet limits, multiple balls)
- [ ] Another person (or Claude `/code-review`) has looked at any change touching wallets, bets or settlement

### Database
- [ ] Back up the DB **before** anything else: `cp` is unsafe while running, so use the app's backup command or `sqlite3 game.db ".backup backups/game-YYYYMMDD-HHMM.db"`
- [ ] Backup file opens and shows the right player count
- [ ] Migrations tested on a **copy** of the real DB, never recreated from scratch (spec 38.7)
- [ ] WAL mode and `synchronous=FULL` still set

### Pi health
- [ ] `pi-mode status` says READ-ONLY (unless this deploy needs a system change, see below)
- [ ] `df -h /data` shows at least 500 MB free
- [ ] `dmesg | grep -i "EXT4-fs error"` shows nothing. **If it does, stop and don't deploy.**
- [ ] `vcgencmd get_throttled` shows `0x0` (power supply OK)

### System changes (only if this release needs them)
- [ ] All system changes batched into **one** read-write session: systemd unit, `PATH` in `~/.bashrc`, apt packages, `config.txt` overlays
- [ ] Owner told beforehand that `sudo pi-mode rw` and `sudo pi-mode ro` each reboot and drop the Connect/SSH session
- [ ] Exact commands written down before starting

### Rollback plan
- [ ] Copy of the working code kept: `rsync -a --delete ~/project/app/ ~/project/app-previous/`
- [ ] DB backup from above noted here: ______________________
- [ ] No game in progress: game is IDLE, no players mid-round, no pending point requests

## Deploy

### 1. Software only (servo and blower power OFF)
- [ ] **Physical emergency cutoff switched OFF** for servos and blower
- [ ] Update the code in `~/project/app`, run `npm ci --omit=dev` if `package.json` changed
- [ ] Restart: `sudo systemctl restart black-or-yellow`
- [ ] `systemctl status black-or-yellow` shows active, not restarting in a loop
- [ ] Startup recovery ran: any unfinished round was cancelled and refunded exactly once (spec 29.3)
- [ ] Banker had to log in again (old banker session invalidated)

### 2. Smoke test in simulated-ball mode
- [ ] QR code shows the Pi's **current** IP (`ip -4 -br addr show wlan0`)
- [ ] Register a test player on a phone, receives the configured starting points
- [ ] Full round: start → bet 5 → close → drop (simulated) → provisional result → confirm → payout correct (2× stake)
- [ ] Cancel-round path refunds the bet once
- [ ] Top-up request → banker approves → wallet updates live, 5-second notice appears
- [ ] Reload the player page: same account, not a new one

### 3. Hardware (power ON)
- [ ] Servo supply is separate 5-6 V, at least 3-5 A for three SG-5010s, ground tied to Pi GND, **nothing powered from the Pi's 5 V pin**
- [ ] Turn on servo/blower power: **nothing moves** at startup (spec 34.4)
- [ ] Maintenance Mode: each SG-5010 moves to its limits only, no buzzing or straining at the ends (if it buzzes, narrow the pulse range)
- [ ] Blower on/off from Maintenance Mode, stops on its time limit
- [ ] STOP button halts actuators; physical cutoff also stops them
- [ ] Camera phone stream reachable; calibration still loaded (not reset by the deploy)
- [ ] Banker presses CONFIRM SYSTEM READY

### 4. Live check
- [ ] One real round with a test player: real drop → detection within 10 s → snapshot → confirm → recovery → CONFIRM READY
- [ ] Watch logs for 15 minutes or 3 rounds, whichever is longer: `journalctl -u black-or-yellow -f`

## Post-Deploy
- [ ] Wallet check still passes (balances = ledger sums)
- [ ] `df -h /data` not noticeably lower (no snapshot or log build-up)
- [ ] Note the version, date and anything odd in `docs/changelog.md`
- [ ] Tell the group/banker it's ready
- [ ] `npm run check-wallets` still prints OK

## Rollback Triggers (decide now, not during the demo)

Roll back immediately to the previous release and restore the DB backup if any of these happen:
- **Any wallet balance doesn't match its ledger**, or any duplicate credit/debit/refund
- A payout isn't exactly 2× the stake
- Service restarts more than twice in 10 minutes
- Any servo or the blower moves without a banker command, especially at startup
- Player registration, betting or the banker dashboard fails for any phone
- 3 detection timeouts in a row on drops that a person can see landed clearly
- `/data` free space drops below 300 MB, or any `EXT4-fs error` appears (stop and check the SD card first)

Rollback steps: switch power cutoff OFF → `sudo systemctl stop black-or-yellow` → put `app-previous` back as `app` → restore the DB backup from `~/project/data/backups/` (only if the bad version wrote bad data; a newer database version is refused by older code) → `sudo systemctl start black-or-yellow` → rerun the smoke test.
