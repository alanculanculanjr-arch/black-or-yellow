#!/usr/bin/env python3
# Live camera alignment check: run while mounting the phone. Ctrl+C to stop.
#   /data/project/venv/bin/python ~/project/tools/camera_check.py 172.20.10.7:8080
# Every second it prints: how many markers are read, the camera's angle and height above the
# board, the smallest marker size, and whether the camera moved since the previous reading.
import sys, time, json, urllib.request
import cv2, numpy as np

addr = sys.argv[1] if len(sys.argv) > 1 else '172.20.10.7:8080'
B = json.load(open('/data/project/vision/board.json'))
A = B['area_mm']; inset = (B['marker_mm'] - B['marker_black_mm']) / 2; k = B['marker_black_mm']
p = cv2.aruco.DetectorParameters(); p.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_SUBPIX; p.minMarkerPerimeterRate = 0.01
det = cv2.aruco.ArucoDetector(cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50), p)
sq = lambda x0, y0: np.float32([[x0, y0], [x0 + k, y0], [x0 + k, y0 + k], [x0, y0 + k]])
far = A - inset - k
region = {(0, 0): (sq(inset, inset), 0), (0, 1): (sq(far, inset), 1), (1, 1): (sq(far, far), 2), (1, 0): (sq(inset, far), 3)}
last = None
print(f'Checking http://{addr} ... aim for: 4 markers, angle 45-90 deg, smallest marker >= 30 px, steady.')
while True:
    try:
        data = urllib.request.urlopen(f'http://{addr}/shot.jpg', timeout=3).read()
        img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    except Exception as e:
        print('camera not reachable:', e); time.sleep(1); continue
    h, w = img.shape[:2]
    corners, ids, _ = det.detectMarkers(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))
    found = [] if ids is None else [c.reshape(4, 2) for c in corners]
    msg = f'{len(found)}/4 markers'
    if found:
        smallest = min(min(np.linalg.norm(q[i] - q[(i + 1) % 4]) for i in range(4)) for q in found)
        msg += f' | smallest side {smallest:.0f}px'
    if len(found) >= 3:
        centre = (np.min([q.mean(0) for q in found], 0) + np.max([q.mean(0) for q in found], 0)) / 2
        src, dst, used = [], [], set()
        for q in found:
            dx, dy = q.mean(0) - centre
            key = (0 if dy < 0 else 1, 0 if dx < 0 else 1)
            if key in used: break
            used.add(key); s, outer = region[key]
            o = int(np.argmax(((q - centre) ** 2).sum(1)))
            src += list(np.roll(q, -(o - outer), axis=0)); dst += list(s)
        else:
            src, dst = np.float32(src), np.float32(dst)
            f = 0.75 * w
            K = np.array([[f, 0, w / 2], [0, f, h / 2], [0, 0, 1]])
            ok, rvec, tvec = cv2.solvePnP(np.hstack([dst, np.zeros((len(dst), 1), np.float32)]), src, K, None, flags=cv2.SOLVEPNP_IPPE)
            R, _ = cv2.Rodrigues(rvec); cam = (-R.T @ tvec).ravel(); cam[2] = abs(cam[2])
            horiz = np.linalg.norm(cam[:2] - np.array([A / 2, A / 2]))
            angle = np.degrees(np.arctan2(cam[2], horiz))
            msg += f' | angle {angle:.0f} deg down | height {cam[2] / 10:.0f} cm'
            centre_px = np.mean([q.mean(0) for q in found], 0)
            if last is not None and len(found) == 4:
                moved = np.linalg.norm(centre_px - last)
                msg += ' | STEADY' if moved < 3 else f' | moved {moved:.0f}px'
            if len(found) == 4: last = centre_px
            verdict = 'GOOD' if len(found) == 4 and angle >= 45 and smallest >= 30 else 'adjust'
            msg = f'[{verdict}] ' + msg
    print(msg, flush=True)
    time.sleep(1)
