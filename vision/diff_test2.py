# Comparison-based ball test, tolerant of camera movement:
#   python3 diff_test2.py FRAMES_DIR OUTPUT.jpg REFERENCE.jpg
# Both the empty reference and each frame are straightened onto the board using that picture's
# own markers, and compared there, so a camera that shifted between pictures still lines up.
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
    if len(found) < 3:
        return None
    pts = np.array([p.mean(0) for p in found])
    centre = (pts.min(0) + pts.max(0)) / 2
    sq = lambda x0, y0: np.float32([[x0, y0], [x0 + k, y0], [x0 + k, y0 + k], [x0, y0 + k]])
    far = A - inset - k
    region = {(0, 0): (sq(inset, inset), 0), (0, 1): (sq(far, inset), 1),
              (1, 1): (sq(far, far), 2), (1, 0): (sq(inset, far), 3)}
    src, dst, used = [], [], set()
    for p in found:
        dx, dy = p.mean(0) - centre
        key = (0 if dy < 0 else 1, 0 if dx < 0 else 1)
        if key in used:
            return None
        used.add(key)
        s, outer = region[key]
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
    return H, cam


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
    on_board = share['BLACK'] + share['YELLOW']
    if on_board > 0:                      # edge rule: only the part over the board counts
        share = {c: v / on_board for c, v in share.items()}
    win = max(share, key=share.get)
    lose = 'YELLOW' if win == 'BLACK' else 'BLACK'
    return win, share[win], share[lose], best[1]


M_ = 35          # margin around the board (mm): a raised ball near an edge pokes past it
S = 3            # pixels per mm in the straightened view
N = int((A + 2 * M_) * S)
T = np.array([[S, 0, M_ * S], [0, S, M_ * S], [0, 0, 1]], float)   # board mm -> straightened px

def straighten(img, H):
    return cv2.warpPerspective(cv2.GaussianBlur(img, (5, 5), 0), T @ H, (N, N))

ref_img = cv2.imread(sys.argv[3])
pose = board_pose(ref_img)
if pose is None:
    raise SystemExit('reference: need at least 3 markers')
ref_w = straighten(ref_img, pose[0])

thumbs, lines = [], []
for f in sorted(glob.glob(D + '/f*.jpg')):
    img = cv2.imread(f)
    name = f.split('/')[-1][:-4]
    vis = img.copy()
    pose = board_pose(img)
    if pose is None:
        verdict = 'board not found (markers hidden)'
    else:
        H, cam = pose
        Hinv = np.linalg.inv(H)
        w = straighten(img, H)
        diff = cv2.absdiff(w, ref_w).max(axis=2)
        hsv = cv2.cvtColor(w, cv2.COLOR_BGR2HSV)
        m = ((diff > 35) & (hsv[..., 2] > 130) & (hsv[..., 1] < 130)).astype(np.uint8) * 255
        m = cv2.morphologyEx(m, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))     # drop thin stick edges
        m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15)))
        cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        cand = []
        TH = np.linalg.inv(T @ H)           # straightened px -> camera image px
        for cnt in cnts:
            if cv2.contourArea(cnt) < 300:
                continue
            ic = cv2.perspectiveTransform(cnt.astype(np.float32), TH)          # same blob in the camera picture
            a = cv2.contourArea(ic); p = cv2.arcLength(ic, True)
            if p == 0:
                continue
            (x, y), rad = cv2.minEnclosingCircle(ic)
            circ = 4 * np.pi * a / p ** 2
            G = cv2.perspectiveTransform(np.float32([[[x, y]]]), H).ravel()
            q = cv2.perspectiveTransform(np.float32([[[G[0] - R_BALL, G[1]], [G[0] + R_BALL, G[1]]]]), Hinv).reshape(2, 2)
            exp_r = np.linalg.norm(q[0] - q[1]) / 2
            if circ > 0.55 and 0.6 * exp_r < rad < 1.7 * exp_r:
                cand.append((a, x, y, rad, G))
        if not cand:
            verdict = 'no ball'
        elif len(cand) > 1:
            verdict = f'INVALID ({len(cand)} ball-like changes)'
        else:
            _, x, y, rad, G = cand[0]
            P = G + (cam[:2] - G) * (R_BALL / cam[2])
            if not (0 <= P[0] <= A and 0 <= P[1] <= A):
                P = np.clip(P, 0, A)          # edge rule
            win, ws, ls, cell = colour_share(P)
            ok = ws - ls >= MIN_LEAD
            verdict = f'{win} {ws*100:.0f}% vs {ls*100:.0f}% (cell {cell})' if ok else f'INVALID tie {ws*100:.0f}% vs {ls*100:.0f}%'
            cv2.circle(vis, (int(x), int(y)), int(rad), (0, 255, 0) if ok else (0, 0, 255), 3)
            pp = cv2.perspectiveTransform(np.float32([[P]]), Hinv).ravel()
            cv2.circle(vis, (int(pp[0]), int(pp[1])), 6, (255, 0, 255), -1)
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
