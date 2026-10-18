# Two tilt servos moving together. Open in Thonny and press Run (or: python3 this_file.py).
#
# Wiring (both servos powered by the separate supply, its minus joined to a Pi GND pin):
#   Servo A orange -> GPIO 18 (pin 12)      Servo B orange -> GPIO 22 (pin 15)
#
# STEP 1  Line them up: set ALIGN_ONLY = True and press Run. Both go to the middle (90) and
#         hold for 5 s. Look at the horns. If B sits a little further one way than A, change
#         TRIM_B (e.g. 5 or -5) and run again until they match. If they are off by a lot,
#         first pull the horn off and push it back on one tooth closer, then fine-tune here.
# STEP 2  Set ALIGN_ONLY = False and press Run to do the MOVES together.
# If B turns the opposite way to A (servos mounted facing each other), set REVERSE_B = True.

from gpiozero import AngularServo
from time import sleep

ALIGN_ONLY = False     # True = both to 90 and hold, to compare the horns

PIN_A, PIN_B = 18, 22
TRIM_A = 0             # degrees added to servo A (usually leave at 0)
TRIM_B = 0             # degrees added to servo B, to line it up with A
REVERSE_B = False      # True if B moves the opposite way to A

# ---- MOVES: (angle, seconds to wait there). Both servos do the same thing. --
MOVES = [
    (0, 2),     # both to 0, hold 2 s: compare the horns
    (90, 2),    # move together to 90, hold 2 s: compare again
]
SPEED = 60     # degrees per second; lower = slower, smoother, more in step
# -----------------------------------------------------------------------------

def make(pin):
    return AngularServo(pin, min_angle=0, max_angle=180,
                        min_pulse_width=0.0010, max_pulse_width=0.0020)

def clamp(a):
    return max(0, min(180, a))

def target_b(angle):
    return clamp((180 - angle if REVERSE_B else angle) + TRIM_B)

servo_a, servo_b = make(PIN_A), make(PIN_B)
current = None

def set_both(angle):
    servo_a.angle = clamp(angle + TRIM_A)
    servo_b.angle = target_b(angle)

def move_both(angle):
    """Move both in small steps at the same time, so neither gets ahead."""
    global current
    if current is None:          # first move: we don't know where they are, go straight there
        set_both(angle)
        current = angle
        sleep(0.5)
        return
    step = 2 if angle > current else -2
    for a in range(int(current), int(angle), step):
        set_both(a)
        sleep(abs(step) / SPEED)
    set_both(angle)
    current = angle

try:
    if ALIGN_ONLY:
        print(f"Both to 90 (A={clamp(90 + TRIM_A)}, B={target_b(90)}). Compare the horns...")
        set_both(90)
        sleep(5)
    else:
        for angle, wait in MOVES:
            print(f"Both to {angle} degrees")
            move_both(angle)
            sleep(wait)
finally:
    for s in (servo_a, servo_b):
        s.detach()
        s.close()
    print("Done, signals off.")
