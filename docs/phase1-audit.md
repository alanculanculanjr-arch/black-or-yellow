# Phase 1 audit: environment (2026-10-14)

Read-only audit of the Pi before writing any code (spec sections 38.2 and 41).

## What's there

| Item | Found | OK for the spec? |
|---|---|---|
| OS | Raspberry Pi OS Trixie (Debian 13), 64-bit, kernel 6.18 | Yes |
| Board | Pi 5 Model B rev 1.1, 8 GB (7 GB free), 50 °C, no throttling | Yes |
| Storage | `/data` 2.9 GB free (persistent); root is a read-only overlay | Yes, if everything goes in `/data/project` |
| SD card health | No EXT4 or I/O errors in `dmesg` | Yes |
| Node.js / npm | **Not installed** (apt only offers Node 20, which is already end-of-life) | **Needs install** |
| Python | 3.13.5, venv at `/data/project/venv` (uses system packages too) | Yes |
| OpenCV | `opencv-python-headless` 5.0.0 in the venv, FFMPEG video input = YES | Yes, can read phone streams |
| numpy, gpiozero, lgpio, smbus2, picamera2 | Installed (system packages, visible in venv) | Yes (lgpio/gpiozero work on Pi 5) |
| Build tools | gcc, g++, make, git, curl, ffmpeg present | Yes (fallback for native npm modules) |
| sqlite3 CLI | Missing | Optional, for inspecting the DB by hand |
| Internet | npm registry and nodejs.org reachable | Yes, for installs |

## Network

- Currently on Wi-Fi "Lan" (NetworkManager connection named `phone`), Pi IP `172.20.10.3/28`.
- `172.20.10.x/28` is an iPhone hotspot. A /28 network holds at most 13 devices besides the
  phone itself, and iPhones usually allow only ~5 Wi-Fi clients. **It can't be the game
  hotspot.** The spec requires a dedicated Android hotspot for 13 clients: still untested.
- Only SSH (port 22) is listening. Ports 80 and 3000 are free.

## Hardware interfaces

- GPIO: `/dev/gpiochip*` present, user `admin` is in the `gpio`, `i2c` and `spi` groups.
- Hardware PWM: RP1 PWM controller (`pwmchip0`, 4 channels) exists, but no overlay routes it
  to header pins yet.
- I2C on the header pins (`/dev/i2c-1`) is **off**. A PCA9685 servo board would need
  `dtparam=i2c_arm=on` in `/boot/firmware/config.txt` plus a reboot.
- `/boot/firmware` is mounted read-write (separate partition), so `config.txt` edits persist
  even in read-only mode.

## Can't test yet

- **Hotspot capacity and client-to-client traffic**: needs the real Android hotspot phone.
- **Camera stream**: needs the camera phone and an IP-camera app. Suggested: an offline
  Android app that serves MJPEG and single JPEG snapshots over HTTP (e.g. "IP Webcam").
  OpenCV's FFMPEG backend can read that.
- **Servo and blower drivers**: hardware not chosen yet (see below).

## What to install

| # | What | Where | Size | Needs `pi-mode rw`? | When |
|---|---|---|---|---|---|
| 1 | Node.js 24 LTS (official arm64 build) | `/data/project/.tools/node` | ~30 MB download, ~190 MB unpacked | No | Now (Phase 2) |
| 2 | npm packages: `express`, `socket.io`, `better-sqlite3`, `qrcode` | `/data/project/node_modules` | ~40 MB | No | Phase 2 |
| 3 | Add Node to `PATH` in `~/.bashrc` | home (overlay) | tiny | **Yes** | Batch into one rw session |
| 4 | `sqlite3` CLI (optional) | apt | <1 MB | **Yes** | Same rw session |
| 5 | systemd service for auto-start | `/etc/systemd/system` | tiny | **Yes** | Once the server runs |
| 6 | Enable I2C (if PCA9685) or PWM overlay | `config.txt` | none | No, but needs a reboot | Phase 6 |

Nothing new is needed for Python/OpenCV. Banker password hashing can use Node's built-in
`crypto.scrypt`, so no bcrypt package. Total new disk use is about 250 MB, leaving ~2.6 GB.

Why not `apt install nodejs`: it's Node 20 (end-of-life since April 2026), it needs a
read-write reboot cycle, and Debian's `npm` package pulls in hundreds of extra packages.
The official build lives on `/data`, survives reboots and needs no mode switch.

## Install log

- 2026-10-14: Node.js v24.21.0 (npm 11.19.0) installed to `/data/project/.tools/node`
  (symlink to the versioned folder), checksum verified. Use it with
  `source ~/project/env.sh`. Uses 204 MB; `/data` has 2.7 GB free.

## Servos: TowerPro SG-5010 (chosen 2026-10-14)

Standard-size analog servo, 4.8-6 V, 50 Hz PWM with ~1-2 ms pulses, roughly 1 A or more
each when stalled. Three of them (trapdoor + two tilt) need their own 5-6 V supply of at
least 3-5 A, grounded to the Pi's GND, never powered from the Pi's 5 V pin.

## Servo driver: no PCA9685 (decided 2026-10-14)

Servos will be driven straight from the Pi 5's GPIO pins (signal only; power still from a
separate 5-6 V supply). Plan: the RP1 hardware PWM channels (GPIO 12, 13, 18, 19) via a
device-tree overlay, which needs a `config.txt` change and a reboot. Verify on the bench
with one SG-5010 before relying on it. Fallback: lgpio software PWM, which may jitter.
Signal wires may need a 3.3 V to 5 V level shifter if a servo ignores 3.3 V pulses.

Still open (blocks Phase 6 only): blower switch, e.g. a logic-level MOSFET module or relay
with a flyback diode.

## Camera stream test (2026-10-14)

IP Webcam (Android) on the "Lan" hotspot at `http://172.20.10.4:8080`, default settings:

| Method | Result |
|---|---|
| `/shot.jpg` single snapshot | Works: 1920×1080, ~200 KB, ~0.1 s each, 6.5/s when polled |
| `/video` MJPEG via `cv2.VideoCapture(url, cv2.CAP_FFMPEG)` | Works: 1920×1080 at ~14 fps, one 0.8 s Wi-Fi stall in 8 s |
| `/photo.jpg` full-sensor photo | Works but ~1 MB and 1.3 s: not needed |
| Pi CPU while streaming | ~2% |

At 1080p the stream uses roughly 20+ Mbit/s, too much for a hotspot shared with 12 other
devices. Plan: set the app to 640×480 (or 1280×720 if the ball is too small), keep ~10-15 fps,
use `/video` for motion/stationary detection and keep the last frame as the snapshot.
The phone's IP must be configurable (it can change like the Pi's).

## Blower relay test (2026-10-14)

1-channel relay module wired: VCC → pin 4 (5 V), GND → pin 6, IN → pin 11 (**GPIO 17**).
Input reads LOW when floating, so it behaves as **high-trigger** (HIGH = on), which works with
the Pi's 3.3 V signal. Test: GPIO 17 HIGH for 1 s then LOW via lgpio: relay clicked on/off.
GPIO 17 = blower relay. Default and safe state: LOW (blower off).

## Servo tests and change: one tilt servo (2026-10-14)

- SG-5010 on GPIO 18 (pin 12), separate supply, ground to Pi pin 39: center and sweep worked;
  Pi power stayed at 5.11-5.13 V with no under-voltage. Test tools: `~/project/tools/servo.py`
  (terminal) and `servo_thonny.py` (Thonny). Range kept to 1.0-2.0 ms (~90° of travel).
- Tried two tilt servos together (second on GPIO 22, pin 15): they did not line up and the
  test did not work. **Owner decided to use one tilt servo instead of two** (changes spec 5.1).
  Software will drive the tilt as a single servo; the trapdoor stays a separate servo.
