# Soccer Play Builder

An interactive web tool to create, animate, and share tactical soccer patterns of play — an **animated whiteboard for coaches**. Drag players on an SVG pitch, draw passes and runs, add step-by-step narration, preview the animation at 60fps, then save and share a link.

## Features (MVP)

- **Editor** — SVG pitch with draggable players, pass/run drawing, a step sequencer, per-step narration, and defender zone/mark rules.
- **Viewer** — public, no-auth playback of a saved play: play/pause, speed control, step navigation, synced narrative text.
- **Library** — browse public plays, filter by formation/tag/author, fork plays.
- **Animation engine** — tweened positions with trapezoid easing, pass flight animation, and simple defender AI (zone / man-mark rules), driven by a `requestAnimationFrame` loop.

## Tech stack

- [Next.js 15](https://nextjs.org) (App Router) + TypeScript (strict)
- [Tailwind CSS](https://tailwindcss.com) + [shadcn/ui](https://ui.shadcn.com)
- [Zustand](https://zustand.docs.pmnd.rs) (+ immer) for editor state
- [Supabase](https://supabase.com) — Postgres, Auth, Storage
- [Vitest](https://vitest.dev) + Testing Library for unit tests
- Deployed on [Vercel](https://vercel.com)

## Local development

```bash
npm install
cp .env.local.example .env.local   # fill in your Supabase project values
npm run dev                        # http://localhost:3000
```

### Environment variables

| Variable | Description |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase anon (public) key |

### Database (Supabase)

The app works without a database — the editor runs and a banner reads "Database not configured — plays won't be saved." Saving is disabled until you configure Supabase:

1. Create a **new** Supabase project at [supabase.com](https://supabase.com) (don't reuse another app's project).
2. In the SQL editor, run `supabase/migrations/001_initial.sql`, then `supabase/migrations/002_mvp_open_access.sql` (MVP has no auth, so 002 opens read/write to the anon key; tighten it when sign-in lands).
3. Copy **Project URL** and the **anon public** key (Project Settings → API) into `.env.local` (locally) and the Vercel project's Environment Variables (then redeploy — `NEXT_PUBLIC_*` values are inlined at build time):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`

API: `GET/POST /api/plays`, `GET/PUT/DELETE /api/plays/:id` (503 when the database isn't configured).

### Scripts

```bash
npm run dev         # dev server
npm run build       # production build
npm run typecheck   # tsc --noEmit
npm run test        # vitest run
npm run test:watch  # vitest watch mode
npm run lint        # eslint
```

## Folder structure

```
src/
  app/                  # App Router pages
    page.tsx            # home
    library/            # browse public plays
    play/[id]/          # public play viewer
    editor/             # play editor (auth required), editor/[id] edits existing
    api/plays/          # REST API: list/create + get/update/delete
  components/
    editor/             # PitchEditor, StepSequencer, NarrativePanel, toolbars…
    viewer/             # AnimatedPitch (animation engine), PlayControls, StepNarrative
    library/            # PlayCard, PlayGrid, PlayFilters
    layout/             # Header, AuthButton
    ui/                 # shadcn/ui components
  lib/
    engine/             # physics (trapezoid easing, tweens), simulator, pitch coords
    store/              # Zustand stores (editorStore, playStore)
    supabase/           # browser/server clients + session middleware
    types/              # Play data model + editor types
    api/                # typed client helpers for /api/plays
  middleware.ts         # Supabase auth middleware (gates /editor)
supabase/
  migrations/           # SQL migrations
```

## Coordinate system

Pitch coordinates are in meters: `x = 0..68`, `y = 0..105` (y=0 is our goal line). The reference half-pitch view maps `x=16..68, y=22..105` onto a `580×890` SVG viewBox at 10px/m via the `X()` / `Y()` helpers in `src/lib/engine/pitch.ts`.
