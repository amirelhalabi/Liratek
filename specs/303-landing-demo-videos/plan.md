# Implementation Plan: Landing Page Demo Videos

**Branch**: `303-landing-demo-videos` (work on `main`; no branch) | **Date**: 2026-10-10 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/303-landing-demo-videos/spec.md`

## Summary

Replace the landing page's hero video and poster, which still show the old green brand, with a ~29 s demo in
the new brand. It shows four real web-app scenes from the owner's seeded test shop (POS, OMT / Whish services,
mobile recharge, Loto), with dollars and lira on screen where the page shows them (Loto in lira only), and one
desktop scene that puts the same POS screen inside a Windows window frame. Built with `/brag` (which runs as
`/brag-slim` on Opus 5.5), reusing the earlier composition, render script and music. Only `landing/assets/`
media and the `?v=` numbers on the two pages change. A phone-app video is a later, separate deliverable.

## Technical Context

**Language/Version**: HTML/CSS/JS composition rendered in Chromium (Playwright); Python 3 for the soundtrack; ffmpeg for encoding

**Primary Dependencies**: `/brag` → `/brag-slim` skill; Playwright Chromium (installed); ffmpeg 7 (`/opt/homebrew/bin/ffmpeg`)

**Storage**: files only — `brag-output-<timestamp>/` (git-ignored) for the work; `landing/assets/` for the shipped media

**Testing**: no code tests. Validation = frame-by-frame check (2 frames/s), file-size and duration measured with `ls`/`ffprobe`, and the landing page checked in a browser (quickstart)

**Target Platform**: the landing page in desktop and phone browsers (`/` and `/ar`)

**Project Type**: marketing media for a static site

**Performance Goals**: video ≤ 3 MB, poster ≤ 25 KB; poster's first paint no more than 100 ms later than today's (Slow 4G, 375 px); soundtrack about −16 LUFS

**Constraints**: real screens only; made-up data only; no green brand accents; no Electron on this Mac; desktop frame shows only desktop-released screens; owner says "commit" before anything is committed

**Scale/Scope**: one video (8 scenes, ~29 s), one poster (webp + jpg), 3 `?v=` bumps per page

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Applies? | Status |
|---|---|---|
| I. One core, two transports | No code path changes | Pass (n/a) |
| II. Layer boundaries | No code | Pass (n/a) |
| III. Contracts defined once | No schemas | Pass (n/a) |
| IV. Money integrity | No money flow changes; capturing runs real sales in a **test** shop only | Pass |
| V. Data and security | Only a test shop is used; no real customer data in any frame; sign-in details never saved to the repo or output | Pass (enforced by quickstart steps 2 and 6) |
| VI. Testing (rule 28: run, don't argue) | Size, length and frames are measured, not assumed | Pass |
| VII. Code quality | No TypeScript change | Pass (n/a) |
| Quality Gates | **Exception (owner-approved 2026-10-10):** `landing/`-only media change, no code. Local run = `yarn lint` + `yarn typecheck`; the full gate set runs in CI on push and must be green before LIRA-303 is called done | Pass with exception |
| Delivery: release notes | No `UNRELEASED.md` line — owner decision 2026-10-10 (research R8) | Pass |
| Delivery: push deploys | Owner decides when to push; `main` already carries another session's commits | Noted |

Post-design re-check (after Phase 1): no new violations. No Complexity Tracking entries.

## Project Structure

### Documentation (this feature)

```text
specs/303-landing-demo-videos/
├── spec.md
├── plan.md                         # this file
├── research.md                     # R1–R8: tool, screens, currencies, frame, size, poster, brand, gates
├── data-model.md                   # seeding checklist for the test shop + storyboard (8 scenes)
├── quickstart.md                   # capture → build → measure → check → put on page
├── contracts/
│   └── landing-hero-media.md       # files, size limits, ?v= bumps, content rules
├── checklists/
│   └── requirements.md
└── tasks.md                        # /speckit-tasks (not yet)
```

### Source / output layout

```text
brag-output/                        # earlier run, kept as reference (git-ignored)
└── work/{comp.html, render.mjs, music.py, shots/}

brag-output-<timestamp>/            # this run (add to .git/info/exclude)
├── brag-plan.md
├── brag.mp4, brag.jpg, share-copy.txt
└── work/{comp.html, render.mjs, music.py, shots/, frames/, stills/}

landing/
├── index.html, ar.html             # only the ?v= numbers change
└── assets/{demo.mp4, poster.webp, poster.jpg}   # replaced
```

**Structure Decision**: no source code changes. The work happens in a git-ignored output folder; only the
three media files and the `?v=` numbers land in `landing/`.

## Phases after this plan

1. **Wait** for the owner's seeded test shop (blocking).
2. **Capture** the shots (quickstart 2–3).
3. **Build** with `/brag`, check stills, render (quickstart 1, 4, 5).
4. **Check** frames and size; owner signs off (quickstart 6).
5. **Put on the page** and check in a browser (quickstart 7).
6. **Phone video** — separate follow-up after the phone changes; reuses this run's colours, title style and music.

## Risks

- **Real data leaks into a frame** (for example the signed-in user's real name in the top bar). Mitigation:
  check at capture (step 2) and in the frame check (step 6); the owner signs off.
- **Over the size budget at 29 s** (old rates would give about 3.2 MB). Mitigation: audio at 96 kbit/s and a
  tuned video quality (research R5); measure after the render.
- **A feature shown inside the desktop frame is not in the desktop release.** Mitigation: the desktop scene uses
  the POS screen only.
- **The test shop lives on the live web app**: capturing records real sales in that test shop. It is the
  owner's test shop, so this is expected; nothing touches other shops.
