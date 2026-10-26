# Attacking AI — third pass checked on the production build (v0.42.2)

- Date: 2026-10-26
- Spec: `docs/attacking-ai-spec.md` §7 row R5 · PR #36 (engine, v0.42.2), merge `108e444`
- Before: v0.42.1 (the same code production served as deployment `dpl_GdGLFKMvHa7G2cf8aEbUpuA9x8ed`, run on a local dev build because production had already moved on) · After: production at v0.42.2 (deployment `dpl_5qgpLLLywrMV1PTRFkH4tZFsozxk`)
- Driver: Playwright, 375×812, touch, dice pinned so the ball is kept; one command per turn. Screenshots in `docs/attacking-ai-third-assets-2026-10-26/`. Script: `ai-check3.mjs` (the same harness as the earlier checks).

## The probe

Ten more single commands were run through the solver and every teammate's move printed: a commanded forward run (RST), sideways dribbles to both touchlines, a pass out wide (RCM → RM), a long pass to the far forward, three consecutive turns (dribble, dribble, pass), a full-back dribbling up the line, a striker dribbling, a central midfielder's forward run and a full-back's run up the line. Nine read as good football: the block lifts and slides, two angles form, the ball-side winger pushes on, one forward runs beyond, a wide carrier gets an overlap, the passer moves after his pass, three stay behind the ball. One did not:

**RCM dribbles sideways to the touchline.** RB overlaps from 25 m behind and cannot get past the carrier inside the turn. The 18 m move cap and the touchline bound undid the spacing push, so he could end 3 m from the carrier. Now a free player who started outside a user-placed teammate's space (7 m) never ends inside it: his move is cut back along his own path to the point where it first comes that close. He arrives at the carrier's shoulder instead of running into him.

## The scenario at phone size

Default 4-4-2, RCM kicks off at (43, 34). Turn 1, the one command: **RCM dribbles sideways to the right touchline, (60, 38)**. Turn 2: RCM passes to RB.

| Turn | The one command | Before (v0.42.1) | After (v0.42.2) |
|---|---|---|---|
| 1 | RCM dribbles to (60, 38) | 8 teammates move: the back line slides 9 m toward the ball, RM pushes on as the wide outlet (64, 44), RST stays the depth (47, 50). **RB overlaps to (64, 34): 5.7 m from the carrier, on his shoulder.** | The same 8 jobs. **RB overlaps to (63, 32): 7 m outside the carrier**, a pass away. |
| 2 | RCM passes to RB | 3 move; RCM pass-and-move to (57, 32). | 5 move; RCM pass-and-move to (57, 32); LM and LCM re-form on the ball side. |

No console errors on either build; the counter reads Turn 3/6 after the two turns.

| Before | After |
|---|---|
| `before-1-side-dribble-planned.png` (RB's dotted arrow ends beside the ball) | `after-1-side-dribble-planned.png` (RB's arrow ends 7 m short) |
| `before-2-side-dribble-resolved.png` (RB touching the carrier) | `after-2-side-dribble-resolved.png` (RB a clear step outside and behind) |
| `before-3-pass-to-rb-planned.png`, `before-4-pass-to-rb-resolved.png` | `after-3-pass-to-rb-planned.png`, `after-4-pass-to-rb-resolved.png` |

The tappable tap closest to the bad case is (60, 38): a tap at (60, 36), where the solver gave a 3 m gap, lands within 2.6 m of RM's disc and becomes a pass to him. The unit test R6 in `teamShape.review.test.ts` covers the wider gap.
