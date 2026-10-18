#!/usr/bin/env python3
# Blower relay test: turns the relay on for N seconds, then off.
#   python3 ~/project/tools/relay.py 3
# Always switches off at the end, even after an error or Ctrl+C. Max 30 seconds.
import sys, time, json, lgpio
from pathlib import Path

PIN = 17          # header pin 11
MAX_SECONDS = 30
# Same setting as the game: "relayContacts" in config.json, "NO" (default) or "NC".
try:
    NC = json.load(open(Path(__file__).resolve().parent.parent / 'config.json')).get('relayContacts', 'NO').upper() == 'NC'
except Exception:
    NC = False
RUN, IDLE = (0, 1) if NC else (1, 0)

try:
    seconds = float(sys.argv[1]) if len(sys.argv) > 1 else 1
except ValueError:
    sys.exit("Usage: python3 ~/project/tools/relay.py SECONDS   (example: 3)")
if not 0 < seconds <= MAX_SECONDS:
    sys.exit(f"Seconds must be between 0 and {MAX_SECONDS}.")

h = lgpio.gpiochip_open(0)
try:
    lgpio.gpio_claim_output(h, PIN, IDLE)
    print(f"Device ON for {seconds:g} s ({'NC' if NC else 'NO'} wiring) ...", flush=True)
    lgpio.gpio_write(h, PIN, RUN)
    time.sleep(seconds)
except KeyboardInterrupt:
    print("\nStopped early.")
finally:
    lgpio.gpio_write(h, PIN, IDLE)
    if NC:
        print("Device OFF (relay stays switched to hold it off; it runs again when this tool exits).")
    else:
        lgpio.gpio_free(h, PIN)
        lgpio.gpio_claim_input(h, PIN, lgpio.SET_PULL_DOWN)
        lgpio.gpio_free(h, PIN)
        print("Device OFF.")
    lgpio.gpiochip_close(h)
