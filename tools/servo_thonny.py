# Servo test for Thonny: open this file in Thonny and press the green Run button.
# SG-5010 signal (orange) on GPIO 18 = pin 12. Servo powered by its own supply,
# with that supply's minus joined to a Pi GND pin.
#
# Edit the list under "MOVES" to try your own positions. Press the red Stop button
# any time; the servo goes limp at the end either way.

from gpiozero import AngularServo
from time import sleep

servo = AngularServo(
    18,
    min_angle=0, max_angle=180,
    min_pulse_width=0.0010,   # 1.0 ms = angle 0   (safe range; we can widen it later)
    max_pulse_width=0.0020,   # 2.0 ms = angle 180
)

# ---- MOVES: (angle, seconds to wait there) --------------------------------
MOVES = [
    (0, 3),

]
# -----------------------------------------------------------------------------

try:
    for angle, wait in MOVES:
        print(f"Going to {angle} degrees")
        servo.angle = angle
        sleep(wait)
finally:
    servo.detach()   # stop the signal: servo goes limp
    servo.close()
    print("Done, signal off.")
