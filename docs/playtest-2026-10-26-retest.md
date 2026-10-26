# Playtest retest — Turn Builder (/builder)

- Date: 2026-10-26 (same day as the first playtest)
- Version: v0.36.0 (commit 5d3f3ef) — after PRs #16, #17, #18, #19, #20; a second retest the same day on the production build v0.40.1 is at the top
- Tester: Claude (expert game tester / game designer role)
- Device: mobile viewport 375×812, Next.js dev server, Chromium (Playwright), real pointer taps
- Objective: the same as before — pass the ball around the opponents and score in the enemy goal.
- Compared against: `docs/playtest-2026-10-26.md` (v0.32.1)

## Second retest — production build, v0.40.1

- Date: 2026-10-26, later the same day
- Build: production at https://soccer-play-builder.vercel.app — v0.40.0 (commit 51084da) for the game, v0.40.1 (commit ee176df) for the library check
- After PRs #23 (queue chips), #24 (undo / trash confirm), #25 (pass range), #26 (dev badge), #27 (reopen a saved game), #28 (win condition), #29 (saved games public)
- Tester: Claude (expert game tester role), same objective: pass the ball around the opponents and score
- Device: mobile viewport 375×812, Chromium with touch emulation, real pointer taps (Playwright). Screenshots in `docs/playtest-assets-2026-10-26-retest2/`

### Result

**Goal with the last shot of the last turn.** The game now has a clock: "Turn 1/6". LST was intercepted once, dribbled into the box, had three shots saved from 10 m (55%, 33%, 55%), and scored in turn 6 of 6. The GOAL! banner came first, then a YOU SCORED card; "Play on" took the counter to a plain "Turn 7" (`10-a-end-card.png`).

- **33 taps, 0 mis-taps.** Every player tap selected the player; every pitch tap queued the action.
- **No console errors** in any of the three sessions.
- **One bug found and fixed in the same session:** a saved game did not appear in the library (`01-c-library-card.png`, v0.40.0). The builder saved games as private and the library lists public plays only. Fixed in #29; on v0.40.1 the card shows with a "Turn Builder" tag and reopens the game (`01-c2-library-card.png`, `02-c2-reopened-from-library.png`).

### The follow-up items, one by one

| # | Item (first retest) | Now | Status |
|---|---|---|---|
| 8 | Queue chips overflowed at 375 px | Five actions queued: five chips in two rows, all inside the box (`scrollHeight == clientHeight == 54`), labels "RCM→RST 0%", "LST run". Pitch box `0,48,375,519` before and after (`01-a-five-chips.png`). | **Fixed** (#23) |
| 9 | Dependents deleted silently; trash cleared instantly | Removing RST→LST: "Removed RST→LST and 1 action that needed it — Undo"; Undo restored all five. Trash: first tap "Clear 5?", second tap cleared (`02-a-undo-toast.png`, `03-a-trash-confirm.png`). | **Fixed** (#24) |
| 10 | Pass rules invisible | GK selected: a white dashed "pass range" arc joins the blue movement disc; LM (no ball) selected: no pass disc (`01-b-pass-range.png`). No teammate is ever out of the 63 m range in a 4-4-2, so the dimming never showed. | **Fixed** (#25), range still generous |
| obs 4 | Dev badge on the Rewind button | Production never had it; the dev build no longer shows it (`devIndicators: false`). The bottom-left button now takes real taps in dev. | **Fixed** (#26) |
| obs 7 | Saved game could not be reopened in /builder | Save → `/builder/<id>`: "Turn 2/6", history 3/3, "Reopened — 1 turn played, 0 goals", RST holds the ball, LM stands where his run ended, Rewind shows "Turn 1, action 1/2: RCM → RST" (`02-c-reopened.png`). | **Fixed** (#27 + #29) |
| next 4 | No win condition | "Turn 1/6" counter, "Last turn — score now, or rewind and replan" on turn 6, YOU SCORED card after the goal. The OUT OF TURNS card (Rewind and replan / New game) was checked on the dev build; the live game scored before it could show. | **Done** (#28), rule under review |
| 7 | Disabled buttons look enabled | Unchanged: `disabled` at opacity 0.4, no nudge on tap. | Open (minor) |

### New observations

1. **A lingering banner swallows the first tap.** SAVED, INTERCEPTED and TACKLED banners stay about 3 s after the turn and cover the pitch; a player tap in that window closes the banner and does nothing else. The script learned to tap the banner away first, as a player would, but it costs a tap every turn. GOAL! says "tap to carry on" by design; the others could pass the tap through or fade sooner.
2. **The defence does not press a carrier in its own box.** LST stood 10 m from goal for three turns with only the keeper near him; the back four held their line around the halfway mark (`08-a-after-turn5.png`). Three saves kept it honest, but a real block would have closed him down.
3. **Shot chances read right**: 55% from 10 m straight on, 33% when a defender stood on the line. Three saves then a goal is fair dice; the clock made each miss matter.
4. **The game as a whole now has a shape**: plan → risk → turn clock → result card. With six turns, a turn-1 interception (23% risk) left five turns to recover; it still felt possible.
5. **Suggestion chips still crowd the midfield** (first-retest observation 1, unchanged): two ✓ and two × chips sit on the opposing LCM and LB when no queue exists.
6. **Accessibility**: 7 focusable controls on the page (was 5: the queue's remove buttons and the end card add some); players are still SVG groups without roles.

### What was played (session A, live dice)

- Turn 1 (5 actions): RCM→RST (0%), RST→LST (0%), LST run, RM run, LST→RM through ball (23%). **Intercepted by opp RST.** Ball back to LST.
- Turn 2: LST dribbles 20 m toward goal (1%). Kept.
- Turn 3: LST dribbles 20 m (32%) and shoots (55%). **SAVED.** Ball back to LST, 10 m out.
- Turn 4: LST shoots (33%, a defender on the line). **SAVED.**
- Turn 5: LST shoots (55%). **SAVED.** Status: "Last turn — score now, or rewind and replan".
- Turn 6: LST shoots (55%). **GOAL!** Score 1. YOU SCORED card: "Goal in turn 6 of 6." Play on → "Turn 7".
- Session B: pass range disc on GK, none on LM. Session C: save, reopen by id, rewind, delete the test row. Session C2 (v0.40.1): save, find the card in the library, tap it, game reopened; test row deleted.

### Suggested next steps

1. **Banners should not eat taps**: close SAVED / INTERCEPTED / TACKLED on the turn's end plus 1.5 s, or let the first tap pass through to the pitch.
2. **Press the carrier in the box**: raise the defensive AI's aggressiveness when the ball is inside the area, so three free shots from 10 m do not happen.
3. **Decide the rule** (`TURN_LIMIT = 6` in `src/lib/engine/builderGame.ts`): six felt right for one attack; four would make the interception in turn 1 hurt.
4. **Pass range**: 63 m is never binding in a 4-4-2. Lower `ACTION_MAX_S` for passes, or draw the disc only when it cuts someone off.
5. **Hide the AI suggestion chips while a queue exists** (first-retest idea), or move them off the opposing players.
6. **Accessibility**: give players `role="button"` and an accessible name.
7. **Real phone**: the only environment problems left are gone from the dev build; a run on a physical phone over mobile data is the next honest test.

---

## First retest — dev build, v0.36.0

### Result

**Did the tester reach the goal? Yes — and this time the game knows it.**

- Goal in **turn 5** with **11 queued actions**. A 60% shot from the top of the box beat the keeper. The game showed a GOAL! banner with confetti and the score chip went to ⚽ 1 (`14-turn5-banner.png`, `15-after-goal.png`).
- The attack was no longer free. Turn 1's 52% through ball was **intercepted** by the opposing LST (`04-turn1-banner.png`). Turn 3's 50% cross was intercepted by the opposing LM. Each time the ball came back to the passer and play went on, as Stefan chose ("no cost — the % is advice").
- **Zero mis-taps in the whole session.** Eleven player taps and eight pitch taps all landed where intended. The first playtest had three mis-taps in ten actions.
- No JavaScript console errors.

Note on method: a first run of this retest had the dice pinned by a leftover test hook (every shot "saved", no interceptions). It was thrown away and the session was replayed in a clean tab with live dice. The numbers above are from the clean run.

### The ten issues, one by one

| # | Was | Now | Status |
|---|-----|-----|--------|
| 1 | No goal, no shot. Carrier stood in the net, game started Turn 5. | Ball over the line scores: GOAL! banner, confetti, ⚽ score chip. Carrier taps the lit-up goal to shoot; "Goal 60%" chip on the arrow; keeper save chance; SAVED banner on a miss. | **Fixed** (PR #16, #17) |
| 2 | Back arrow lost 3 turns instantly. No save anywhere. | Back arrow asks "Leave the Turn Builder? This game is not saved and will be lost." Reload / close also warn. A ✓ Save button in the header stores the game as a play (title "Turn Builder — 26 Oct 2026, 02:06", setup step + one step per turn). No prompt after saving. | **Fixed** (PR #20) |
| 3 | Defenders never won the ball. | Every pass and dribble shows a risk % on its arrow and in the queue chip; the dangerous defender wears a red ring. Play rolls the dice: two of three risky passes this session were cut out (52%, 50%). The ball returns to the passer (chosen design). | **Fixed** (PR #18) |
| 4 | Pitch shrank when the queue or timeline appeared; taps missed. | Pitch box measured `0,48,375,535` in setup, with an empty queue, with five actions queued, and after a resolved turn. It never moved. | **Fixed** (PR #19) |
| 5 | A marking defender covered the carrier; pixel-hunting to select him. | Holder draws on top, bigger tap target. Every holder tap this session selected him on the first try, including LST with two defenders on him. | **Fixed** (PR #19) |
| 6 | Ten suggestion arrows with 9×11 px ✓/× glyphs, GK micro-runs. | Two suggestions on entering planning (RST, LCM). ✓/× chips measure 44×44 px and sit off the players. No GK run. | **Fixed** (PR #19) |
| 7 | Buttons looked enabled but ignored taps. | "Start planning" before picking a carrier and "Play" with an empty queue are `disabled` at opacity 0.4. No nudge on tap, but they no longer look active. | **Unchanged**, lower impact than reported (the disabled style was already there) |
| 8 | Queue chips overflow off-screen at 375 px. | Still true: with five actions queued the third chip reads "3 LST ru…" and the rest are hidden (`04-turn1-banner.png`). The new risk % badge makes each chip wider. | **Open** (MINOR) |
| 9 | Deleting one action silently deletes its dependents; trash clears instantly. | Unchanged by code: `sanitizeQueue` still drops dependents without a message; the trash button cleared the queue with no confirm. | **Open** (MINOR) |
| 10 | Pass rules invisible; too-far passes refused, too-far runs capped. | Unchanged. A pass range disc is still not drawn. (A 62 m pass was accepted this session, so the 63 m limit is generous; the asymmetry stands.) | **Open** (MINOR) |

### New observations

1. **Risk chips crowd the midfield.** With five actions queued, the "52%" chip on the through ball sits on the opposing LST's label and the two ✓ suggestion chips cover LCM (`03-turn1-queued.png`). Readable, but busy. Idea: hide the suggestion chips while a queue exists, or offset risk chips to the empty side of the arrow.
2. **Risk is honest but can feel harsh when it repeats.** 52% then 50% interceptions in three turns is fair dice, yet without a cost the lesson is only "that pass was risky". The chosen no-cost rule keeps sessions moving; a "score within N turns" goal (first report, next step 4) would give the risk teeth.
3. **Keeper save chance reads well.** 17% from 17 m out, 52–60% from the penalty-spot area. The goal target label ("Shoot · 53%") updates as the carrier moves, which made "dribble closer, then shoot" an obvious plan.
4. **Dev-only, still blocking:** the Next.js dev badge sits exactly on the Rewind button at 375 px (`19-dev-badge-on-rewind.png`). A real tap on Rewind opens the dev menu; the retest had to trigger Rewind by script. Same as the first report. Move the rewind cluster up, or hide the badge in dev (`devIndicators: false` in `next.config.ts`).
5. **Flash toasts** still appear at the top of the pitch, far from the thumb (`03-turn1-queued.png`: "Max range — RM runs 21m toward it").
6. **Accessibility unchanged:** 5 focusable controls on the page; players are SVG groups without roles.
7. **A saved game cannot be reopened in /builder.** It appears in the library and opens in the editor viewer. Dribble-only turns show no ball holder there (the viewer derives the holder from passes).

### What was played (clean run)

- Turn 1 (5 actions): RCM→RST (0%), RST→LST (0%), LST run between the strikers, RM max-range run up the right (21 m cap, toast shown), LST→RM through ball (52%). **Intercepted by opp LST.** Ball back to LST.
- Turn 2 (2 actions): LST→RM (7%), RM run. Kept. RM holds on the right wing.
- Turn 3 (2 actions): RM→LST cross (50%), LST run to the box. **Intercepted by opp LM.** Ball back to RM.
- Turn 4 (2 actions): RM→LST (0%), LST run to the box. Kept. LST at the top of the box.
- Turn 5 (1 action): LST shoots, "Goal 60%". **GOAL!** Score 1. Ball back to LST.
- Then, on a second short game (LB starts, one turn played): the back arrow asked before leaving while unsaved; Save sent a play with 2 steps and the setup ball at LB; the back arrow did not ask after saving; rewind to kick-off; "Replan from here" (turn counter back to 1); the trash cleared the queue instantly with no confirm; Preview showed "Previewing — nothing is committed" and returned to planning with the queue intact.

Screenshots for the clean run are in `docs/playtest-assets-2026-10-26-retest/` (01–19 in session order; 09–15 cover turns 3–5).

### Suggested next steps

1. **Chip row overflow (issue 8):** wrap the queue into two rows or show "+N" with a tap to expand; shorten chips to "RCM→RST 0%".
2. **Undo snackbar (issue 9):** "Removed 2 dependent actions — Undo", and a confirm on the trash button.
3. **Pass range disc (issue 10):** draw the 63 m pass range when the carrier is selected, in a second colour.
4. **Win condition:** "Score within 6 turns" with an end card. This is what gives the risk % consequences without a turnover.
5. **Hide the dev badge or move Rewind** so the dev build can be tested on a phone.
6. **Reopen a saved game in /builder** (load the play, rebuild history from its steps).
7. Re-test on a production build on a real phone; the dev badge and dev-mode compile stalls were the only environment problems left.
