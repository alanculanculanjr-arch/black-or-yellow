# Comparison-based ball test (the method the game will use, ADR-001):
#   python3 diff_test.py FRAMES_DIR OUTPUT.jpg
# FRAMES_DIR holds ref*.jpg (empty board, camera fixed) and f*.jpg (test frames).
#
# 1. Board + camera position from the 4 ArUco markers in the EMPTY reference.
# 2. Each frame: what changed since the reference AND looks like the ball (cream, not shadow,
#    not yellow) AND is round AND is ball-sized.
# 3. Correct for the ball's height (angled camera), then the colour-share rule.
import sys, glob, json, cv2, numpy as np

D, OUT = sys.argv[1], sys.argv[2]
B = json.load(open('/data/project/vision/board.json'))
A, C, W_ = B['area_mm'], B['cell_mm'], B['divider_mm']
inset = (B['marker_mm'] - B['marker_black_mm']) / 2
k = B['marker_black_mm']
R_BALL = B['ball_mm'] / 2
MIN_LEAD = B['decision_rule']['min_lead']
BLACK = set(B['black_cells'])

params = cv2.aruco.DetectorParameters()
params.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_SUBPIX
params.minMarkerPerimeterRate = 0.01
det = cv2.aruco.ArucoDetector(cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50), params)


def find_markers(gray):
    corners, ids, _ = det.detectMarkers(gray)
    return [] if ids is None else [c.reshape(4, 2) for c in corners]


def board_pose(img):
    """Homography image->board mm and camera position, from all 4 markers (any ids, any order)."""
    found = find_markers(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))
    if len(found) != 4:
        raise SystemExit(f'reference: need all 4 markers, found {len(found)}')
    centre = np.mean([p.mean(0) for p in found], axis=0)
    sq = lambda x0, y0: np.float32([[x0, y0], [x0 + k, y0], [x0 + k, y0 + k], [x0, y0 + k]])
    far = A - inset - k
    region = {(0, 0): (sq(inset, inset), 0), (0, 1): (sq(far, inset), 1),
              (1, 1): (sq(far, far), 2), (1, 0): (sq(inset, far), 3)}
    src, dst = [], []
    for p in found:
        dx, dy = p.mean(0) - centre
        s, outer = region[(0 if dy < 0 else 1, 0 if dx < 0 else 1)]
        o = int(np.argmax(((p - centre) ** 2).sum(1)))
        src += list(np.roll(p, -(o - outer), axis=0))
        dst += list(s)
    src, dst = np.float32(src), np.float32(dst)
    H, _ = cv2.findHomography(src, dst)
    h, w = img.shape[:2]
    f = 0.75 * w                                   # measured 0.71-0.73 x width on this phone
    K = np.array([[f, 0, w / 2], [0, f, h / 2], [0, 0, 1]])
    ok, rvec, tvec = cv2.solvePnP(np.hstack([dst, np.zeros((len(dst), 1), np.float32)]), src, K, None,
                                  flags=cv2.SOLVEPNP_IPPE)
    R, _ = cv2.Rodrigues(rvec)
    cam = (-R.T @ tvec).ravel()
    if cam[2] < 0:
        cam[2] = -cam[2]
    return H, cam, np.mean([p.mean(0) for p in found], axis=0)


cells = [(r * 4 + c + 1, c * (C + W_), r * (C + W_)) for r in range(4) for c in range(4)]


def colour_share(P):
    S = 4
    n = int(A * S)
    disk = np.zeros((n, n), np.uint8)
    cv2.circle(disk, (int(P[0] * S), int(P[1] * S)), int(R_BALL * S), 1, -1)
    total = np.pi * (R_BALL * S) ** 2
    share = {'BLACK': 0.0, 'YELLOW': 0.0}
    best = (-1.0, 0)
    for cell, x0, y0 in cells:
        sh = disk[int(y0 * S):int((y0 + C) * S), int(x0 * S):int((x0 + C) * S)].sum() / total
        share['BLACK' if cell in BLACK else 'YELLOW'] += sh
        best = max(best, (sh, cell))
    win = max(share, key=share.get)
    lose = 'YELLOW' if win == 'BLACK' else 'BLACK'
    return win, share[win], share[lose], best[1]


refs = [cv2.imread(f) for f in sorted(glob.glob(D + '/ref*.jpg'))]
ref = np.median(np.stack(refs), axis=0).astype(np.uint8)        # empty board, noise averaged out
H, cam, ref_marker_centre = board_pose(ref)
Hinv = np.linalg.inv(H)
print(f'reference: 4 markers, camera at x {cam[0]:.0f} y {cam[1]:.0f} mm, {cam[2]:.0f} mm above the board')

M_ = 35   # search a little beyond the board: a raised ball near an edge pokes past the outline
search = cv2.perspectiveTransform(np.float32([[-M_, -M_], [A + M_, -M_], [A + M_, A + M_], [-M_, A + M_]]).reshape(-1, 1, 2), Hinv)
search_mask = np.zeros(ref.shape[:2], np.uint8)
cv2.fillPoly(search_mask, [search.astype(np.int32)], 255)
ref_blur = cv2.GaussianBlur(ref, (5, 5), 0)
ref_gray = cv2.cvtColor(ref, cv2.COLOR_BGR2GRAY)

thumbs, lines = [], []
for f in sorted(glob.glob(D + '/f*.jpg')):
    img = cv2.imread(f)
    name = f.split('/')[-1][:-4]
    vis = img.copy()
    # camera moved? compare marker positions with the reference
    found = find_markers(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))
    if len(found) >= 3:
        shift = np.linalg.norm(np.mean([p.mean(0) for p in found], axis=0) - ref_marker_centre)
    else:
        shift = 0.0
    moved = len(found) == 4 and shift > 8

    blur = cv2.GaussianBlur(img, (5, 5), 0)
    diff = cv2.absdiff(blur, ref_blur).max(axis=2)
    hsv = cv2.cvtColor(blur, cv2.COLOR_BGR2HSV)
    changed = (diff > 35).astype(np.uint8) * 255
    creamy = cv2.inRange(hsv, (0, 0, 130), (180, 130, 255))   # not a shadow (dark), not yellow (S > 130)
    m = changed & creamy & search_mask
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11)))
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
    cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cand = []
    for cnt in cnts:
        a = cv2.contourArea(cnt)
        p = cv2.arcLength(cnt, True)
        if a < 150 or p == 0:
            continue
        (x, y), rad = cv2.minEnclosingCircle(cnt)
        circ = 4 * np.pi * a / p ** 2
        G = cv2.perspectiveTransform(np.float32([[[x, y]]]), H).ravel()
        q = cv2.perspectiveTransform(np.float32([[[G[0] - R_BALL, G[1]], [G[0] + R_BALL, G[1]]]]), Hinv).reshape(2, 2)
        exp_r = np.linalg.norm(q[0] - q[1]) / 2
        if circ > 0.6 and 0.6 * exp_r < rad < 1.6 * exp_r:
            cand.append((a, x, y, rad, G))
    if moved:
        verdict = f'CAMERA MOVED ({shift:.0f}px): recalibrate'
    elif not cand:
        verdict = 'no ball'
    elif len(cand) > 1:
        verdict = f'INVALID ({len(cand)} ball-like changes)'
    else:
        _, x, y, rad, G = cand[0]
        P = G + (cam[:2] - G) * (R_BALL / cam[2])          # touching point under the ball's centre
        if not (0 <= P[0] <= A and 0 <= P[1] <= A):
            verdict = 'INVALID (off the board)'
            ok = False
        else:
            win, ws, ls, cell = colour_share(P)
            ok = ws - ls >= MIN_LEAD
            verdict = f'{win} {ws*100:.0f}% vs {ls*100:.0f}% (cell {cell})' if ok else f'INVALID tie {ws*100:.0f}% vs {ls*100:.0f}%'
        cv2.circle(vis, (int(x), int(y)), int(rad), (0, 255, 0) if ok else (0, 0, 255), 3)
        pp = cv2.perspectiveTransform(np.float32([[P]]), Hinv).ravel()
        cv2.circle(vis, (int(pp[0]), int(pp[1])), 5, (255, 0, 255), -1)
    for cell, x0, y0 in cells:
        q = cv2.perspectiveTransform(np.float32([[x0, y0], [x0 + C, y0], [x0 + C, y0 + C], [x0, y0 + C]]).reshape(-1, 1, 2), Hinv)
        cv2.polylines(vis, [q.astype(np.int32)], True, (0, 255, 0), 1)
    lines.append(f'{name}: {verdict}')
    t = cv2.resize(vis, (320, 180))
    cv2.rectangle(t, (0, 0), (320, 16), (255, 255, 255), -1)
    cv2.putText(t, f'{name} {verdict[:40]}', (2, 12), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 0), 1)
    thumbs.append(t)

print('\n'.join(lines))
while len(thumbs) % 6:
    thumbs.append(np.zeros_like(thumbs[0]))
cv2.imwrite(OUT, np.vstack([np.hstack(thumbs[i:i + 6]) for i in range(0, len(thumbs), 6)]))
