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
