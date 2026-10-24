# Changelog Ledger

- v0.1.1: Replace Supabase edge-incompatible middleware with passthrough to fix 500 MIDDLEWARE_INVOCATION_FAILED on Vercel.
- v0.2.0 — feat: interactive SVG pitch editor (drag players, pass/run tools, step sequencer), Playwright E2E suite
- v0.3.0 — feat: animation playback engine (rAF loop, trapezoid easing, pass/run animations), preview mode with scrubable progress bar
- v0.4.0 — feat: Supabase wiring (save/load plays, library fetch), graceful no-DB degradation
- v0.5.0 — feat: dark mobile-first UI (390px phone container, teal accent, play card grid + New Play FAB, bottom toolbar/present bar, teal/red players)
- v0.5.1 — feat: New Play page (/new, title input + Create Play), desktop viewer sidebar on /play/[id] (pitch left, title + step list right)

- v0.5.2 — fix: UI rebuild — teal header, icon toolbar, full-height pitch, play card list, no spurious banners
- v0.5.3 — fix: use gen_random_uuid() in migration, add supabase/.temp to .gitignore
- v0.6.0 — feat: rebuild UI to match docs/mockups — home list with offline banner + thumbnails, striped pitch editor with step-note pill, icon toolbar and step chips, shared-play viewer with step list
- v0.6.1 — fix: penalty arcs on the pitch now meet the penalty box edge (arc endpoints were swapped)
- v0.7.0 — feat: editor interaction feedback — press/hover states, selected + pending player rings, ball marker with holder ring and "Ball: X" chip, action confirmations, haptic vibration
- v0.7.1 — fix: wire PitchEditor into /editor/[id] (was a "coming soon" placeholder); saving an existing play updates it instead of creating a copy
- v0.7.2 — feat: MVP is editor-only — home play cards open /editor/[id] directly (shared viewer /play/[id] kept for share links)
- v0.8.0 — feat: action toolbar (Move/Pass/Run) only appears once a player is selected (Escape, tap-again or tap-pitch dismisses); Edit | Play toggle in the header with playback speed 0.5x-2x
- v0.8.1 — feat: Play mode is the Edit layout with the toolbar swapped for a floating playback panel (Restart/Prev/Play-Pause/Next/speed) and the same step strip; pitch, header and step strip identical across modes
- v0.9.0 — feat: pattern-of-play engine — 60 Hz step simulator (tweens, ball carry/flight/lob, zone+mark defenders with VMAX/AMAX + separation, smooth facing, persistent rules, branch steps); Play mode renders runs, options, marks, gap, rest, offside, cone, diagonal callout; seeded "Right-side build-up: 4-5-1" (replaces Sample Play)
- v0.9.1 — fix: pass receivers can be selected and given a run (our players now draw above defenders; a run can end on another player); feat: per-run eye toggle (Runs panel, hidden:true on the move) honoured by Edit and Play; facing wedge on every player in Edit (end-of-step) and Play; dashed passing lanes in Edit and Play; sim fix: no phantom-ball facing
- v0.10.0 — feat: defensive AI — press/follow/ai rules (rules.ts), ball-depth line height, block shift, presser + cover, lane screening, keeper, offside line (ai.ts), follow exit/handoff with cooldown (follow.ts), per-step ai config {ours,opp}; seeded "Defensive AI test: 4 scenarios"
- v0.11.0 — feat: test play step 5 (OPP recycle at the back, ST drops, LW runs, oCAM follows) + defensive-AI QA fixes: possession shape (lines stay high on their own ball), no instant follow handoff for an attacker who starts outside the area, braking-aware chase (no overshoot), AI drives players until a delayed authored rule fires, no double press on an authored job, handoff receivers locked, back-line gap limiting, anticipates pass receivers, presser-change events; seed SQL now updates in place
- v0.12.0 — fix: OPP x mirrored in the test play (oRB left of oLB, 68-x) and ST to (34,88), step 2 press moved to oRB (the full-back actually nearest LW); separation only between teammates; feat: step title + text in a panel below the pitch (step tabs and a fixed-height bottom bar under it, pitch identical in Edit and Play), OPP formation ghosts with a Formation toggle
- v0.13.0 — feat: defensive AI controls — aggressiveness (press radius, gains, how many break shape), line height (blended with the ball-driven line) and width (slide cap + touchline hold), intensity kept as a Low/Mid/High quick-set; Behavior panel in Edit with per-team switch, presets/Custom and three live sliders
- v0.27.0 — feat: turn-based play builder at /builder — setup phase picks the ball carrier; queue passes/dribbles/runs (pass/dribble gated to the carrier); turns resolve simultaneously through the step simulator with the full defensive AI; per-action rewind (⏪/▶️, read-only history)
- v0.28.0 — feat: attacking AI wired into /builder — engine/attackingAI.ts suggestions (support runs, spacing, danger-zone) drawn as dashed green arrows with ✓ queue / × dismiss; queue model now lets a passer carry a support run (pass + run coexist, dribble displaces both)
- v0.28.1 — fix(builder): rewind steps now animate between states with a position indicator; pass/run paces matched to the reference viewer (18 / 6 m/s, was 40 / 15); defenders engage at reaction 0.1s with aggressiveness 70 (was 0.4s / mid)
