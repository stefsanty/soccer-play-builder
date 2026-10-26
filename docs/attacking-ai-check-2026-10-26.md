# Attacking AI — before / after check on the production build (v0.42.0)

- Date: 2026-10-26
- Spec: `docs/attacking-ai-spec.md` · PRs #31 (engine, v0.41.0) and #32 (builder, v0.42.0)
- Before: production at v0.41.0 (engine merged, builder unchanged) · After: production at v0.42.0, deployment `dpl_He8PTUTLgMM3mHbs1f64FhjxyFWy`
- Driver: Playwright, 375×812, touch, dice pinned so the ball is kept; one command per turn. Screenshots in `docs/attacking-ai-assets-2026-10-26/`.

## The scenario

Default 4-4-2, RCM kicks off at (43, 34).

| Turn | The one command | Before (v0.41.0) | After (v0.42.0) |
|---|---|---|---|
| 1 | RCM dribbles to (47, 49) | Ten teammates stay where they are. Two ✓/× suggestion chips on the pitch. | 9 teammates move (dotted arrows): defence up 8 m (LB 10,28 · LCB 30,26 · RCB 48,26 · RB 63,28), LM holds width at x = 10 and goes to 48, LCM to (29, 45), RM pushes on down the line to (62, 54) as the wide outlet, RST runs beyond to (45, 61), LST to (30, 58). No chips. |
| 2 | RCM passes to RST | Nobody moves. Pass risk 21%. | RST stays on the pass target (45, 61). LST makes the third-man run to (33, 68), LCM offers the angle underneath at (34, 53), RM goes on to (62, 63), RCM pass-and-moves to (51, 53), the defence steps up to 34–36. Pass risk 34% (the defenders had reacted to turn 1's movers). |

Status line while planning: "9 teammates move with the plan (dotted) — tap one to command him instead". Rewind and forward work; no console errors; the counter reads Turn 3/6 after the two turns.

| Before | After |
|---|---|
| `before-1-dribble-planned.png` | `after-1-dribble-planned.png` |
| `before-2-dribble-resolved.png` | `after-2-dribble-resolved.png` |
| `before-4-pass-resolved.png` | `after-3-pass-planned.png`, `after-4-pass-resolved.png` |

## What to look at

1. The block keeps its 4-4-2 shape while it moves: lines 10–15 m apart, far-side winger on the touchline, defence never past halfway + 5.
2. The support cast is role-aware: a forward runs beyond, a midfielder offers the angle, the winger stays wide instead of tucking in.
3. The turn's length still comes from the user's action only. A 13 m pass is a 1.6 s turn, so the runs in turn 2 are shorter (≤ 9.6 m) than in the 3.3 s dribble turn.

## Open points (also under "Choices to review" on PR #32)

- Ten dotted arrows at once are readable on a phone but busy; a toggle or "3 nearest the ball" is a one-line change.
- The passer's automatic pass-and-move replaces the last ✓/× suggestion; Stefan may prefer the passer frozen.
- Tuning constants live at the top of `src/lib/engine/teamShape.ts`.
