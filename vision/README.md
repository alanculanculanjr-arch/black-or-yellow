# Vision: finding the ball

The camera is an Android phone running the **IP Webcam** app. These scripts grab pictures
from it (`http://<phone>:8080/shot.jpg`), find the board and the green ball, and decide
BLACK or YELLOW. How and why is explained in
[`../docs/adr/ADR-001-ball-cell-detection.md`](../docs/adr/ADR-001-ball-cell-detection.md).

| File | Purpose |
|---|---|
| `detector.py` | The detection rules, shared by the game and the live checker |
| `worker.py` | Runs inside the game: waits for the ball to stay still, then reports the result |
| `camfind.py` | Finds the phone on the network if its address changes, and saves it to `config.json` |
| `live_check.py` | Live view for setting up the board (web page or `--text` in the terminal) |
| `board.json` | Board measurements in mm, black cells, ball colour limits, the 20-point rule |
| `layout.json` | Which marker is in which corner (learned the first time all 4 are seen) |
| `board_check.py`, `angled_test.py`, `diff_test*.py` | Earlier experiments, kept for reference |

Check the camera live:

    venv/bin/python vision/live_check.py <phone-address>:8080 --text

Find the camera and save its address:

    venv/bin/python vision/camfind.py
