# Research: Landing Page Demo Videos (LIRA-303)

Every decision below was checked against the repo or the tools on this Mac on 2026-10-10, unless marked
"Assumption".

## R1. Which tool makes the video

- **Decision:** `/brag`. On Opus 5.5 it hands over to `/brag-slim`, which builds the whole video itself (a
  browser composition rendered frame by frame, music written in code, ffmpeg to join). The earlier video was
  made this way.
- **Rationale:** `brag-output/work/` already holds a working pipeline: `comp.html` (each frame is a pure
  function of time, `window.render(t)`), `render.mjs` (Playwright screenshots of every frame) and `music.py`
  (pure-Python soundtrack). Reusing it keeps the look and the music family, and avoids Hyperframes setup.
- **Output folder:** `brag-output/` already exists, so the skill writes to a timestamped
  `brag-output-YYYY-MM-DD-HHmmss/`. The old folder stays as the reference. Both are git-ignored through
  `.git/info/exclude` (verified for `brag-output/`; the timestamped name must be added there too).
- **Alternatives:** the full `/brag` with Hyperframes (more setup, nothing gained here); a screen recording
  (needs a person to drive it, and is harder to keep under the size budget).

## R2. Where the screens come from

- **Decision:** Playwright screenshots of the **web app** at 1920×1080, signed in to the owner's seeded test shop.
  Shots are taken at the exact moments each scene needs (an empty form, the form filled, the result).
- **Rationale:** the earlier `shots/` were taken the same way. The screens are real; only the data is made up.
- **Where the test shop lives:** the owner names it at capture time. It is either a shop on the live web app
  (`https://<shop>.liratek.shop`) or a local web app (`yarn dev:web`). Both work the same for Playwright.
  Sign-in details are typed at capture time and are never written into the repo or the output folder.
- **Desktop:** this Mac does not run the desktop app (owner rule), and the desktop app uses the same React
  screens. The desktop scene puts web screenshots inside a drawn desktop window frame.

## R3. Which screens, and which currencies they show

Routes verified in `frontend/src/app/App.tsx`:

| Scene | Route | Currencies on screen |
|---|---|---|
| POS | `/pos` | USD total with its LBP amount (the earlier video showed "$33.00 ≈ 2,970,000 LBP") |
| OMT / Whish services | `/services` (the transfer form; `/omt-whish` is the OMT/Whish area) | USD amount and fee; the payment box shows the LBP equivalent |
| Mobile recharge | `/recharge` | MTC / Alfa price in LBP and USD |
| Loto | `/loto` | LBP only (owner, 2026-10-10) |

- **Assumption (unverified):** the exact place each page shows the second currency. The capture step checks
  each one on screen before the shot is kept (quickstart step 3).

## R4. Desktop window frame

- **Decision:** a Windows 11 style window drawn in the composition: a thin title bar with the LiraTek icon,
  the title "LiraTek", and minimise / maximise / close buttons; no menu bar.
- **Rationale:** the desktop app ships for Windows (JSON-LD `operatingSystem: "Web, Windows"`), and its main
  window uses `autoHideMenuBar: true` (`electron-app/main.ts:128`), so no menu bar shows.
- **Content rule:** inside the frame, only screens that exist in the current desktop release. The POS screen
  qualifies. Warranty and drawer-count screens do not (they reach desktop in the next update).

## R5. Length and size budget

- **Earlier encode (ffprobe):** H.264 1920×1080 30 fps at about 708 kbit/s, AAC at about 166 kbit/s, 884 kbit/s
  in total, 21 s, 2.2 MB.
- **New length:** about 29 s (hook 3, logo 3, 4 scenes of about 4, desktop about 4, outro 3).
- **Math:** at the old rates, 29 s × 884 kbit/s = 25.6 Mbit ≈ 3.2 MB, which is over the 3 MB budget (SC-003).
  With audio at 96 kbit/s and video at about 700 kbit/s: 29 × 796 = 23.1 Mbit ≈ 2.9 MB.
- **Loudness:** about −16 LUFS integrated, peaks ≤ −1 dBTP, measured with ffmpeg `ebur128`.
- **Decision:** audio at 96 kbit/s AAC stereo; video quality tuned (constant-quality, slow preset) until the
  file is ≤ 3 MB, checked with `ls -l` after the render. Calm shots with little motion compress well.

## R6. Poster

- **Decision:** the settled hook frame is frame 0 and the poster (spec FR-010). This overrides the slim skill's
  "strongest settled frame" rule, because a later frame baked in as frame 0 jumps to the hook one frame later.
  The outro's last 0.5 s fades into the same frame, so the loop is seamless. From it, make `poster.webp`
  (the page's first paint, ≤ 25 KB) and `poster.jpg` (the fallback).
- **Earlier:** `poster.webp` was 15 KB; the page preloads it (`<link rel="preload" … poster.webp?v=3>`).
- **Cache-busting:** bump `?v=` on the preload link, the `poster` attribute and the `<source>` of the video, on
  both `index.html` and `ar.html` (spec FR-014). Today: poster `?v=3`, video `?v=2`.

## R7. Brand and music

- **Colours:** violet `#d4adfc`, blue `#518cff`, navy `#0c134f` / `#020222`. The earlier `comp.html` hard-codes
  the old greens (`#10b981`, `#6ee7b7`, `#a7f3d0`, `rgba(16,185,129,…)`) and the old logo tile; all of them
  are replaced. Green inside a real product screen (a module colour) stays: it is the product.
- **Logo:** `mobile/assets/brand/liratek-logo.png` / `liratek-swirl.png` (already copied to `landing/assets/`).
- **Fonts:** Inter for English, IBM Plex Sans Arabic for the Arabic lines (both already used by the landing).
- **Music:** keep the earlier style (A minor, soft pad, plucked arpeggio, light kick), re-timed to about 29 s.
  `music.py` takes the length as a constant.

## R8. Release notes and gates

- **Release notes:** none — owner decision 2026-10-10. (Precedent was split: the earlier video's commit
  `6c4c2ca0` added a line, the rebrand `5f9c29b9` did not.)
- **Quality gates:** owner-approved exception 2026-10-10 — local `yarn lint` + `yarn typecheck`; the full gate
  set runs in CI on push and must be green before LIRA-303 is done.
- **Code gates:** the change touches only `landing/` (media files and two `?v=` numbers per page). No
  TypeScript, no tests, no core. `yarn lint` / `yarn typecheck` are not affected, and are still run before
  commit as the standing rule.
