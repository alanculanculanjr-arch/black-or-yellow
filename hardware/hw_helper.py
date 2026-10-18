#!/usr/bin/env python3
# Hardware helper for the game server: the ONLY program that drives the relay and the servo
# while the game runs. Started and owned by Node (src/hardware-real.js). JSON, one per line:
#   {"id": 1, "cmd": "relay_pulse", "seconds": 3}   relay ON, then OFF after N s (reply when done)
#   {"id": 2, "cmd": "servo", "angle": 70}          move the servo (0-180 -> 1.0-2.0 ms pulses)
#   {"id": 3, "cmd": "servo_release"}               stop the servo signal (servo goes limp)
#   {"id": 4, "cmd": "all_off"}                     STOP: relay off now, servo back to 0 and released
#   {"id": 5, "cmd": "ping"}
# Safety (spec 34.4): relay forced OFF at start, on all_off, on any error and on exit. The servo
# isn't touched until the first servo command. A relay pulse is capped at 10 s.
import sys, json, time, threading, signal
from pathlib import Path
import lgpio

RELAY_PIN, SERVO_PIN = 17, 18           # header pins 11 and 12 (bench-tested 2026-10-14)
# Relay contacts the device is wired to (config.json "relayContacts"):
#   "NO" (normally open):   device runs while the relay is switched ON  -> idle = pin LOW (safe if the Pi is off)
#   "NC" (normally closed): device runs while the relay is switched OFF -> idle = pin HIGH, run = LOW
#        (NOTE: with NC the device also runs whenever the Pi is off or this helper isn't running)
try:
    RELAY_NC = json.load(open(Path(__file__).resolve().parent.parent / 'config.json')).get('relayContacts', 'NO').upper() == 'NC'
except Exception:
    RELAY_NC = False
RUN_LEVEL, IDLE_LEVEL = (0, 1) if RELAY_NC else (1, 0)
MIN_US, MAX_US = 1000, 2000             # same range as tools/servo.py, about 90 degrees of real travel
MAX_PULSE_S = 10
_out = threading.Lock()
_gpio = threading.Lock()
h = lgpio.gpiochip_open(0)
servo_claimed = False
pulse = {'timer': None, 'id': None}


def send(msg):
    with _out:
        sys.stdout.write(json.dumps(msg) + '\n')
        sys.stdout.flush()


def relay(on):
    """on=True: the DEVICE runs (whichever relay contacts it is wired to)."""
    with _gpio:
        lgpio.gpio_write(h, RELAY_PIN, RUN_LEVEL if on else IDLE_LEVEL)


def servo(angle):
    global servo_claimed
    angle = max(0.0, min(180.0, float(angle)))
    with _gpio:
        if not servo_claimed:
            lgpio.gpio_claim_output(h, SERVO_PIN, 0)
            servo_claimed = True
        lgpio.tx_servo(h, SERVO_PIN, int(MIN_US + (MAX_US - MIN_US) * angle / 180))
    return angle


def servo_release():
    global servo_claimed
    with _gpio:
        if servo_claimed:
            try:
                lgpio.tx_servo(h, SERVO_PIN, 0)
            except lgpio.error:
                pass
            lgpio.gpio_free(h, SERVO_PIN)
            servo_claimed = False


def end_pulse(stopped=False):
    t, mid = pulse['timer'], pulse['id']
    if t:
        t.cancel()
    relay(False)
    pulse.update(timer=None, id=None)
    if mid is not None:
        send({'id': mid, 'ok': not stopped, **({'error': 'stopped'} if stopped else {})})


def safe_exit(*_):
    try:
        relay(False)
        servo_release()
    finally:
        lgpio.gpiochip_close(h)
    sys.exit(0)


def main():
    lgpio.gpio_claim_output(h, RELAY_PIN, IDLE_LEVEL)  # device OFF from the very start
    signal.signal(signal.SIGTERM, safe_exit)
    signal.signal(signal.SIGINT, safe_exit)            # Ctrl+C in the server's terminal reaches us too
    send({'event': 'ready', 'relay': 'NC' if RELAY_NC else 'NO'})
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            continue
        mid, cmd = msg.get('id'), msg.get('cmd')
        try:
            if cmd == 'ping':
                send({'id': mid, 'ok': True})
            elif cmd == 'relay_pulse':
                secs = float(msg.get('seconds', 1))
                if not 0 < secs <= MAX_PULSE_S:
                    send({'id': mid, 'ok': False, 'error': f'seconds must be 0-{MAX_PULSE_S}'})
                    continue
                if pulse['timer']:
                    end_pulse(stopped=True)
                relay(True)
                pulse['id'] = mid
                pulse['timer'] = threading.Timer(secs, end_pulse)
                pulse['timer'].start()               # reply is sent when the pulse ends
            elif cmd == 'servo':
                send({'id': mid, 'ok': True, 'angle': servo(msg.get('angle', 0))})
            elif cmd == 'servo_release':
                servo_release()
                send({'id': mid, 'ok': True})
            elif cmd == 'all_off':
                end_pulse(stopped=True)
                servo(0)
                time.sleep(0.6)
                servo_release()
                send({'id': mid, 'ok': True})
            else:
                send({'id': mid, 'ok': False, 'error': f'unknown command {cmd}'})
        except Exception as e:
            relay(False)
            send({'id': mid, 'ok': False, 'error': f'{type(e).__name__}: {e}'[:300]})
    safe_exit()                                      # Node went away: everything off


if __name__ == '__main__':
    main()
