#!/usr/bin/env python3
# Vision worker for the game server (spec 33.5: one persistent process, not one per frame).
# Started and owned by Node (src/vision-real.js). Talks JSON, one message per line:
#   in : {"id": 7, "cmd": "detect", "timeout": 10, "still": 2}
#   out: {"id": 7, "ok": true, "status": "OK", "cell": 6, "colour": "BLACK", "shares": "...", "snapshot": "<base64 jpg>"}
# status is OK | INVALID (too close to call) | TIMEOUT | CAMERA_LOST.
# Other commands: {"cmd": "check"} = one picture, report markers/ball; {"cmd": "ping"}.
# Usage: python worker.py CAMERA_ADDR      (e.g. 192.168.137.123:8080)
import sys, json, time, base64, threading, urllib.request
import cv2, numpy as np
import detector, camfind

CAM = sys.argv[1] if len(sys.argv) > 1 else '192.168.137.123:8080'
CAMERA_LOST_S = 3.0       # no picture for this long = camera lost (spec 29.1)
_out = threading.Lock()


def send(msg):
    with _out:
        sys.stdout.write(json.dumps(msg) + '\n')
        sys.stdout.flush()


def relocate():
    """The camera isn't at its saved address: look for it on the network and switch to it."""
    global CAM
    found = camfind.find_camera()
    if found and found != CAM:
        CAM = found
        camfind.save_camera(found)
        send({'event': 'camera_moved', 'camera': found})
        return True
    return False


def grab(allow_search=False):
    try:
        data = urllib.request.urlopen(f'http://{CAM}/shot.jpg', timeout=2).read()
    except Exception:
        if not (allow_search and relocate()):
            raise
        data = urllib.request.urlopen(f'http://{CAM}/shot.jpg', timeout=2).read()
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise RuntimeError('camera sent an unreadable picture')
    return img


def snapshot(vis, text):
    """Annotated final picture for the banker (kept in memory by Node only, spec 6.5)."""
    h, w = vis.shape[:2]
    if w > 960:
        vis = cv2.resize(vis, (960, int(h * 960 / w)))
    cv2.rectangle(vis, (0, 0), (vis.shape[1], 34), (0, 0, 0), -1)
    cv2.putText(vis, text, (8, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
    return base64.b64encode(cv2.imencode('.jpg', vis, [cv2.IMWRITE_JPEG_QUALITY, 75])[1].tobytes()).decode()


def detect(timeout, still_s):
    try:
        grab(allow_search=True)               # camera moved since last time? find it before the clock starts
    except Exception:
        pass
    start = last_ok = time.time()
    tracker = detector.StillTracker(seconds=still_s)
    last_vis, last_info = None, {}
    while True:
        now = time.time()
        if now - start > timeout:
            text = f'TIMEOUT after {timeout:g}s: {last_info.get("result", "no picture")}'
            return {'status': 'TIMEOUT', 'last': last_info.get('result'),
                    'snapshot': snapshot(last_vis, text) if last_vis is not None else None}
        try:
            img = grab()
            last_ok = now
        except Exception as e:
            if time.time() - last_ok > CAMERA_LOST_S:
                return {'status': 'CAMERA_LOST', 'error': str(e)[:200]}
            time.sleep(0.2)
            continue
        vis, info = detector.find_ball(img)
        last_vis, last_info = vis, info
        if 'P' not in info:                     # no ball / board not found: stillness starts over
            tracker.reset()
            continue
        if tracker.add(info['P']):
            base = {'cell': info['cell'], 'shares': info['shares'], 'share_win': info['share_win'],
                    'share_lose': info['share_lose'], 'markers': info['markers'], 'edge': bool(info.get('edge'))}
            if info['ok']:
                return {'status': 'OK', 'colour': info['result'], **base,
                        'snapshot': snapshot(vis, f'{info["result"]} (cell {info["cell"]}) {info["shares"]}')}
            return {'status': 'INVALID', 'reason': info.get('detail'), **base,
                    'snapshot': snapshot(vis, f'INVALID: {info["shares"]} (on a stick or corner)')}


def check():
    try:
        img = grab(allow_search=True)
    except Exception as e:
        return {'status': 'CAMERA_LOST', 'error': str(e)[:200]}
    _, info = detector.find_ball(img, draw=False)
    return {'status': 'OK', 'camera': CAM, **{k: v for k, v in info.items() if k != 'P'}}


def main():
    if not camfind.is_camera(CAM):            # at startup: find the camera if its address changed
        relocate()
    send({'event': 'ready', 'camera': CAM})
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            send({'ok': False, 'error': 'bad JSON'})
            continue
        mid, cmd = msg.get('id'), msg.get('cmd')
        try:
            if cmd == 'ping':
                send({'id': mid, 'ok': True})
            elif cmd == 'detect':
                send({'id': mid, 'ok': True, **detect(float(msg.get('timeout', 10)), float(msg.get('still', 2)))})
            elif cmd == 'check':
                send({'id': mid, 'ok': True, **check()})
            else:
                send({'id': mid, 'ok': False, 'error': f'unknown command {cmd}'})
        except Exception as e:
            send({'id': mid, 'ok': False, 'error': f'{type(e).__name__}: {e}'[:300]})


if __name__ == '__main__':
    import signal
    signal.signal(signal.SIGINT, signal.SIG_IGN)       # Ctrl+C is handled by Node, which then stops us
    main()
