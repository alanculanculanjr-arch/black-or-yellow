#!/usr/bin/env python3
# Live vision checker: a web page that shows what the ball detector sees, continuously.
#   Web page:  /data/project/venv/bin/python ~/project/vision/live_check.py 192.168.137.123:8080 8001
#              then open http://<pi-ip>:8001/ and press "Set empty board" with the board empty.
#   Terminal:  /data/project/venv/bin/python ~/project/vision/live_check.py 192.168.137.123:8080 --text
#              prints one line per update; press Enter (with the board empty) to set the reference.
# Ctrl+C to stop.
#
# Covered markers: the first time all 4 markers are seen, the program remembers which marker id
# sits in which board corner (and how it is turned). After that ANY 2 visible markers locate the
# board (8 known corner points). With fewer, the last good board position is reused for up to
# 10 s, assuming the camera did not move.
#
# Same method as diff_test2.py: board from ArUco markers (any 3+), reference and live frame
# both straightened onto the board and compared, ball = changed + cream + round + ball-sized,
# height (angle) correction, colour-share rule, plus the game's 2-second stillness rule.
import sys, json, time, threading, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import cv2, numpy as np

args = [a for a in sys.argv[1:] if not a.startswith('--')]
TEXT = '--text' in sys.argv
CAM = args[0] if args else '192.168.137.123:8080'
PORT = int(args[1]) if len(args) > 1 else 8001
REUSE_S = 10      # reuse the last board position this long when markers are hidden
SAVE_DIR = next((x.split('=', 1)[1] for x in sys.argv if x.startswith('--save=')), None)   # save each analysed picture here
REF_AFTER = next((float(x.split('=')[1]) for x in sys.argv if x.startswith('--ref-after=')), None)   # take the reference automatically after N s

B = json.load(open('/data/project/vision/board.json'))
A, C, W_ = B['area_mm'], B['cell_mm'], B['divider_mm']
inset = (B['marker_mm'] - B['marker_black_mm']) / 2
k = B['marker_black_mm']
R_BALL = B['ball_mm'] / 2
RULE = B['decision_rule']
BLACK = set(B['black_cells'])
STILL_MM, STILL_S = 5.0, 2.0          # "stationary": touching point within 5 mm for 2 s (spec 8.3); 3 mm was too tight for detection jitter

params = cv2.aruco.DetectorParameters()
params.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_SUBPIX
params.minMarkerPerimeterRate = 0.01
det = cv2.aruco.ArucoDetector(cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50), params)
_sq = lambda x0, y0: np.float32([[x0, y0], [x0 + k, y0], [x0 + k, y0 + k], [x0, y0 + k]])
_far = A - inset - k
REGION = {(0, 0): (_sq(inset, inset), 0), (0, 1): (_sq(_far, inset), 1),
          (1, 1): (_sq(_far, _far), 2), (1, 0): (_sq(inset, _far), 3)}
CELLS = [(r * 4 + c + 1, c * (C + W_), r * (C + W_)) for r in range(4) for c in range(4)]
M_, S = 60, 3        # search 60 mm past the edge: a raised ball at a corner can hang far over it
N = int((A + 2 * M_) * S)
T = np.array([[S, 0, M_ * S], [0, S, M_ * S], [0, 0, 1]], float)


LAYOUT_FILE = '/data/project/vision/layout.json'
layout = {}          # marker id -> (board corner key, rotation): a property of the BOARD, saved once
try:
    for i, v in json.load(open(LAYOUT_FILE))['markers'].items():
        layout[int(i)] = (tuple(v['corner']), v['roll'])
except FileNotFoundError:
    pass
last_pose = {'pose': None, 'time': 0.0}


def _solve(src, dst, shape):
    src, dst = np.float32(src), np.float32(dst)
    H, _ = cv2.findHomography(src, dst)
    h, w = shape[:2]
    f = 0.75 * w
    K = np.array([[f, 0, w / 2], [0, f, h / 2], [0, 0, 1]])
    _, rvec, tvec = cv2.solvePnP(np.hstack([dst, np.zeros((len(dst), 1), np.float32)]), src, K, None,
                                 flags=cv2.SOLVEPNP_IPPE)
    R, _ = cv2.Rodrigues(rvec)
    cam = (-R.T @ tvec).ravel()
    cam[2] = abs(cam[2])
    return H, cam


def board_pose(img):
    """Returns ((H, cam), markers_seen, how) or (None, markers_seen, why)."""
    corners, ids, _ = det.detectMarkers(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))
    found = {} if ids is None else {int(i): c.reshape(4, 2) for c, i in zip(corners, ids.ravel())}
    n = len(found)
    if n == 4:
        # learn (or refresh) which id is in which corner and how it is turned
        pts = np.array([p.mean(0) for p in found.values()])
        centre = (pts.min(0) + pts.max(0)) / 2
        new, used = {}, set()
        for i, p in found.items():
            dx, dy = p.mean(0) - centre
            key = (0 if dy < 0 else 1, 0 if dx < 0 else 1)
            used.add(key)
            o = int(np.argmax(((p - centre) ** 2).sum(1)))
            new[i] = (key, o - REGION[key][1])
        if len(used) == 4 and not layout:          # first time only: learn and save
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
            src += list(np.roll(p, -roll, axis=0)); dst += list(REGION[key][0])
        pose = _solve(src, dst, img.shape)
        cam = pose[1]
        angle = np.degrees(np.arctan2(cam[2], np.linalg.norm(cam[:2] - A / 2)))
        if cam[2] < 80 or angle < 20:     # impossible camera position: the markers seen can't locate the board
            return None, n, f'{n} markers, but the board position makes no sense (camera moved? board out of view?)'
        last_pose.update(pose=pose, time=time.time())
        return pose, n, 'markers' if n == 4 else f'{n} markers (rest worked out from these)'
    if last_pose['pose'] is not None and time.time() - last_pose['time'] < REUSE_S:
        return last_pose['pose'], n, f'{n} markers: using last board position'
    if not layout:
        return None, n, 'show all 4 markers once so their corners can be learned'
    return None, n, f'only {n} marker(s) visible'


def straighten(img, H):
    return cv2.warpPerspective(cv2.GaussianBlur(img, (5, 5), 0), T @ H, (N, N))


def colour_share(P):
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
    if on_board > 0:                      # edge rule: only the part over the board counts
        share = {c: v / on_board for c, v in share.items()}
    win = max(share, key=share.get)
    lose = 'YELLOW' if win == 'BLACK' else 'BLACK'
    return win, share[win], share[lose], best[1]


state = {'ref': None, 'jpg': None, 'status': {}, 'track': [], 'lock': threading.Lock(), 'want_ref': False}


def analyse(img):
    st = {'time': time.strftime('%H:%M:%S')}
    vis = img.copy()
    pose, n, how = board_pose(img)
    st['markers'] = n
    st['board'] = how
    if pose is None:
        st['result'] = 'BOARD NOT FOUND'
        st['detail'] = how
        return vis, st
    H, cam = pose
    Hinv = np.linalg.inv(H)
    horiz = np.linalg.norm(cam[:2] - A / 2)
    st['angle'] = round(float(np.degrees(np.arctan2(cam[2], horiz))))
    st['height_cm'] = round(float(cam[2] / 10))
    for cell, x0, y0 in CELLS:
        q = cv2.perspectiveTransform(np.float32([[x0, y0], [x0 + C, y0], [x0 + C, y0 + C], [x0, y0 + C]]).reshape(-1, 1, 2), Hinv)
        cv2.polylines(vis, [q.astype(np.int32)], True, (0, 255, 0), 1)
        ctr = q.reshape(-1, 2).mean(0)
        cv2.putText(vis, str(cell), (int(ctr[0]) - 8, int(ctr[1]) + 6), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 0, 255), 2)
    state['last_raw'] = img
    def judge(ic):
        """ic: blob outline in camera pixels -> (score, x, y, rad, G) or None"""
        ic = cv2.convexHull(ic.reshape(-1, 1, 2))           # fill bites (shine spot, partly hidden ball)
        a, p = cv2.contourArea(ic), cv2.arcLength(ic, True)
        if p == 0 or a < 150:
            return None
        (x, y), rad = cv2.minEnclosingCircle(ic)
        circ = 4 * np.pi * a / p ** 2
        G = cv2.perspectiveTransform(np.float32([[[x, y]]]), H).ravel()
        q = cv2.perspectiveTransform(np.float32([[[G[0] - R_BALL, G[1]], [G[0] + R_BALL, G[1]]]]), Hinv).reshape(2, 2)
        exp_r = np.linalg.norm(q[0] - q[1]) / 2
        size = rad / exp_r
        if circ < 0.45 or not 0.5 < size < 2.2:
            return None
        return (circ * min(size, 1 / size) * a, x, y, rad, G)

    # The ball is painted green and nothing else in view is green: find it by colour, in this
    # picture alone (no empty-board reference needed, camera movement doesn't matter).
    hsv = cv2.cvtColor(cv2.GaussianBlur(img, (5, 5), 0), cv2.COLOR_BGR2HSV)
    hb = B['ball_hsv']
    green = cv2.inRange(hsv, (hb['h_min'], hb['s_min'], hb['v_min']), (hb['h_max'], 255, 255))
    poly = cv2.perspectiveTransform(np.float32([[-M_, -M_], [A + M_, -M_], [A + M_, A + M_], [-M_, A + M_]]).reshape(-1, 1, 2), Hinv)
    area = np.zeros(img.shape[:2], np.uint8)
    cv2.fillPoly(area, [poly.astype(np.int32)], 255)
    green &= area
    green = cv2.morphologyEx(green, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
    green = cv2.morphologyEx(green, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15)))
    cnts, _ = cv2.findContours(green, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cand = [c for c in (judge(cnt.astype(np.float32)) for cnt in cnts) if c]
    st['found_by'] = 'green colour'
    if len(cand) > 1:
        st['note'] = f'{len(cand)} green blobs: picked the biggest round one'
        cand = [max(cand, key=lambda c: c[0])]
    now = time.time()
    if not cand:
        state['track'].clear()
        st['result'] = 'NO BALL'
        return vis, st
    _, x, y, rad, G = cand[0]
    P = G + (cam[:2] - G) * (R_BALL / cam[2])
    if not (0 <= P[0] <= A and 0 <= P[1] <= A):
        st['edge'] = True                 # edge rule: just outside the edge -> nearest point on the board
        P = np.clip(P, 0, A)
    win, ws, ls, cell = colour_share(P)
    ok = ws - ls >= RULE['min_lead']
    st['shares'] = f'{win} {ws*100:.0f}% vs {ls*100:.0f}%'
    st['cell'] = cell
    if ok:
        st['result'] = win
    else:
        st['result'] = 'INVALID'
        st['detail'] = 'too close to call (on a stick or corner)'
    # 2-second stillness: keep a short history of touching points
    tr = state['track']
    tr.append((now, P))
    while tr and now - tr[0][0] > STILL_S + 1:
        tr.pop(0)
    recent = [p for t, p in tr if now - t <= STILL_S]
    span = tr[-1][0] - tr[0][0] if len(tr) > 1 else 0
    still = span >= STILL_S and max(np.linalg.norm(p - P) for p in recent) < STILL_MM
    st['still'] = bool(still)
    col = (0, 255, 0) if ok else (0, 0, 255)
    cv2.circle(vis, (int(x), int(y)), int(rad), col, 4 if still else 2)
    pp = cv2.perspectiveTransform(np.float32([[P]]), Hinv).ravel()
    cv2.circle(vis, (int(pp[0]), int(pp[1])), 6, (255, 0, 255), -1)
    return vis, st


def worker():
    while True:
        try:
            data = urllib.request.urlopen(f'http://{CAM}/shot.jpg', timeout=3).read()
            img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
            vis, st = analyse(img)
            if SAVE_DIR:
                import os
                os.makedirs(SAVE_DIR, exist_ok=True)
                label = st.get('result', '') + (f" cell {st['cell']}" if st.get('cell') else '') + (' STILL' if st.get('still') else '')
                cv2.putText(vis, f"{st['time']} {label} {st.get('shares', '')} {st.get('detail', '')}", (10, 40),
                            cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 0, 255), 3)
                cv2.imwrite(f"{SAVE_DIR}/{st['time'].replace(':', '')}.jpg", cv2.resize(vis, (640, 360)), [cv2.IMWRITE_JPEG_QUALITY, 70])
        except Exception as e:
            vis, st = None, {'result': 'CAMERA ERROR', 'detail': str(e)[:120], 'time': time.strftime('%H:%M:%S')}
        with state['lock']:
            if vis is not None:
                h, w = vis.shape[:2]
                if w > 960:
                    vis = cv2.resize(vis, (960, int(h * 960 / w)))
                state['jpg'] = cv2.imencode('.jpg', vis, [cv2.IMWRITE_JPEG_QUALITY, 70])[1].tobytes()
            state['status'] = st
        time.sleep(0.05)


PAGE = b"""<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vision check</title><style>
body{margin:0;font:16px system-ui;background:#111;color:#eee}
header{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;padding:10px 12px;background:#000}
#res{font-size:1.6rem;font-weight:800;padding:4px 14px;border-radius:8px;background:#444}
#res.BLACK{background:#000;color:#fff;outline:2px solid #fff}#res.YELLOW{background:#f5c518;color:#000}
#res.INVALID,#res.BOARD{background:#b3261e}#res.still{box-shadow:0 0 0 4px #2ecc71}
#info{padding:6px 12px;color:#ccc}img{width:100%;display:block}
button{font:inherit;font-weight:700;padding:10px 14px;border:0;border-radius:8px;background:#f5c518;color:#000}
</style></head><body>
<header><span id="res">...</span><span><button id="dbg" style="background:#555;color:#fff">Save for Claude</button></span></header>
<div id="info"></div><img id="img" alt="camera">
<script>
const $=id=>document.getElementById(id);
async function tick(){
  try{
    const s=await (await fetch('/status.json',{cache:'no-store'})).json();
    const r=s.result||'';
    $('res').textContent=r+(s.cell?' (cell '+s.cell+')':'')+(s.still?'  \\u2713 still 2 s':'');
    $('res').className=r.split(' ')[0]+(s.still?' still':'');
    $('info').textContent=[s.time,s.markers!=null?s.markers+'/4 markers':'',s.angle!=null?s.angle+'\\u00b0 down':'',
      s.height_cm!=null?s.height_cm+' cm high':'',s.shares||'',s.detail||''].filter(Boolean).join(' \\u00b7 ');
    $('img').src='/frame.jpg?t='+Date.now();
  }catch(e){$('info').textContent='checker not reachable'}
  setTimeout(tick,400);
}
$('dbg').onclick=async()=>{await fetch('/debug',{method:'POST'});$('dbg').textContent='Saved';setTimeout(()=>$('dbg').textContent='Save for Claude',1500);};
tick();
</script></body></html>"""


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, body, ctype):
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith('/frame.jpg'):
            with state['lock']:
                body = state['jpg'] or b''
            self.send(body, 'image/jpeg')
        elif self.path.startswith('/status.json'):
            with state['lock']:
                body = json.dumps(state['status']).encode()
            self.send(body, 'application/json')
        else:
            self.send(PAGE, 'text/html; charset=utf-8')

    def do_POST(self):
        if self.path == '/debug':
            import os
            d = '/data/project/vision/debug'; os.makedirs(d, exist_ok=True)
            stamp = time.strftime('%H%M%S')
            if state.get('ref_raw') is not None: cv2.imwrite(f'{d}/{stamp}_ref.jpg', state['ref_raw'])
            if state.get('last_raw') is not None: cv2.imwrite(f'{d}/{stamp}_now.jpg', state['last_raw'])
            with state['lock']: json.dump(state['status'], open(f'{d}/{stamp}_status.json', 'w'))
            self.send(b'{"ok":true}', 'application/json')
        elif self.path == '/reference':
            state['want_ref'] = True
            self.send(b'{"ok":true}', 'application/json')
        else:
            self.send_error(404)


def text_mode():
    threading.Thread(target=worker, daemon=True).start()
    def wait_enter():
        while True:
            if sys.stdin.readline() == '':      # input closed (not a real terminal): stop listening
                return
            state['want_ref'] = True
            print('>>> reference will be taken from the next frame (board must be empty)', flush=True)
    threading.Thread(target=wait_enter, daemon=True).start()
    print(f'Vision check (text): camera {CAM}. Finds the GREEN ball by colour (no reference needed). Ctrl+C to stop.', flush=True)
    if REF_AFTER is not None:
        def auto_ref():
            time.sleep(REF_AFTER)
            state['want_ref'] = True
            print('>>> taking the empty-board reference now', flush=True)
        threading.Thread(target=auto_ref, daemon=True).start()
    last = None
    while True:
        time.sleep(0.5)
        with state['lock']:
            st = dict(state['status'])
        if not st or st.get('time') == last:
            continue
        last = st.get('time')
        parts = [st.get('time', ''), st.get('result', '')]
        if st.get('cell'): parts[-1] += f" (cell {st['cell']})"
        if st.get('still'): parts[-1] += '  STILL 2s'
        for key in ('shares', 'detail'):
            if st.get(key): parts.append(st[key])
        if st.get('markers') is not None: parts.append(f"{st['markers']}/4 markers")
        if st.get('board') and 'markers' != st.get('board'): parts.append(st['board'])
        if st.get('angle') is not None: parts.append(f"{st['angle']} deg, {st['height_cm']} cm")
        print(' | '.join(parts), flush=True)


if __name__ == '__main__':
    if TEXT:
        try:
            text_mode()
        except KeyboardInterrupt:
            print()
        sys.exit(0)
    threading.Thread(target=worker, daemon=True).start()
    print(f'Vision check running: camera {CAM}, open http://<pi-ip>:{PORT}/  (Ctrl+C to stop)')
    ThreadingHTTPServer(('0.0.0.0', PORT), Handler).serve_forever()
