# Black or Yellow: notes for Claude Code

Classroom IoT carnival game on a Raspberry Pi 5: players bet fictional points on BLACK or
YELLOW, a 30 mm green ball drops onto a 4×4 board, a phone camera (IP Webcam) and OpenCV
decide the colour, winners get 2×. Start with `README.md`.

- Full requirements: `docs/black-or-yellow-spec.md` (125 settled decisions; later sections
  win; section 37 lists ideas that must never come back, e.g. Black vs Red, 4× payout).
- Owner decisions that override the spec: one tilt servo (not two), relay releases the
  ball, green ball, ArUco corner markers, colour-share rule with a 20-point lead, edge rule
  (no "off the board" result), 20 starting points.
- 3D-printed parts and physical sizes: `docs/hardware-design.md`. Keep `vision/board.json`
  in sync with any change to board, cell or ball size.
- The game runs on the Pi (`app/` Node.js server, `vision/` and `hardware/` Python). On a
  laptop, the server and tests run with `"hardware": "sim"` and `"vision": "sim"`.

The owner is new to Linux and the Pi: explain steps simply, one command at a time, and
say whether each command runs on the Pi or the laptop (Windows).
