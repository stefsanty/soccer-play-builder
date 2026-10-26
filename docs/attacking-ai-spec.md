# Attacking AI — off-ball teammates move with the user's command

Status: spec + technical design + test plan. Written 2026-10-26 for the Turn Builder (`/builder`).

## 1. The problem

In the Turn Builder the user commands one player per tap. Today the other ten attackers stand
still unless the user queues a run for each of them. The attacking AI only *suggests* two runs
(dashed green arrows with ✓/×). So a single command ("RCM dribbles 15 m up") leaves the team
frozen around him: no support angle, nobody runs beyond, the defence does not push up. The
playtests called the pitch static and the suggestion chips busy.

Stefan's ask: if the user gives one command to one player, the attacking AI reacts and moves the
rest of the team to support that player, as teammates do in Football Manager, FIFA and PES.
User commands always win.

## 2. Football principles the AI follows

These are the rules a coach teaches. Each one maps to a rule in the engine (section 4).

| Principle | What it means on the pitch | Engine rule |
|---|---|---|
| **Width** | One player near each touchline in the middle and final third, so the defence cannot stay narrow. The far-side wide player holds his width even when the block slides toward the ball. | `shift` is 0 for far-side wide players |
| **Depth** | One player ahead of the ball (a run beyond the last defender's shoulder) and options behind it. The ball should never be the most advanced point of the team. | depth run; defensive lift < 1 |
| **Support angles / triangles** | Two options near the carrier at ~45°: one beside-and-behind on each side, so he always has a safe pass and a forward pass. Never in a straight line with him. | support-angle slots |
| **Third-man run** | When the ball goes to A, a player B who is not the receiver runs so A can play him first time. | depth run picks the nearest free forward, not the receiver |
| **Overlap / underlap** | When the carrier is wide, the full-back or winger behind him runs outside (overlap) to give a wide option and drag a defender. | overlap rule |
| **Line height / block moves together** | The team moves up the pitch with the ball. Forwards and midfield follow the ball fully; the defence follows at ~60% so the gaps between lines stay small (compactness) but the back line never crosses the halfway line by much. | `lift` per line |
| **Compactness** | The three lines stay 10–15 m apart. Nobody drifts off alone. | line lift ratios + spacing |
| **Rest defence** | While attacking, at least three outfield players stay 10 m or more behind the ball, so a lost ball does not become a counter. | rest-defence rule |
| **Offside** | No run beyond the second-last defender's line. | offside cap |
| **Pass and move** | After a pass the passer offers himself again. | `pass-move`: once the ball leaves him, the passer runs beside-and-behind the receiver on the side he passed from, bounded by the time left in the turn |
| **Crash the box** | On a shot the forwards attack near post, far post and penalty spot for rebounds; the midfield holds the edge of the box for the second ball. | box slots on a shot turn |
| **Find space** | A support position inside a defender's reach is useless; the player shifts to the free side of him. | opponent clearance |
| **Do not clump** | Two attackers within 7 m take away each other's space. | spacing |

### 2.1 How the team reacts to each kind of command

| User command (one player) | Teammates' reaction |
|---|---|
| **Dribble forward** | The whole block moves up with the ball. The nearest free forward runs beyond the ball. Two near players give support angles (one underneath each side); a wide player on the ball side pushes on down the touchline instead of tucking in. If the carrier is wide, the full-back behind him overlaps. Three outfield players stay 10 m behind. |
| **Dribble back** | Nobody drops with him more than half his retreat (forwards and midfield hold the line; the defence holds). No runs beyond. The deeper players already behind him are the recycle options. |
| **Dribble sideways / no ball movement** | The block slides slightly toward the ball side; the far-side wide player keeps his width. Support angles re-form around the carrier. Nothing else moves much. |
| **Pass** | The receiver is left exactly where the ball is going (the pass is aimed at him — the AI never moves him). The team re-forms around the *receiver's* position: support angles for him, a third-man run beyond him, the block lifts to his depth. The passer moves again once his pass is away (pass and move), unless he has a later action of his own. |
| **Off-ball run** | The ball does not move, so the shape holds. The runner is the user's; the AI does not fill the space he vacated (the run is meant to open it). Support angles stay around the carrier. |
| **Shot** | Forwards crash the box slots; the midfield holds the edge of the box; the defence holds its rest-defence depth. |

### 2.2 How Football Manager, FIFA and PES do it (in my own words)

- **Football Manager**: every role has a position "relative to the ball". In possession the team
  shape is a block that slides and lifts with the ball; the role instructions decide how far a
  player strays from his slot (a "Wing-Back — Attack" overlaps; a "Deep-Lying Playmaker" sits
  underneath). Team instructions set the line height and width. Attacking runs are triggered by
  the carrier's situation: a forward makes a run in behind when the carrier faces forward with
  space; a wide player overlaps when the carrier on his side is held up. The user sets rules,
  not positions. We copy: slot per formation role, lift and shift with the ball, triggered runs.
- **FIFA (EA FC)**: teammate positioning is a weighted "support" system. Players near the ball
  look for passing options at angles to the carrier (the triangle), one striker always offers a
  run beyond (the through-ball option), full-backs overlap when the winger holds the ball. The
  block follows the ball with elasticity per position: forwards 1:1, defence much less. We copy:
  elastic lift per line, two support angles, one depth run.
- **PES / eFootball**: the "team spirit" shape is a fixed formation image dragged by the ball.
  Off-ball players move as a unit (the whole line steps up when the ball advances), and the
  user can trigger one-off runs. The strong point is that the team always looks like its
  formation. We copy: targets are formation homes plus a shared lift/shift, so the shape stays
  recognisable turn after turn.

What all three share: **the shape is anchored on the ball, moves a little each moment, and a few
players near the ball break the shape for support and runs**. That is the model below.

### 2.3 Role behaviour by formation line

Lines come from the kick-off formation (gaps of 8 m or more in home depth split the lines).
In the default 4-4-2: defence LB LCB RCB RB; midfield LM LCM RCM RM; forwards LST RST. A player is
*wide* when his home is 18 m or more from the pitch's centre line (LB, RB, LM, RM).

| Line | Lift with the ball | Side shift | Breaks shape for |
|---|---|---|---|
| Goalkeeper | never moves (excluded) | — | — |
| Defence | 60% of the ball's height above the midfield home line, capped at 5 m past halfway | 35% of the ball's offset from centre, max 10 m; far-side full-back holds width | overlap (when wide and the carrier is wide on his side), rest defence |
| Midfield | 100% | same | support angles (central), wide outlet ahead (wide), second ball on a shot |
| Forwards | 100%, capped by the offside line | same | depth run / third-man run, box slots on a shot |

## 3. What the user sees

- While planning (queue not empty): every teammate the AI will move shows a thin dotted green
  arrow from where he stands to where he will go. No chips. The arrows update as the queue
  changes. Commanding a player removes his AI arrow (the user's arrow replaces it).
- The status line says how many teammates move with the plan ("· 8 move with you").
- Preview, the timeline scrub and Play show the AI moves (they are ordinary moves in the step).
- The old ✓/× suggestion chips are gone from the builder: the moves they offered are now made by the AI, and the chips sat on the ball and the opposing midfield in both retests.
- Rewind snapshots, Replan from here, Save and reopen all work unchanged (the AI moves are
  stored in the step like any run; replay re-simulates them).

## 4. Technical design

### 4.1 Where it plugs in

```
queue (user) ──► scheduleTurn ──► TurnSchedule (plans, planned positions, length)
                                      │
                                      ▼
            planTeamShape(input) ──► SupportMove[]  (pure, deterministic)   ← NEW engine/teamShape.ts
                                      │
                                      ▼
   turnStep(queue, positions, index, outcomes, supportMoves) ──► PlayStep.moves = user moves + AI moves
                                      │
                                      ▼
                       simulateStep (defensive AI reacts to all 11 movers)
```

- `engine/teamShape.ts` (new): `planTeamShape(input): SupportMove[]` and
  `supportMovesToPlayerMoves(moves): PlayerMove[]`.
- `engine/turnBuilder.ts`: `turnStep` takes an optional fifth argument `support: PlayerMove[]`
  and appends it to `moves`. The turn's `duration` is still derived from the user's actions
  only (`scheduleTurn.length + TURN_TAIL_S`), so AI moves never make a turn longer; they are
  capped to fit inside it.
- `BuilderClient.tsx`: a `support` memo (phase plan, not in history, queue not empty) calls
  `planTeamShape`; the `draft` memo and the dice branch of `beginTurn` pass the same moves to
  `turnStep`; the pitch draws the dotted arrows; suggestions are filtered to `reason === 'support'`.
- `builderReplay.ts`: unchanged. The saved step already carries the AI moves.
- Editor / viewer: AI moves carry `hidden: true` so a saved game opened in `/editor` or `/play`
  does not draw eight extra arrows per step (the moves still play).

### 4.2 Data structures

```ts
export type SupportReason =
  | 'shape'        // block lift / shift toward the formation slot
  | 'support'      // support angle beside-and-behind the carrier
  | 'pass-move'    // the passer offers himself again once his pass is away
  | 'wide'         // wide outlet ahead of the ball on the touchline
  | 'depth'        // run beyond the ball (third man)
  | 'overlap'      // outside the wide carrier
  | 'box'          // crash the box on a shot
  | 'second-ball'  // edge of the box on a shot
  | 'rest'         // held back for rest defence

export interface SupportMove {
  playerId: string
  from: Pt
  to: Pt
  reason: SupportReason
  start: number   // 0
  end: number     // dist / MOVE_MPS, clamped to [MIN_ACTION_S, turnDuration]
}

export interface ShapeInput {
  players: { id: string; team: 'ours' | 'opp'; label: string }[]
  positions: Record<string, Pt>   // turn start
  homes: Record<string, Pt>       // kick-off formation (play.players)
  attackingTeam: 'ours' | 'opp'
  holder: string | null           // at turn start
  queue: BuilderAction[]
  schedule: TurnSchedule          // scheduleTurn(queue, positions)
}
```

### 4.3 Algorithm (per turn)

All distances in metres; `dir` = +1 when attacking toward y = 105 (ours).

1. **Frozen set.** The keeper, every player with a queued action, and every receiver of a queued
   pass. The AI never moves them during their actions. (The receiver is frozen because the pass is
   aimed at his planned spot and its risk % was computed on that lane.) One addition: a passer
   whose last queued action is his pass gets a **pass-and-move** run that starts when the pass ends
   (`(receiver.x + side·9, receiver.depth − 5)`, side = the side he passed from), capped by
   `min(18, MOVE_MPS · (turnDuration − passEnd))`. Its slot is reserved before the support cast is
   picked. The keeper never makes it.
2. **Ball story.** `ballStart` = holder's position. End carrier = `holderAfter(holder, queue)`
   (the shooter when it is null); `ballEnd` = his planned position. `advance = (ballEnd.y −
   ballStart.y) · dir`. Phase: `shot` if a shot is queued; `forward` if advance > 3; `back` if
   advance < −3; else `lateral`.
3. **Lines.** Group the attacking team's outfield players by home depth; a gap ≥ 8 m starts a
   new line. Line 0 = defence; the last line = forwards (when there are ≥ 2 lines); the rest =
   midfield. `wide` = |home.x − 34| ≥ 18, `side` = sign(home.x − 34).
4. **Shape target** for every free player:
   - `lift = max(0, ballEnd.depth − midHomeDepth)` where `midHomeDepth` is the mean home depth
     of the midfield line (the formation's "ball at home" height).
   - `target.depth = home.depth + lift · k(line)`, k = 0.6 defence, 1.0 midfield, 1.0 forwards.
     Defence is capped at halfway + 5.
   - `shift = clamp((ballEnd.x − 34) · 0.35, −10, 10)`; `target.x = home.x + shift`, except a
     far-side wide player (side ≠ ball side) keeps `home.x`.
   - Phase `back`: a forward or midfielder never drops more than half the ball's retreat
     (`target.depth ≥ current.depth − |advance| / 2`); the defence holds (`target = current`).
5. **Support cast** (overrides shape; each player gets at most one job, chosen in this order,
   skipping frozen players, players already given a job, and slots already filled within 5 m by
   a frozen player's planned position):
   - `shot` phase: forwards take the box slots nearest them: near post (34 + ballSide·8, 99),
     far post (34 − ballSide·8, 99), penalty spot (34, 94). Midfielders within 25 m of the ball
     take the edge of the box: (34 ± 10, 85). Done — no other overrides.
   - `back` phase: no support cast (the deeper players are the recycle options).
   - **Depth run** (`forward` / `lateral`): the nearest free forward to `ballEnd` runs to
     `(lerp(his.x, ballEnd.x, 0.3), ballEnd.depth + 12)`. When `ballEnd.depth ≥ 80` the run
     goes to the far-post slot instead (penalty-box behaviour).
   - **Overlap** (`forward` / `lateral`, carrier wide: |ballEnd.x − 34| ≥ 16): the free wide
     player on the carrier's side who is 5–35 m deeper than `ballEnd` runs to
     `(ballEnd.x + side·5, ballEnd.depth + 10)` (x clamped to [4, 64]).
   - **Support angles** (two): candidates are free non-forwards within 25 m of `ballEnd`,
     midfielders before defenders, nearest first. A central candidate takes the slot on his own
     side of the ball: `(ballEnd.x + side·9, ballEnd.depth − 5)` (side = sign of his x relative
     to the ball; 0 → left first). If that side's slot is taken, he takes the other side; if both are taken he
     stays on shape. A wide candidate takes the wide outlet instead: `(his shape x, ballEnd.depth + 6)`.
6. **Rest defence** (`forward` / `lateral` / `shot` when `ballEnd.depth > 52.5`): count attackers
   (frozen at their planned positions, free at their targets, keeper excluded) with
   `depth ≤ ballEnd.depth − 10`. While fewer than 3, take the free player not in the support
   cast with the smallest target depth and hold him at `min(target.depth, ballEnd.depth − 10)`;
   tag him `rest`.
7. **Constraints**, three deterministic rounds in players-array order:
   - Offside: `target.depth ≤ max(52.5, secondLastOpponentDepth − 1)`.
   - Bounds: x ∈ [4, 64], depth ∈ [3, 102].
   - Move cap: `|target − current| ≤ min(cap, MOVE_MPS · turnDuration)`, cap = 12 m for a shape or
     rest move, 18 m for a triggered run; a longer move is cut to the cap along its direction
     (still tagged with its reason).
   - Spacing: any two attackers closer than 7 m (final positions: planned for frozen, target for
     free) are pushed apart along the line between them, the free one(s) moving (half each when
     both are free).
   - Clearance: a target within 4 m of an opponent's start position steps sideways (same depth)
     until it is 4 m from him — space is found beside a defender, not past him.
8. **Deadband and timing.** Drop moves under 2.5 m. `start = 0`, `end = clamp(dist / MOVE_MPS,
   MIN_ACTION_S, turnDuration)` where `turnDuration = max(MIN_TURN_S, schedule.length + TURN_TAIL_S)`.

### 4.4 Determinism, performance, persistence

- Pure function of its input; no randomness, no clock, ties broken by players-array order.
  The same queue on the same positions always gives the same moves (Preview = Play, replay = live).
- Eleven attackers, pairwise checks, three rounds: well under a millisecond on a phone. It runs in
  a `useMemo` keyed on the queue and positions, like the existing schedule.
- The AI moves are stored in the step's `moves` (with `hidden: true`), so a saved game replays
  exactly. The step's `builder.actions` still holds only the user's actions (plans, snapshots,
  labels and chips are unchanged).

### 4.5 Interaction with the rest of the builder

- **User commands win.** A commanded player, a pass receiver and the keeper are never moved by
  the AI. Queueing a run for a player removes his AI arrow at once.
- **Risk %, shot %**: unchanged — computed from the defenders' positions at the turn start.
- **Suggestions (✓/×)**: removed from the builder. The spacing / danger-zone runs and the passer's
  pass-and-move are all made by the AI now; this also clears the chips that sat on the ball and
  the opposing midfield in the retests. `engine/attackingAI.ts` still serves the editor.
- **Dice**: when a pass is intercepted or a dribble tackled, the AI moves still happen (the
  teammates ran expecting the ball). The next turn plans from where everybody ended.
- **Snapshots**: AI movers are interpolated i/N between start and end like the defenders.
- **Preview / scrub**: the AI moves are inside the draft step, so they animate.

### 4.6 Tunables (exported constants in `engine/teamShape.ts`)

`LINE_GAP_M 8 · WIDE_M 18 · LIFT = {def 0.6, mid 1, fwd 1} · DEF_MAX_DEPTH 57.5 · SHIFT_K 0.35 ·
SHIFT_MAX 10 · SUP_SIDE 9 · SUP_BACK 5 · WIDE_AHEAD 6 · DEPTH_RUN 12 · OVERLAP_OUT 5 ·
OVERLAP_AHEAD 10 · OVERLAP_MIN/MAX_BEHIND 5/35 · CARRIER_WIDE_M 16 · BOX_DEPTH 80 · MAX_SHAPE_M 12 ·
MAX_RUN_M 18 · SPACING_M 7 · CLEAR_M 4 · DEADBAND_M 2.5 · REST_COUNT 3 · REST_BEHIND 10 ·
BACK_HOLD 0.5 · OFFSIDE_MARGIN 1 · SUPPORT_REACH 25 · SLOT_TAKEN_M 5 · PHASE_DEADBAND 3`

## 5. Test plan

### 5.1 Unit tests (`teamShape.test.ts`)

| # | Rule | Test |
|---|---|---|
| U1 | lines | 4-4-2 homes give def/mid/fwd lines; keeper excluded; LB/RB/LM/RM are wide |
| U2 | lift | ball 14 m above the midfield home line → a free forward's shape target is 14 m above his home, a defender's 8.4 m |
| U3 | shift | ball 9 m right of centre → central players shift +3.15; the left (far-side) wide player keeps his x |
| U4 | defence cap | ball at depth 90 → no defender's target beyond 57.5 |
| U5 | offside | opponent back line at 70 → no target beyond 69 |
| U6 | move cap | a 20 m shape move is cut to 12 m along the same direction |
| U7 | deadband | a 2 m move is dropped |
| U8 | spacing | two free players aimed at the same slot end ≥ 7 m apart |
| U9 | clearance | a support slot on top of a defender moves ≥ 4 m from him |
| U10 | frozen | the keeper, commanded players and pass receivers get no move |
| U11 | rest defence | with the ball at depth 70, at least 3 outfield attackers end ≥ 10 m behind it |
| U12 | determinism | same input twice → deep-equal output; the result does not depend on `Math.random` |
| U13 | timing | every move starts at 0 and ends ≤ the turn's duration; a 12 m move ends at 2 s |
| U14 | pass and move | the passer's run starts at his pass's end, heads beside-and-behind the receiver on his side; a passer with a later action of his own gets none; the keeper gets none |

### 5.2 Scenario tests (one command only, default 4-4-2, ball with RCM at (43, 34))

| # | Command | Expected teammates' behaviour |
|---|---|---|
| S1 | RCM dribbles to (43, 49) | phase forward; every free outfielder's target depth ≥ his start − 0.1; RST (nearest forward) has a `depth` move ending ≥ 10 m beyond 49; LCM has a `support` move left-and-behind the ball (x < 43, y < 49); RM has a `wide` move with x ≥ 55 and y > 49; LM keeps x ≤ 12 (width); ≥ 3 outfielders end ≤ 39; no two attackers within 5 m; all moves ≤ 12 m; GK and RCM untouched |
| S2 | RCM dribbles to (43, 24) | phase back; no `depth` / `support` moves; no forward or midfielder drops more than 5 m; no defender moves |
| S3 | LM runs to (6, 50) (ball stays) | phase lateral; LM has no AI move (commanded); the ball's support angles exist around RCM; no free player moves more than 12 m; forwards do not drop |
| S4 | RCM passes to RST | RST gets no AI move, RCM only a `pass-move`; LST has a `depth` move beyond RST's position (bounded by the short pass turn); support angles are around RST (42, 47), not around RCM |
| S5 | LST shoots from (30, 90) (positions moved up for the test) | RST has a `box` move to a post / penalty spot; a midfielder has a `second-ball` move at depth ≈ 85; no defender goes past 57.5 |
| S6 | RM dribbles wide to (62, 50) | RB (wide, same side, deeper) has an `overlap` move outside and ahead of the ball (x ≥ 62, y > 50) |
| S7 | turnStep with support | `turnStep(queue, positions, 1, {}, support)` carries the user's moves plus the AI's; its duration equals the version without support |
| S8 | simulator honours it | `simulateStep` on S1's step ends with every AI mover within 0.6 m of his target |
| S9 | replay | a game saved with AI moves replays to the same end positions |

Spec review against the tests (done before coding): every rule in 4.3 has at least one test;
S1–S6 cover the five single commands from the brief (dribble up, dribble back, wide run, pass,
shot) plus the overlap case. The receiver-frozen decision (4.3 step 1) is checked by S4.

## 6. Delivery

- PR 1 — engine: `engine/teamShape.ts` + tests + this spec. No behaviour change in the app.
- PR 2 — builder wiring: AI moves in the draft and resolved turns, dotted arrows, status count,
  ✓/× suggestion chips removed, pass-and-move automatic, before/after screenshots.
- Tuning after a production check at phone size; choices listed on each PR.

## 7. Review pass (2026-10-26, v0.42.1)

A second session probed the shipped solver with the five single commands plus build-up from the
back, a pass back from a high block and a second consecutive dribble, printing every teammate's
move. Most scenarios read as good football (block lifts, angles, outlet, run beyond, overlap).
Four did not; each is now a rule with a test in `teamShape.review.test.ts`.

| # | What the probe showed | Rule now | Test |
|---|---|---|---|
| R1 | LM runs, the ball stays with RCM: the AI moved **RCM, the carrier,** 10 m back into a "support angle" (he had no action, so he was not frozen). | The turn-start holder is frozen like a commanded player. The next midfielder takes the angle. | R1 |
| R2 | RCB dribbles 12 m / RCB passes LCB / GK passes RCB: the "run beyond" ended **behind** the forward's start (RST dropped 5–10 m), and the midfield dropped 9–10 m into the defence line. | The run beyond is skipped when the nearest forward already stands past its end (he is the depth; the shape lifts him). Any support / wide / overlap / depth job drops a player at most `MAX_JOB_DROP` = 5 m (not in a shot turn). | R2, R3 |
| R3 | Deep carrier: the support angle for LCB at (25, 18) was at depth 13, inside the back line. | With the drop cap the angle sits beside and slightly ahead (16, 29): a midfielder showing for the ball. | R3 |
| R4 | A pass back from a high block (ball 70 → 48): **all five** forwards and midfielders dropped 11 m. | Forwards drop at most `FWD_BACK_MAX` = 3 m in a 'back' turn; the midfield keeps `BACK_HOLD` (half the retreat); the defence holds. | R4 |
| R5 | RCM dribbles sideways to the right touchline (61, 38): RB overlapped from 25 m behind, could not get past the carrier inside the turn, and the move cap plus the touchline bound **undid the spacing push**: he ended 3 m from the carrier. | A free player who started outside a user-placed teammate's space (7 m) never ends inside it: his move is cut back along its own path to the point where it first comes that close (`stopShort`). He arrives at the carrier's shoulder instead of running into him. Found by a third probe (10 more single commands: a commanded forward run, sideways dribbles both ways, a pass out wide, three consecutive turns, a full-back and a striker dribbling); the other nine read as good football. | R6 |

Unchanged on purpose (choices for Stefan): no support cast in a 'back' turn (a short safe option
beside a retreating carrier, as FIFA shows, would be one more job); the second-last opponent is
read at the turn start; the keeper never moves.
