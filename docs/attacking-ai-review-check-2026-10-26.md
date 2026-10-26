# Attacking AI — review fixes checked on the production build (v0.42.1)

- Date: 2026-10-26
- Spec: `docs/attacking-ai-spec.md` §7 · PR #34 (engine, v0.42.1), merge `34ec8a0`
- Before: production at v0.42.0 (deployment `dpl_Bu3audAqHQUvHxqiCK35xLhbug6n`) · After: v0.42.1 (deployment `dpl_32gfsyaRYGVJHd7R8m3AKTcBX2GJ`)
- Driver: Playwright, 375×812, touch, dice pinned so the ball is kept; one command per turn. Screenshots in `docs/attacking-ai-review-assets-2026-10-26/`.

## The scenario

Default 4-4-2, RCM kicks off at (43, 34). The one command is an **off-ball run**: LM runs down the line to (6, 50). The ball stays with RCM, who has no action of his own.

| Turn | The one command | Before (v0.42.0) | After (v0.42.1) |
|---|---|---|---|
| 1 | LM runs to (6, 50) | 7 teammates move. **RCM, the ball carrier, is one of them**: the AI gives him a "support" arrow and Play takes him and the ball to (34, 29), 10 m back and left, with no dribble queued and no risk %. | 7 teammates move. RCM stays on the ball at (43, 34). LCM takes the angle underneath at (34, 29); RM pushes on as the wide outlet; the back line slides 3 m toward the ball. |
| 2 | RCM passes back to RCB | 5 move; RST ends at (46, 47). | 5 move; the forwards hold their height (RST 45, 47 · LST 33, 47), LCM sits at (29, 34). |

No console errors on either build; the counter reads Turn 3/6 after the two turns.

| Before | After |
|---|---|
| `before-1-lm-run-planned.png` (RCM has a dotted arrow) | `after-1-lm-run-planned.png` (no arrow on the carrier) |
| `before-2-lm-run-resolved.png` (ball at 34, 29) | `after-2-lm-run-resolved.png` (ball still at 43, 34) |
| `before-3-pass-back-planned.png`, `before-4-pass-back-resolved.png` | `after-3-pass-back-planned.png`, `after-4-pass-back-resolved.png` |

The other three review rules (run beyond never drops a forward, support jobs drop at most 5 m, forwards hold on a pass back) are covered by the unit scenarios in `src/lib/engine/teamShape.review.test.ts`; they need a deep carrier or a high block, which takes several turns to reach at phone size.
