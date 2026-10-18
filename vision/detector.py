# Ball detector shared by the game's vision worker (worker.py) and the live checker
# (live_check.py), so both always use exactly the same rules. ADR-001 describes the method:
#   board  : ArUco markers, layout saved in layout.json, any 2 visible markers are enough
#   ball   : painted GREEN, found by colour + filled-outline roundness + expected size
#   height : the ball's touching point is corrected for the angled camera
#   colour : BLACK/YELLOW share of the ball's footprint, 20-point lead, edge rule
import json, time
import cv2, numpy as np

B = json.load(open('/data/project/vision/board.json'))
A, C, W_ = B['area_mm'], B['cell_mm'], B['divider_mm']
INSET = (B['marker_mm'] - B['marker_black_mm']) / 2
K_MM = B['marker_black_mm']
R_BALL = B['ball_mm'] / 2
RULE = B['decision_rule']
BLACK = set(B['black_cells'])
HSV = B['ball_hsv']
REUSE_S = 10          # reuse the last board position this long when fewer than 2 markers are visible
MARGIN = 60           # look for the ball up to 60 mm past the board edge (a raised ball hangs over it)

_params = cv2.aruco.DetectorParameters()
_params.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_SUBPIX
_params.minMarkerPerimeterRate = 0.01
_det = cv2.aruco.ArucoDetector(cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50), _params)
_sq = lambda x0, y0: np.float32([[x0, y0], [x0 + K_MM, y0], [x0 + K_MM, y0 + K_MM], [x0, y0 + K_MM]])
_far = A - INSET - K_MM
REGION = {(0, 0): (_sq(INSET, INSET), 0), (0, 1): (_sq(_far, INSET), 1),
          (1, 1): (_sq(_far, _far), 2), (1, 0): (_sq(INSET, _far), 3)}
CELLS = [(r * 4 + c + 1, c * (C + W_), r * (C + W_)) for r in range(4) for c in range(4)]

LAYOUT_FILE = '/data/project/vision/layout.json'
layout = {}
try:
    for _i, _v in json.load(open(LAYOUT_FILE))['markers'].items():
        layout[int(_i)] = (tuple(_v['corner']), _v['roll'])
except FileNotFoundError:
    pass
_last_pose = {'pose': None, 'time': 0.0}


def _solve(src, dst, shape):
    src, dst = np.float32(src), np.float32(dst)
    H, _ = cv2.findHomography(src, dst)
    h, w = shape[:2]
    f = 0.75 * w                                   # measured 0.71-0.73 x width on this phone
    K = np.array([[f, 0, w / 2], [0, f, h / 2], [0, 0, 1]])
    _, rvec, tvec = cv2.solvePnP(np.hstack([dst, np.zeros((len(dst), 1), np.float32)]), src, K, None,
                                 flags=cv2.SOLVEPNP_IPPE)
    R, _ = cv2.Rodrigues(rvec)
    cam = (-R.T @ tvec).ravel()
    cam[2] = abs(cam[2])
    return H, cam


def board_pose(img):
    """((H, cam), markers_seen, how) or (None, markers_seen, why)."""
    corners, ids, _ = _det.detectMarkers(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))
    found = {} if ids is None else {int(i): c.reshape(4, 2) for c, i in zip(corners, ids.ravel())}
    n = len(found)
    if n == 4 and not layout:                      # first time only: learn which marker is where, and save
        pts = np.array([p.mean(0) for p in found.values()])
        centre = (pts.min(0) + pts.max(0)) / 2
        new, used = {}, set()
        for i, p in found.items():
            dx, dy = p.mean(0) - centre
            key = (0 if dy < 0 else 1, 0 if dx < 0 else 1)
            used.add(key)
            new[i] = (key, int(np.argmax(((p - centre) ** 2).sum(1))) - REGION[key][1])
        if len(used) == 4:
            layout.update(new)
            names = {(0, 0): 'cell 1', (0, 1): 'cell 4', (1, 1): 'cell 16', (1, 0): 'cell 13'}
            json.dump({'_note': 'marker id -> board corner (learned once from a frame with all 4 markers)',
                       'markers': {str(i): {'corner': list(k), 'roll': r, 'cell': names[k]} for i, (k, r) in layout.items()}},
                      open(LAYOUT_FILE, 'w'), indent=2)
    known = {i: p for i, p in found.items() if i in layout}
    if len(known) >= 2:
        src, dst = [], []
        for i, p in known.items():
            key, roll = layout[i]
            src += list(np.roll(p, -roll, axis=0))
            dst += list(REGION[key][0])
        pose = _solve(src, dst, img.shape)
        cam = pose[1]
        angle = np.degrees(np.arctan2(cam[2], np.linalg.norm(cam[:2] - A / 2)))
        if cam[2] < 80 or angle < 20:     # impossible camera position: the markers seen can't locate the board
            return None, n, f'{n} markers, but the board position makes no sense (camera moved? board out of view?)'
        _last_pose.update(pose=pose, time=time.time())
        return pose, n, 'markers' if n == 4 else f'{n} markers (rest worked out from these)'
    if _last_pose['pose'] is not None and time.time() - _last_pose['time'] < REUSE_S:
        return _last_pose['pose'], n, f'{n} markers: using last board position'
    if not layout:
        return None, n, 'show all 4 markers once so their corners can be learned'
    return None, n, f'only {n} marker(s) visible'


def colour_share(P):
    """(winning colour, its share, other share, cell with most of the ball) for touching point P (mm)."""
    s = 4
    n = int(A * s)
    disk = np.zeros((n, n), np.uint8)
    cv2.circle(disk, (int(P[0] * s), int(P[1] * s)), int(R_BALL * s), 1, -1)
    total = np.pi * (R_BALL * s) ** 2
    share = {'BLACK': 0.0, 'YELLOW': 0.0}
    best = (-1.0, 0)
    for cell, x0, y0 in CELLS:
        sh = disk[int(y0 * s):int((y0 + C) * s), int(x0 * s):int((x0 + C) * s)].sum() / total
        share['BLACK' if cell in BLACK else 'YELLOW'] += sh
        best = max(best, (sh, cell))
    on_board = share['BLACK'] + share['YELLOW']
    if on_board > 0:                               # edge rule: only the part over the board counts
        share = {c: v / on_board for c, v in share.items()}
    win = max(share, key=share.get)
    lose = 'YELLOW' if win == 'BLACK' else 'BLACK'
    return win, share[win], share[lose], best[1]


def find_ball(img, draw=True):
    """Analyse one camera picture. Returns (annotated picture, info dict).
    info['result'] is BLACK, YELLOW, INVALID (too close to call), NO BALL or BOARD NOT FOUND;
    when a ball is seen info['P'] is its touching point in board mm."""
    info = {}
    vis = img.copy() if draw else None
    pose, n, how = board_pose(img)
    info['markers'], info['board'] = n, how
    if pose is None:
        info['result'], info['detail'] = 'BOARD NOT FOUND', how
        return vis, info
    H, cam = pose
    Hinv = np.linalg.inv(H)
    info['angle'] = round(float(np.degrees(np.arctan2(cam[2], np.linalg.norm(cam[:2] - A / 2)))))
    info['height_cm'] = round(float(cam[2] / 10))
    if draw:
        for cell, x0, y0 in CELLS:
            q = cv2.perspectiveTransform(np.float32([[x0, y0], [x0 + C, y0], [x0 + C, y0 + C], [x0, y0 + C]]).reshape(-1, 1, 2), Hinv)
            cv2.polylines(vis, [q.astype(np.int32)], True, (0, 255, 0), 1)
            ctr = q.reshape(-1, 2).mean(0)
            cv2.putText(vis, str(cell), (int(ctr[0]) - 8, int(ctr[1]) + 6), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 0, 255), 2)

    def judge(ic):
        ic = cv2.convexHull(ic.reshape(-1, 1, 2))           # fill bites (shine spot, partly hidden ball)
        a, p = cv2.contourArea(ic), cv2.arcLength(ic, True)
        if p == 0 or a < 150:
            return None
        (x, y), rad = cv2.minEnclosingCircle(ic)
        circ = 4 * np.pi * a / p ** 2
        G = cv2.perspectiveTransform(np.float32([[[x, y]]]), H).ravel()
        q = cv2.perspectiveTransform(np.float32([[[G[0] - R_BALL, G[1]], [G[0] + R_BALL, G[1]]]]), Hinv).reshape(2, 2)
        size = rad / (np.linalg.norm(q[0] - q[1]) / 2)
        if circ < 0.45 or not 0.5 < size < 2.2:
            return None
        return (circ * min(size, 1 / size) * a, x, y, rad, G)

    hsv = cv2.cvtColor(cv2.GaussianBlur(img, (5, 5), 0), cv2.COLOR_BGR2HSV)
    green = cv2.inRange(hsv, (HSV['h_min'], HSV['s_min'], HSV['v_min']), (HSV['h_max'], 255, 255))
    poly = cv2.perspectiveTransform(np.float32([[-MARGIN, -MARGIN], [A + MARGIN, -MARGIN], [A + MARGIN, A + MARGIN],
                                                [-MARGIN, A + MARGIN]]).reshape(-1, 1, 2), Hinv)
    area = np.zeros(img.shape[:2], np.uint8)
    cv2.fillPoly(area, [poly.astype(np.int32)], 255)
    green &= area
    green = cv2.morphologyEx(green, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
    green = cv2.morphologyEx(green, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15)))
    cnts, _ = cv2.findContours(green, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cand = [c for c in (judge(cnt.astype(np.float32)) for cnt in cnts) if c]
    if len(cand) > 1:
        info['note'] = f'{len(cand)} green blobs: picked the biggest round one'
    if not cand:
        info['result'] = 'NO BALL'
        return vis, info
    _, x, y, rad, G = max(cand, key=lambda c: c[0])
    P = G + (cam[:2] - G) * (R_BALL / cam[2])     # touching point under the ball's centre
    if not (0 <= P[0] <= A and 0 <= P[1] <= A):
        info['edge'] = True                        # edge rule: just outside the edge -> nearest point on the board
        P = np.clip(P, 0, A)
    win, ws, ls, cell = colour_share(P)
    ok = ws - ls >= RULE['min_lead']
    info.update(P=[float(P[0]), float(P[1])], cell=int(cell), shares=f'{win} {ws*100:.0f}% vs {ls*100:.0f}%',
                share_win=round(float(ws), 3), share_lose=round(float(ls), 3), ok=bool(ok),
                result=win if ok else 'INVALID')
    if not ok:
        info['detail'] = 'too close to call (on a stick or corner)'
    if draw:
        cv2.circle(vis, (int(x), int(y)), int(rad), (0, 255, 0) if ok else (0, 0, 255), 3)
        pp = cv2.perspectiveTransform(np.float32([[P]]), Hinv).ravel()
        cv2.circle(vis, (int(pp[0]), int(pp[1])), 6, (255, 0, 255), -1)
    return vis, info


class StillTracker:
    """Spec 8.3: the ball must stay put (touching point within limit_mm) for seconds, uninterrupted."""

    def __init__(self, seconds=2.0, limit_mm=5.0):
        self.seconds, self.limit, self.track = seconds, limit_mm, []

    def reset(self):
        self.track.clear()

    def add(self, P, now=None):
        now = time.time() if now is None else now
        P = np.asarray(P, float)
        self.track.append((now, P))
        while self.track and now - self.track[0][0] > self.seconds + 1:
            self.track.pop(0)
        recent = [p for t, p in self.track if now - t <= self.seconds]
        span = self.track[-1][0] - self.track[0][0] if len(self.track) > 1 else 0
        return span >= self.seconds and max(np.linalg.norm(p - P) for p in recent) < self.limit
