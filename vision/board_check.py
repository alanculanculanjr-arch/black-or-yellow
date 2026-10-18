# Board finder test: python3 board_check.py FRAME.jpg OUTPUT_DIR
# Finds the 4 ArUco markers (any ids, any order), straightens the board, draws the 16 cells.
import sys, json, cv2, numpy as np
img = cv2.imread(sys.argv[1]); out = sys.argv[2]
B = json.load(open('/data/project/vision/board.json'))
A, C, W_ = B['area_mm'], B['cell_mm'], B['divider_mm']
inset = (B['marker_mm'] - B['marker_black_mm']) / 2       # white border width
k = B['marker_black_mm']
print('frame', img.shape[1], 'x', img.shape[0])
det = cv2.aruco.ArucoDetector(cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50), cv2.aruco.DetectorParameters())
corners, ids, rejected = det.detectMarkers(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))
found = {} if ids is None else {int(i): c.reshape(4, 2) for c, i in zip(corners, ids.ravel())}
print('markers found:', sorted(found), ' (rejected candidates:', len(rejected), ')')
for i, p in sorted(found.items()):
    print(f'  marker {i}: side {np.linalg.norm(p[0]-p[1]):.0f} px')
vis = img.copy()
cv2.aruco.drawDetectedMarkers(vis, corners, ids)
cv2.imwrite(out + '/1-markers.jpg', vis)
if len(found) < 4:
    print('MISSING: only', len(found), 'markers visible'); sys.exit(0)
# Ignore marker numbers: decide each marker's board corner from where it is in the picture.
centre = np.mean([p.mean(0) for p in found.values()], axis=0)
slot = {}
for i, p in found.items():
    dx, dy = p.mean(0) - centre
    slot[(0 if dy < 0 else 1, 0 if dx < 0 else 1)] = i     # (row, col) of the board corner
names = {(0, 0): 'top-left', (0, 1): 'top-right', (1, 1): 'bottom-right', (1, 0): 'bottom-left'}
if len(slot) != 4:
    print('markers are not one per corner:', slot); sys.exit(0)
print('placement as seen:', ', '.join(f"{names[k]}={slot[k]}" for k in [(0, 0), (0, 1), (1, 1), (1, 0)]))
def square(x0, y0): return np.float32([[x0, y0], [x0 + k, y0], [x0 + k, y0 + k], [x0, y0 + k]])
far = A - inset - k
region = {(0, 0): (square(inset, inset), 0), (0, 1): (square(far, inset), 1),
          (1, 1): (square(far, far), 2), (1, 0): (square(inset, far), 3)}
src, dst = [], []
for key, i in slot.items():
    p = found[i]
    sq, outer = region[key]
    o = int(np.argmax(((p - centre) ** 2).sum(1)))          # detected corner farthest from board centre = outer corner
    p = np.roll(p, -(o - outer), axis=0)
    src += list(p); dst += list(sq)
H, _ = cv2.findHomography(np.float32(src), np.float32(dst))
err = np.abs(cv2.perspectiveTransform(np.float32(src).reshape(-1, 1, 2), H).reshape(-1, 2) - np.float32(dst))
print(f'fit error: mean {err.mean():.2f} mm, max {err.max():.2f} mm')
S = 3                                                      # pixels per mm in the straightened view
Hs = np.diag([S, S, 1]) @ H
N = int(round(A * S))
warp = cv2.warpPerspective(img, Hs, (N, N))
for r in range(4):
    for c in range(4):
        x0, y0 = c * (C + W_), r * (C + W_)
        cell = r * 4 + c + 1
        col = (0, 0, 0) if cell in B['black_cells'] else (0, 200, 255)
        cv2.rectangle(warp, (int(x0 * S), int(y0 * S)), (int((x0 + C) * S), int((y0 + C) * S)), (0, 255, 0), 2)
        cv2.putText(warp, str(cell), (int((x0 + C / 2) * S) - 10, int((y0 + C / 2) * S) + 8), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 0, 255), 2)
cv2.imwrite(out + '/2-straightened-grid.jpg', warp)
# also outline the board on the original
inv = np.linalg.inv(H)
for r in range(4):
    for c in range(4):
        x0, y0 = c * (C + W_), r * (C + W_)
        q = cv2.perspectiveTransform(np.float32([[x0, y0], [x0 + C, y0], [x0 + C, y0 + C], [x0, y0 + C]]).reshape(-1, 1, 2), inv)
        cv2.polylines(vis, [q.astype(int)], True, (0, 255, 0), 1)
cv2.imwrite(out + '/1-markers.jpg', vis)
# colour sanity check: sample each cell's middle
hsv = cv2.cvtColor(cv2.warpPerspective(img, Hs, (N, N)), cv2.COLOR_BGR2HSV)
ok = 0
for r in range(4):
    for c in range(4):
        cell = r * 4 + c + 1
        if cell in (1, 4, 13, 16): continue            # corner cells have markers
        x0, y0 = c * (C + W_), r * (C + W_)
        patch = hsv[int((y0 + 15) * S):int((y0 + 30) * S), int((x0 + 15) * S):int((x0 + 30) * S)].reshape(-1, 3)
        s, v = np.median(patch[:, 1]), np.median(patch[:, 2])
        seen = 'YELLOW' if s > 100 else 'BLACK'   # yellow is strongly coloured; black paint can look dark grey
        want = 'BLACK' if cell in B['black_cells'] else 'YELLOW'
        ok += seen == want
        if seen != want: print(f'  cell {cell}: expected {want}, looks {seen} (S {s:.0f} V {v:.0f})')
print(f'cell colour check: {ok}/12 unmarked cells match the expected checkerboard')
