// Ball-position formation table — the RoboCup 2D (HELIOS / agent2d) "formation" idea.
//
// The in-possession shape is DATA: for a set of sample ball positions the table says where each of
// the ten outfield roles of the 4-4-2 stands. For any other ball position the spots are interpolated
// inside the triangle of samples around the ball (barycentric weights). agent2d triangulates
// hand-placed samples with Delaunay; ours sit on a regular grid, which split into two triangles per
// cell is already a Delaunay triangulation, so no library is needed. Retuning the shape means editing
// numbers here, not rules.
//
// Coordinates are [x, depth] for the attacking team: x 0..68 left to right as it attacks, depth 0 at
// its own goal line, 105 at the opponent's. The right-touchline column is the left one mirrored.

type Pt = [number, number]

export const ROLES = ['LB', 'LCB', 'RCB', 'RB', 'LM', 'LCM', 'RCM', 'RM', 'LST', 'RST'] as const
export type Role = (typeof ROLES)[number]

const W = 68
/** Sample ball depths (rows) and ball x (columns: left touchline, centre, right touchline). */
export const TABLE_DEPTHS = [10, 25, 40, 55, 70, 85, 100]
export const TABLE_XS = [6, 34, 62]

// One row per sample depth, roles in ROLES order:
//         LB        LCB       RCB       RB        LM        LCM       RCM       RM        LST       RST
/** Ball in the centre. The back line follows the ball at about two thirds and stops near 57 m (rest
 *  defence); the lines stay 10–16 m apart; the full-backs push on once the ball is in the other half. */
const CENTRE: Pt[][] = [
  [[4, 22], [18, 9], [50, 9], [64, 22], [6, 38], [27, 26], [41, 26], [62, 38], [26, 50], [42, 50]],
  [[6, 32], [22, 19], [46, 19], [62, 32], [7, 48], [27, 36], [41, 36], [61, 48], [27, 58], [41, 58]],
  [[7, 44], [24, 29], [44, 29], [61, 44], [7, 58], [27, 46], [41, 46], [61, 58], [27, 66], [41, 66]],
  [[8, 56], [25, 39], [43, 39], [60, 56], [7, 68], [27, 56], [41, 56], [61, 68], [28, 76], [40, 76]],
  [[8, 66], [26, 47], [42, 47], [60, 66], [6, 80], [28, 64], [40, 62], [62, 80], [28, 86], [40, 86]],
  [[9, 72], [27, 53], [41, 53], [59, 72], [6, 88], [28, 72], [40, 70], [62, 88], [29, 94], [39, 94]],
  [[10, 76], [28, 57], [40, 57], [58, 76], [8, 94], [28, 80], [40, 78], [60, 94], [30, 98], [38, 98]],
]
/** Ball on the left touchline. The block slides across; the left-back sits under the ball, the far
 *  full-back tucks in, the far winger keeps the width (x ≥ 54). */
const LEFT: Pt[][] = [
  [[4, 16], [14, 8], [32, 9], [50, 18], [5, 32], [18, 24], [34, 26], [54, 40], [20, 48], [36, 50]],
  [[6, 22], [16, 18], [32, 19], [50, 26], [5, 42], [18, 34], [33, 35], [54, 46], [21, 56], [37, 56]],
  [[8, 33], [17, 28], [33, 28], [49, 36], [5, 54], [19, 44], [33, 44], [55, 56], [22, 64], [37, 64]],
  [[8, 46], [18, 38], [33, 38], [48, 46], [5, 66], [19, 54], [33, 54], [56, 66], [22, 74], [37, 74]],
  [[8, 58], [19, 46], [34, 46], [48, 54], [5, 78], [20, 62], [34, 62], [57, 78], [22, 84], [38, 84]],
  [[9, 66], [20, 52], [34, 52], [48, 58], [5, 86], [20, 72], [34, 70], [57, 86], [22, 92], [38, 92]],
  [[10, 72], [21, 55], [35, 55], [48, 60], [6, 92], [20, 80], [34, 78], [56, 92], [22, 98], [36, 98]],
]
const MIRROR: Record<Role, Role> = { LB: 'RB', LCB: 'RCB', RCB: 'LCB', RB: 'LB', LM: 'RM', LCM: 'RCM', RCM: 'LCM', RM: 'LM', LST: 'RST', RST: 'LST' }

/** The 4-4-2 kick-off spots the table is written for (engine/defaultPlay), as [x, depth]. */
export const TABLE_HOMES: Record<Role, Pt> = {
  LB: [10, 20], LCB: [25, 18], RCB: [43, 18], RB: [58, 20],
  LM: [10, 36], LCM: [25, 34], RCM: [43, 34], RM: [58, 36],
  LST: [26, 47], RST: [42, 47],
}

function sample(col: number, row: number): Record<Role, Pt> {
  const out = {} as Record<Role, Pt>
  if (col === 2) {
    // the right column is the left one seen in a mirror
    ROLES.forEach((r, i) => {
      const p = LEFT[row][i]
      out[MIRROR[r]] = [W - p[0], p[1]]
    })
    return out
  }
  const rows = col === 0 ? LEFT : CENTRE
  ROLES.forEach((r, i) => (out[r] = rows[row][i]))
  return out
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
/** The cell index i with grid[i] ≤ v ≤ grid[i + 1], and how far along it v is. */
function cell(grid: number[], v: number): [number, number] {
  const c = clamp(v, grid[0], grid[grid.length - 1])
  let i = 0
  while (i < grid.length - 2 && c > grid[i + 1]) i++
  return [i, (c - grid[i]) / (grid[i + 1] - grid[i])]
}

/** Every role's spot for a ball at `ball` ([x, depth]): linear inside the triangle of samples around it. */
export function tableSlots(ball: Pt): Record<Role, Pt> {
  const [ci, u] = cell(TABLE_XS, ball[0])
  const [ri, v] = cell(TABLE_DEPTHS, ball[1])
  const p00 = sample(ci, ri)
  const p10 = sample(ci + 1, ri)
  const p01 = sample(ci, ri + 1)
  const p11 = sample(ci + 1, ri + 1)
  // each grid cell is two triangles, split on the p10–p01 diagonal
  const lower = u + v <= 1
  const out = {} as Record<Role, Pt>
  for (const r of ROLES) {
    const at = (k: 0 | 1) =>
      lower
        ? p00[r][k] + u * (p10[r][k] - p00[r][k]) + v * (p01[r][k] - p00[r][k])
        : p11[r][k] + (1 - u) * (p01[r][k] - p11[r][k]) + (1 - v) * (p10[r][k] - p11[r][k])
    out[r] = [at(0), at(1)]
  }
  return out
}

/** The table role a player fills: his label when it is a 4-4-2 role, else the role whose kick-off spot is
 *  nearest his own (so a 4-3-3 or a renamed player still gets a slot). `home` is [x, depth]. */
export function roleFor(label: string, home: Pt): Role {
  if ((ROLES as readonly string[]).includes(label)) return label as Role
  let best: Role = ROLES[0]
  let bestD = Infinity
  for (const r of ROLES) {
    const d = Math.hypot(TABLE_HOMES[r][0] - home[0], TABLE_HOMES[r][1] - home[1])
    if (d < bestD) {
      bestD = d
      best = r
    }
  }
  return best
}
