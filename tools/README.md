# Tools: testing parts by hand

Stop the game first (`sudo systemctl stop black-or-yellow`), because only one program can
use a GPIO pin at a time. Start it again afterwards with `sudo systemctl start black-or-yellow`.

| Script | What it does | Example |
|---|---|---|
| `relay.py` | Switches the relay on for a number of seconds | `venv/bin/python tools/relay.py 3` |
| `servo.py` | Moves the servo to an angle | `venv/bin/python tools/servo.py 70` |
| `camera_check.py` | Shows what the camera sees of the board and ball | `venv/bin/python tools/camera_check.py <phone>:8080` |
| `servo_thonny.py`, `two_servos_thonny.py` | Servo examples to open and run in Thonny | |
