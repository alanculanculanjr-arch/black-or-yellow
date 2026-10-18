# ADR-001: How the camera decides which color the ball landed on

**Status:** Proposed (updated 2026-10-15: ArUco markers instead of manual corners; owner's colour-share and edge rules; **green ball**)
**Date:** 2026-10-14
**Deciders:** Project group (owner), with the banker as final authority per round (spec 9)

## Context

After each DROP the system must name the winning color within 10 s, from an overhead
Android phone streaming 640×480 MJPEG to a Raspberry Pi 5 (spec 6, 8).

Fixed by the spec:
- **Find the ball's position, then look up the cell's color** (spec 8.1). Reading the color
  under the ball directly is a superseded idea (spec 37).
- One light-colored ball on a 4×4 checkerboard with low dividers; normal room light (6.2-6.3).
- Ball must be still for **2 uninterrupted seconds**; give up after **10 s** (8.3-8.4).
- Touching a divider is fine if the ball is clearly in one cell; balanced on a divider or
  ambiguous = invalid (8.5-8.6).
- Lightweight: ~2.9 GB free, no big ML models, no video recording (2.1, 6.5, 33.8).
- The banker always confirms or corrects before payout (9), so the camera only needs to be
  right or to say "not sure". **A confident wrong answer is the worst outcome**; "invalid,
  retry" is acceptable.

Measured on the real board (first test, 2026-10-14):
- Ball: pale cream (HSV S≈37, V≈184), ~66 px across after straightening to 400×400 (≈⅓ of a cell).
- Yellow cells: strongly saturated (S≈240). Black cells: dark (V≈40). Easy to tell apart.
- **Wooden dividers are almost the same color as the ball** (S≈50, V≈180). Only their thin
  shape separates them.
- **Glossy yellow paint has white glare patches** that look like small pale blobs.
- **The camera or board moved between and during captures**, so a fixed calibration was
  wrong for most frames.
- A simple "pale + bright, then remove thin shapes, keep the round blob" prototype found the
  ball in most frames where the board was where calibration expected it.

## Decision

Use a **layered classical-vision pipeline** (Option C below), all in OpenCV in one persistent
Python worker:

1. **Board finding with ArUco markers (no manual corner tapping)** *(updated 2026-10-15)*:
   four printed 22.5 mm ArUco markers (DICT_4X4_50, ids 0-3) lie flat inside the four corner
   cells, tucked into the outer corners: 0 in cell 1, 1 in cell 4, 2 in cell 16, 3 in cell 13.
   Every DROP-time reference frame finds all 4 markers and computes the board's position from
   their 16 corners, so a moved camera or a tilted board is handled automatically. A marker's
   corner farthest from the board center is its outer corner, so gluing it rotated doesn't matter.
   Geometry is in `vision/board.json`: cells 45 mm, dividers 3.1 mm, playing area 189.3 mm.
   The board is straightened to a top-down image and the 16 cell rectangles come from that
   geometry, with the dividers excluded. Spec 7.3's "test ball in a known cell" stays as a quick
   check before a session. A ball on a marker counts as that cell's color.
2. **Fresh reference at every DROP:** just before the trapdoor opens, grab one frame of the
   (empty) board. It has the same lighting and glare as the frames that follow seconds later.
3. **Find the ball as "what changed AND looks like the ball":**
   - difference from the fresh reference (glare, dividers, paint marks all cancel out), and
   - pale + bright color (separates the ball from its own shadow, which also "changed"), and
   - round blob of the expected size (±35%), which rejects hands, crumbs and shadows.
4. **Still check:** track the ball center at ~10 fps in board coordinates. "Still" = it stays
   within 3 px (≈1% of the board) of where the 2-second window started; any larger move restarts
   the window. No result within 10 s = TIMEOUT.
5. **Color by share, with a lead (owner's rule, updated 2026-10-15):** take the ball's 30 mm
   footprint around its corrected touching point, and add up how much of it lies on BLACK cells
   and on YELLOW cells (dividers count for neither).
   - The bigger color wins if it leads the other by **at least 20 percentage points**.
   - **Edge rule (owner, 2026-10-15, overrides spec 8.6):** there is no "off the board" result. Only the
     part of the footprint over the board counts, and a touching point just outside the edge is moved
     onto the nearest edge. A ball at the edge counts as the cell it rests against.
   - **Movement-tolerant comparison** (added 2026-10-15): the empty reference and each frame are both
     straightened with their own markers before comparing, so a camera that shifts slightly still works.
   - Otherwise → **INVALID**: the ball is balanced on a stick or a 4-way corner (spec 8.5).
   - Side-by-side cells are always opposite colors, so this is exactly "which color is it really on".
   - No ball found, ball outside the board, or more than one ball-like blob → **INVALID**.
   - Tested on 60 angled photos: far fewer INVALIDs than the earlier "75% in one cell" rule,
     and still INVALID for a ball sitting on a stick.
5b. **Angled camera:** the camera's position is calculated from the markers (solvePnP); the ball's
   center is 15 mm above the board, so its touching point is corrected along the camera ray
   before step 5. The ball is found by its **cream** color in the original camera picture, which
   separates it from marker paper (pure white) and yellow cells. A ball sitting on a marker is
   therefore still found.
6. **Color = fixed lookup** of the cell number (BLACK 1,3,6,8,9,11,14,16; YELLOW the rest).
   180° board rotation doesn't change any cell's color, so orientation errors can't flip the result.
7. **Board-visible check:** if any of the 4 markers isn't found in the DROP-time reference
   (covered, out of view, too blurry) → don't guess; tell the banker which marker is missing.
   As an extra check, sample the 12 unmarked cells' colors against the expected checkerboard.
8. **Snapshot for the banker:** final frame with the grid and ball circle drawn, kept in memory
   only (spec 6.4-6.5).

## Update 2026-10-15: GREEN BALL (owner decision, changes spec 3.3 "white or light-colored ball")

Under changing white balance the white ball matched the marker paper exactly (S≈7), and white/cream
also matched bare wood, shine and skin, which caused misses and false balls. The owner painted the
ball green. On camera it is H 45-75, S 119-206, V 115-207; an empty board has under 25 green pixels.
The ball is now found **by colour in each picture on its own**: no empty-board reference, camera
movement doesn't matter, and an empty board gives NO BALL. Shape (filled outline ≥ 0.45 round) and
size (0.5-2.2× the expected 30 mm ball) still apply; the height correction, colour-share rule
and edge rule are unchanged.

## Options Considered

### Option A: Pale-color threshold + shape filter (current prototype)
| Dimension | Assessment |
|---|---|
| Complexity | Low |
| Cost | ~2 ms/frame on the Pi 5, no extra installs |
| Robustness | Medium: dividers and glare are ball-colored; depends on fixed thresholds |
| Team familiarity | High (already working) |

**Pros:** simple, fast, already proven on the real board.
**Cons:** glare patches and divider crossings make false blobs; thresholds drift with room light.

### Option B: Difference from an empty-board reference only
| Dimension | Assessment |
|---|---|
| Complexity | Low |
| Cost | ~2 ms/frame |
| Robustness | High for static clutter (glare, dividers, paint); weak if lighting changes since the reference |
| Team familiarity | Medium |

**Pros:** glare and dividers cancel out completely.
**Cons:** the ball's **shadow** also shows up as a change; a reference from calibration time can be
stale (lights switched, sun moved). Hands or people's shadows also "change".

### Option C: Layered: fresh reference at each DROP + color + shape + size (**chosen**)
| Dimension | Assessment |
|---|---|
| Complexity | Medium (≈200 lines of Python) |
| Cost | ~5 ms/frame, well within 10 fps; no new packages, no storage |
| Robustness | High: each layer removes what the others miss |
| Team familiarity | Medium; each layer is a few OpenCV calls |

**Pros:** taking the reference seconds before the drop removes lighting drift; color removes the
shadow; shape and size remove hands and crumbs; the margin rule turns doubt into INVALID instead of a
wrong color.
**Cons:** needs the board empty and hands out of view at DROP time (true by game design: betting is
closed and the banker presses a button); needs the release platform to be outside the straightened
board area, or masked out.

### Option D: Hough circle detection
| Dimension | Assessment |
|---|---|
| Complexity | Low |
| Cost | ~5-10 ms/frame |
| Robustness | Low-medium: the 4×4 grid's straight edges and corners produce many false circles; sensitive to parameters |
| Team familiarity | Medium |

**Pros:** finds round things directly.
**Cons:** checkerboards are a worst case for edge-based circle finding. Useful at most as an extra check.

### Option E: Machine-learning detector (e.g. a small YOLO model)
| Dimension | Assessment |
|---|---|
| Complexity | High (data collection, labeling, training, conversion) |
| Cost | 10-100+ MB of model and runtime, 50-200 ms/frame on the Pi CPU |
| Robustness | Potentially high, but only with hundreds of labeled photos of this board |
| Team familiarity | Low |

**Pros:** handles odd lighting once trained.
**Cons:** goes against the "lightweight, no large ML models" requirement (2.1, 33.8); a lot of work for
one ball on a fixed board; failures are hard to explain to the banker.

### Option F: Read the color under/around the ball directly
Rejected: superseded by spec 37 ("detect ball position and map cell to color"). The ball also hides
the color it sits on, and glare makes yellow look white.

## Trade-off Analysis

The problem is narrow: one known object, one fixed board, a fixed camera and a human checking every
result. That favors simple, explainable classical vision over learned models. The two real enemies
seen in testing are **things that look like the ball** (dividers, glare) and **things that change the
picture** (lighting, camera bumps). Color alone loses to the first; a stale reference loses to the
second. Taking the reference at DROP time plus requiring "changed AND pale AND round AND right size"
beats both at almost no cost.

Being cautious near dividers will sometimes give INVALID for a landing a person would call. That is
the intended trade: the banker can RETRY SCAN or RETRY DROP, while a wrong confident color would
pay the wrong players (though the banker can still correct it).

## Consequences

- **Easier:** works under normal room light with no extra hardware; easy to show the banker why
  (snapshot with circle and grid); the same code serves calibration's "test ball" step.
- **Harder:** the camera and board **must be fixed** (tape, clamp or stand). The board-moved check
  catches bumps but can't fix them.
- **Physical requirements for the group:**
  - the trapdoor and platform should sit outside the camera's view of the board, or be masked;
  - no bright objects resting on the board;
  - matte paint would reduce glare, but isn't required.
- **To revisit:** the 15% divider cut-off and the 3 px stillness limit, after recording real drops;
  whether 640×480 is enough on the final board; the fairness trials of spec 38.11.

## Action Items

1. [ ] Group: fix phone and board in place; check the release platform is outside the board view.
2. [ ] Re-run the 7-position photo test with nothing moving; label the frames.
3. [ ] Build the Python vision worker (persistent; JSON messages over stdin/stdout to Node, spec 38.6).
4. [ ] Calibration screen on the banker page: tap 4 corners → grid overlay → test ball → save.
5. [ ] Tune the divider cut-off and stillness limit on the labeled frames; target **0 wrong colors**,
       with clear landings ≥ 95% valid.
6. [ ] Add the board-moved check and the banker snapshot; swap the simulated camera for the real one.
7. [ ] Run 50+ real drops; record valid/invalid/corrected counts and the BLACK/YELLOW split (spec 38.11).
