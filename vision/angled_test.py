# Angled-camera ball test: python3 angled_test.py FRAMES_DIR OUTPUT.jpg
# Board from >=3 ArUco markers, camera position via solvePnP, ball-height correction,
# CREAM colour for the ball (not white paper, not yellow), colour-share rule with a 20-point lead.
import sys, glob, json, cv2, numpy as np
from pathlib import Path
D, OUT = sys.argv[1], sys.argv[2]
B = json.load(open(Path(__file__).with_name('board.json')))
A, C, W_ = B['area_mm'], B['cell_mm'], B['divider_mm']
inset = (B['marker_mm'] - B['marker_black_mm']) / 2; k = B['marker_black_mm']
R_BALL = B['ball_mm'] / 2
det_params = cv2.aruco.DetectorParameters()
det_params.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_SUBPIX
det_params.minMarkerPerimeterRate = 0.01          # allow small, far-away markers
det = cv2.aruco.ArucoDetector(cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50), det_params)

def board_from_markers(img):
    """Image->board homography (mm) and camera position, from >=3 markers placed one per corner."""
    corners, ids, _ = det.detectMarkers(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))
    if ids is None or len(ids) < 3: return None
    found = [c.reshape(4, 2) for c in corners]
    h, w = img.shape[:2]
    # Which board corner each marker sits in: use the quadrant around the centre of the markers,
    # but with 3 markers use the bounding box centre instead.
    pts = np.array([p.mean(0) for p in found])
    centre = (pts.min(0) + pts.max(0)) / 2
    sq = lambda x0, y0: np.float32([[x0, y0], [x0 + k, y0], [x0 + k, y0 + k], [x0, y0 + k]])
    far = A - inset - k
    region = {(0, 0): (sq(inset, inset), 0), (0, 1): (sq(far, inset), 1), (1, 1): (sq(far, far), 2), (1, 0): (sq(inset, far), 3)}
    src, dst, used = [], [], set()
    for p in found:
        dx, dy = p.mean(0) - centre
        key = (0 if dy < 0 else 1, 0 if dx < 0 else 1)
        if key in used: return None
        used.add(key); s, outer = region[key]
        o = int(np.argmax(((p - p.mean(0) - (p.mean(0) - centre) * 0) @ np.sign([dx, dy]))))  # corner pointing away from centre
        src += list(np.roll(p, -(o - outer), axis=0)); dst += list(s)
    src, dst = np.float32(src), np.float32(dst)
    H, _ = cv2.findHomography(src, dst)
    f = 0.78 * w                                  # typical phone lens: ~500 px at 640 wide, ~1000 px at 1280 wide
    K = np.array([[f, 0, w / 2], [0, f, h / 2], [0, 0, 1]])
    obj = np.hstack([dst, np.zeros((len(dst), 1), np.float32)])
    ok, rvec, tvec = cv2.solvePnP(obj, src, K, None, flags=cv2.SOLVEPNP_IPPE)
    if not ok: return None
    R, _ = cv2.Rodrigues(rvec)
    cam = (-R.T @ tvec).ravel()                   # camera position in board mm (z is height above the board)
    if cam[2] < 0: cam = cam * np.array([1, 1, -1])
    return H, cam, len(found), corners, used

cells = [(r * 4 + c + 1, c * (C + W_), r * (C + W_)) for r in range(4) for c in range(4)]

CORNER_CELL = {(0, 0): 1, (0, 1): 4, (1, 1): 16, (1, 0): 13}
MIN_LEAD = 0.20      # winning colour must cover at least 20 percentage points more than the other

def colour_of(cell): return 'BLACK' if cell in B['black_cells'] else 'YELLOW'

def decide(P):
    """Share of the ball's footprint on each colour (all cells it touches added up)."""
    S = 4; n = int(A * S)
    disk = np.zeros((n, n), np.uint8)
    cv2.circle(disk, (int(P[0] * S), int(P[1] * S)), int(R_BALL * S), 1, -1)
    total = np.pi * (R_BALL * S) ** 2
    share = {'BLACK': 0.0, 'YELLOW': 0.0}; best = (-1.0, 0)
    for cell, x0, y0 in cells:
        sh = disk[int(y0 * S):int((y0 + C) * S), int(x0 * S):int((x0 + C) * S)].sum() / total
        share[colour_of(cell)] += sh
        best = max(best, (sh, cell))
    win = max(share, key=share.get); lose = 'YELLOW' if win == 'BLACK' else 'BLACK'
    lead = share[win] - share[lose]
    return win, share[win], share[lose], lead, best[1]

def classify(P):
    """Share of a ball-sized footprint around P inside each cell (dividers count for no cell)."""
    S = 4; n = int(A * S)
    disk = np.zeros((n, n), np.uint8)
    cv2.circle(disk, (int(P[0] * S), int(P[1] * S)), int(R_BALL * S), 1, -1)
    total = np.pi * (R_BALL * S) ** 2
    best = max((disk[int(y0 * S):int((y0 + C) * S), int(x0 * S):int((x0 + C) * S)].sum() / total, cell) for cell, x0, y0 in cells)
    return best

files = sorted(glob.glob(D + '/f*.jpg'))
thumbs, lines = [], []
for f in files:
    img = cv2.imread(f); name = f.split('/')[-1][:-4]
    b = board_from_markers(img)
    vis = img.copy()
    if b is None:
        verdict = 'board not found'
    else:
        H, cam, nm, corners, seen = b
        Hinv = np.linalg.inv(H)
        board_poly = cv2.perspectiveTransform(np.float32([[0, 0], [A, 0], [A, A], [0, A]]).reshape(-1, 1, 2), Hinv).astype(np.int32)
        # Search a bit beyond the board: a 30 mm ball near an edge pokes past the outline in an
        # angled view. Whether it is ON the board is decided later from its touching point.
        M_ = 35
        search_poly = cv2.perspectiveTransform(np.float32([[-M_, -M_], [A + M_, -M_], [A + M_, A + M_], [-M_, A + M_]]).reshape(-1, 1, 2), Hinv).astype(np.int32)
        mask = np.zeros(img.shape[:2], np.uint8); cv2.fillPoly(mask, [search_poly], 255)
        mask = cv2.erode(mask, np.ones((5, 5), np.uint8))
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        pale = cv2.inRange(hsv, (0, 22, 140), (180, 120, 255)) & mask   # CREAM: ball S 40-57; white paper S<15; yellow S>200
        pale = cv2.morphologyEx(pale, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))   # fill the shiny top
        pale = cv2.morphologyEx(pale, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
        cnts, _ = cv2.findContours(pale, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        cand = []
        for cnt in cnts:
            a = cv2.contourArea(cnt); p = cv2.arcLength(cnt, True)
            if a < 120 or p == 0: continue
            circ = 4 * np.pi * a / p ** 2
            (x, y), rad = cv2.minEnclosingCircle(cnt)
            # expected size: a 30 mm ball at that spot, measured through the homography
            G = cv2.perspectiveTransform(np.float32([[[x, y]]]), H).ravel()
            q = cv2.perspectiveTransform(np.float32([[[G[0] - R_BALL, G[1]], [G[0] + R_BALL, G[1]]]]), Hinv).reshape(2, 2)
            exp_r = np.linalg.norm(q[0] - q[1]) / 2
            if circ > 0.6 and 0.6 * exp_r < rad < 1.6 * exp_r: cand.append((a, x, y, rad, G))
        missing = [k for k in CORNER_CELL if k not in seen]
        if not cand: verdict = 'no ball'
        elif len(cand) > 1: verdict = f'INVALID ({len(cand)} ball-like blobs)'
        else:
            _, x, y, rad, G = cand[0]
            # The ball's centre is R_BALL above the board; the camera ray through it hits the board at G.
            # Walk back along that ray to the centre's height, then drop straight down: contact point P.
            t = R_BALL / cam[2]
            P = G + (cam[:2] - G) * t
            off_board = not (0 <= P[0] <= A and 0 <= P[1] <= A)
            win, ws, ls, lead, cell = decide(P)
            shift = np.linalg.norm(P - G)
            verdict = (f'{win} {ws*100:.0f}% vs {ls*100:.0f}% (cell {cell})' if lead >= MIN_LEAD
                       else f'INVALID tie {ws*100:.0f}% vs {ls*100:.0f}%')
            if off_board: verdict = 'INVALID (ball off the board)'
            verdict += f'  [height fix {shift:.0f}mm, cam h {cam[2]:.0f}mm, {nm} markers]'
            cv2.circle(vis, (int(x), int(y)), int(rad), (0, 255, 0) if lead >= MIN_LEAD else (0, 0, 255), 2)
            pp = cv2.perspectiveTransform(np.float32([[P]]), Hinv).ravel()
            cv2.circle(vis, (int(pp[0]), int(pp[1])), 3, (255, 0, 255), -1)
        for cell, x0, y0 in cells:
            q = cv2.perspectiveTransform(np.float32([[x0, y0], [x0 + C, y0], [x0 + C, y0 + C], [x0, y0 + C]]).reshape(-1, 1, 2), Hinv)
            cv2.polylines(vis, [q.astype(np.int32)], True, (0, 255, 0), 1)
    lines.append(f'{name}: {verdict}')
    t = cv2.resize(vis, (240, 180)); cv2.rectangle(t, (0, 0), (240, 16), (255, 255, 255), -1)
    cv2.putText(t, f'{name} {verdict.split("  [")[0][:28]}', (2, 12), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (0, 0, 0), 1)
    thumbs.append(t)
print('\n'.join(lines))
while len(thumbs) % 8: thumbs.append(np.zeros_like(thumbs[0]))
cv2.imwrite(OUT, np.vstack([np.hstack(thumbs[i:i + 8]) for i in range(0, len(thumbs), 8)]))
