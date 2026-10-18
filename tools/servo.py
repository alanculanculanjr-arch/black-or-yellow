#!/usr/bin/env python3
# Servo test (SG-5010 on GPIO 18 = header pin 12). Power the servo from its own 5-6 V supply,
# with that supply's minus joined to a Pi GND pin.
#   python3 ~/project/tools/servo.py center      middle position
#   python3 ~/project/tools/servo.py 0           one end   (0-180)
#   python3 ~/project/tools/servo.py 180         other end
#   python3 ~/project/tools/servo.py sweep       slowly 0 -> 180 -> 0
#   python3 ~/project/tools/servo.py 1500us      raw pulse width (1000-2000 us)
# Holds the position for 2 seconds, then stops the signal (the servo goes limp).
# The range is kept to 1000-2000 us on purpose so the servo can't strain against its end stops.
import sys, time, lgpio

PIN = 18
MIN_US, MAX_US = 1000, 2000
HOLD = 2.0

def usage():
    sys.exit(__doc__ or "Usage: python3 ~/project/tools/servo.py center | 0-180 | sweep | 1500us")

arg = sys.argv[1] if len(sys.argv) > 1 else 'center'
h = lgpio.gpiochip_open(0)

def pulse(us):
    lgpio.tx_servo(h, PIN, int(us))

def angle_to_us(a):
    return MIN_US + (MAX_US - MIN_US) * a / 180

try:
    lgpio.gpio_claim_output(h, PIN, 0)
    if arg == 'center':
        print('Center (1500 us)'); pulse(1500); time.sleep(HOLD)
    elif arg == 'sweep':
        for a in list(range(0, 181, 5)) + list(range(180, -1, -5)):
            pulse(angle_to_us(a)); print(f'\r{a:3d}°', end='', flush=True); time.sleep(0.08)
        print()
    elif arg.endswith('us'):
        us = int(arg[:-2])
        if not MIN_US <= us <= MAX_US: sys.exit(f'Pulse must be {MIN_US}-{MAX_US} us.')
        print(f'{us} us'); pulse(us); time.sleep(HOLD)
    else:
        a = float(arg)
        if not 0 <= a <= 180: sys.exit('Angle must be 0-180.')
        print(f'{a:g}° ({angle_to_us(a):.0f} us)'); pulse(angle_to_us(a)); time.sleep(HOLD)
except ValueError:
    print('Usage: python3 ~/project/tools/servo.py center | 0-180 | sweep | 1500us')
except KeyboardInterrupt:
    print('\nStopped.')
finally:
    try:
        lgpio.tx_servo(h, PIN, 0)      # stop pulses (raises if none were running)
    except lgpio.error:
        pass
    lgpio.gpio_free(h, PIN)            # releasing the pin also ends any signal
    lgpio.gpio_claim_input(h, PIN, lgpio.SET_PULL_DOWN)
    lgpio.gpio_free(h, PIN)
    lgpio.gpiochip_close(h)
    print('Signal off.')
