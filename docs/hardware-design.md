# Hardware design notes (for 3D-printed parts)

Measurements and decisions for the physical build, so new parts (designed in Fusion 360
and 3D printed) fit what already exists. Measured values are marked; anything still open
is under "Not decided yet".

## What exists now

| Part | Details |
|---|---|
| Playing board | 4×4 cells, painted black and yellow, wooden sticks as dividers |
| Ball | 30 mm diameter, painted green (the camera finds it by colour) |
| Camera | Android phone running IP Webcam, looking at the board **at an angle** (not straight down) |
| Ball release | Relay on GPIO 17 (pin 11), switched on for 3 s to drop the ball |
| Board tilt | One SG-5010 servo on GPIO 18 (pin 12), tilts to 70°, holds 3 s, back to 0° |
| Controller | Raspberry Pi 5 (8 GB) |

The original spec planned a trapdoor servo, two tilt servos and a blower. The build now
uses the relay for release and **one** tilt servo; a blower is not fitted yet.

## Board dimensions (measured)

| Item | Size |
|---|---|
| Cell | 45.0 × 45.0 mm |
| Divider stick | 3.1 mm wide |
| Playing area (4 cells + 3 dividers) | 189.3 × 189.3 mm |
| Ball | 30 mm diameter |
| Black cells (numbered left to right, top to bottom) | 1, 3, 6, 8, 9, 11, 14, 16 (cell 1 is top-left) |

The same numbers are in [`vision/board.json`](../vision/board.json), which the camera code
uses. **If a printed board changes any of these, update `board.json` too.**

## ArUco markers (camera reference)

- One printed marker in each corner cell (cells 1, 4, 13, 16), in the corner of the cell.
- Marker paper 22.5 × 22.5 mm, black pattern 18.5 × 18.5 mm (DICT_4X4_50).
- Printable sheet: [`board-markers-2.25cm-shortbond.pdf`](board-markers-2.25cm-shortbond.pdf).
- Printed parts must not cover the markers or cast a shadow over them. The camera needs
  at least 2 of the 4 visible.

## Camera position

- The camera must look down on the board at **20° or more** above the board surface, and
  be **at least 8 cm** above it. Below that, the software rejects the board position.
- The whole playing area plus a few cm around it must be in view.
- A rigid phone holder matters: if the phone moves during a round, detection restarts.
- A matte, non-green surface around the board avoids false "ball" detections.

## Servo: SG-5010

Standard-size hobby servo. Typical datasheet size about 40 × 20 × 38 mm body with mounting
ears about 54 mm across; **measure your servo with calipers before designing a mount**,
since clones vary.
- Signal on GPIO 18, ground shared with the Pi (pin 39), power from a **separate 5 V supply**.
- Software uses pulses of 1000–2000 µs (0–180° in the code, about 90° of real travel).
- Tilt angle (70°), hold time (3 s) and level angle (0°) are in `config.json`.

## Rules for printed parts

- Ball paths (chute, release, return ramp): at least **33–34 mm** clear width for the
  30 mm ball, and smooth inside.
- Holes for screws and shafts: add 0.2–0.3 mm clearance for printer tolerance.
- Don't print anything in **green** that the camera can see; green is reserved for the ball.
  Black, grey or white are safe.
- Yellow and black cells should stay matte. Shiny surfaces create glare spots.
- Relay wiring may carry 220 V: printed enclosures for it must fully cover the terminals.

## Not decided yet

- What exactly the relay drives to release the ball (record it here once fixed).
- Ball return path after the tilt (blower or ramp).
- Hinge position and tilt direction of the board.
- Phone holder height and angle (record the final values here once fixed).
