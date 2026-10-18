# Black or Yellow: IoT carnival game

Classroom prototype: players bet virtual points on BLACK or YELLOW, a servo drops one ball
onto a 4×4 checkerboard, an overhead Android phone camera + OpenCV finds the cell, the
banker confirms, the server pays out, then servos tilt the board and a blower returns the
ball. Fictional points and prop money only; not real gambling.

**The full requirements spec is `docs/black-or-yellow-spec.md`. Read it in full before
designing, planning or changing any feature.** It records 125 decisions already made with
the owner: treat them as settled, don't restart requirements gathering, and when sections
conflict the later decision wins. Section 37 lists superseded ideas that must never come
back (e.g. Black vs Red, multiple balls, 4× payout, wallet maximums).

@docs/pi-environment.md

## Rules that override the spec (this Pi's actual setup)

The spec was written before the storage setup was finalized, so it says "~2.9 GB free".
Reality:

- The root filesystem is **read-only (overlayroot)**. Anything written outside `/data`
  disappears on reboot. `~/project` is a symlink to `/data/project`.
- Therefore **everything persistent goes under `/data/project`**: source code,
  `node_modules`, Python venv, the SQLite database, camera calibration, settings, and any
  logs you keep. The spec's persistence requirements (wallets, calibration surviving
  reboots, crash recovery) only hold if the data lives there. Never put the DB in /tmp,
  /var or the home directory outside `~/project`.
- `/data` has ~3 GB free and root has ~3.5 GB (only usable in writable mode). Check
  `df -h / /data` before installing anything and prefer the smallest option.
- System-level changes (apt packages such as nodejs or python3-opencv, the systemd unit
  for auto-start, config.txt overlays) need `sudo pi-mode rw` → change → `sudo pi-mode ro`.
  Each switch reboots and drops the owner's session, so batch these changes, tell the owner
  before doing it, and give them the exact commands.
- Logs: the system journal is in RAM in protected mode. If logs must survive a reboot, write
  small rotated files under `/data/project`.
- Power loss is now less dangerous for the OS but can still interrupt a SQLite write: use
  transactions (the spec requires them anyway) and WAL mode with `synchronous=FULL` for
  the wallet DB.

## Things to flag early (from the spec's open risks, plus this setup)

- **Hotspot capacity.** The spec needs up to 13 devices on one hotspot with client-to-client
  traffic (section 32). The owner's current test hotspot "Lan" hands out 172.20.10.x
  addresses, which is typical of an iPhone hotspot; iPhone hotspots usually cap out at a
  handful of devices. The spec calls for a dedicated **Android** hotspot. Test real
  capacity before building around it.
- **Servo control on Pi 5.** The Pi 5's GPIO goes through the RP1 chip; older libraries
  such as pigpio don't work on it. Prefer lgpio/gpiozero or the kernel PWM interface, and
  consider a PCA9685 I2C servo board with its own power supply for three servos. Never power
  servos or the blower from the Pi's pins (spec section 34). Confirm the hardware choice
  with the owner before writing driver code.
- **Pi address changes.** On a hotspot the Pi's IP can change, and the QR code must follow
  it (spec 32.4).

## How to work with the owner

Follow spec section 40 and the roadmap in section 41: start with the Phase 1 environment
audit, build software-only gameplay with a simulated ball before touching hardware, keep it
lightweight, and explain each module's purpose simply. Ask only when a missing decision
really blocks implementation.
