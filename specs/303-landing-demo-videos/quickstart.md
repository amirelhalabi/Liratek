# Quickstart: Landing Page Demo Videos (LIRA-303)

How to build the new hero video and prove it meets the spec. Run from the repo root.

## Prerequisites

- The owner says the test shop is seeded (see [data-model.md §1](data-model.md)) and gives its address and a
  sign-in for capture. Sign-in details stay out of the repo and the output folder.
- Playwright Chromium (already installed), ffmpeg (`/opt/homebrew/bin/ffmpeg`), Python 3.
- The earlier pipeline in `brag-output/work/` (`comp.html`, `render.mjs`, `music.py`).

## 1. Start the run

- Run `/brag` with the storyboard from [data-model.md §2](data-model.md) as direction: landscape, about 29 s,
  the new brand, the earlier music style.
- Add the timestamped output folder to `.git/info/exclude`, next to `brag-output/`.

## 2. Capture the screens

- Sign in to the test shop at 1920×1080 and take the shots each scene needs (empty, filled, result).
- **Check:** each shot's top bar shows the made-up user and shop; no real names or phones anywhere.

## 3. Check the currencies on each shot

- POS, OMT / Whish, Recharge: a dollar amount and its LBP amount are both visible.
- Loto: LBP only.
- **Expected:** every product scene passes before the composition is built.

## 4. Build and check stills

- Render stills from every scene and from mid-transition (the slim skill's rule).
- **Check:** no overflow, no collisions, readable text, Arabic lines right-to-left and complete.

## 5. Render and measure

```bash
ffprobe -v error -show_entries format=duration,bit_rate -of compact brag-output-*/brag.mp4
ls -l brag-output-*/brag.mp4 brag-output-*/brag.jpg
```

- **Expected:** duration about 29 s; file ≤ 3 MB. If larger, raise the quality number and render again.

## 6. Frame-by-frame brand and privacy check (SC-001, SC-002)

```bash
ffmpeg -loglevel error -i brag-output-*/brag.mp4 -vf fps=2,scale=480:-1 /tmp/lira303-check/f%03d.png
```

- Look at every frame (about 58). **Expected:** no old logo, no green brand accent, no real data.
- The owner signs off on the same set before the files go into `landing/`.

## 7. Put it on the page

- Make `poster.webp` (≤ 25 KB) and `poster.jpg` from the poster frame; copy `brag.mp4` to
  `landing/assets/demo.mp4`.
- Bump `?v=` as in [contracts/landing-hero-media.md](contracts/landing-hero-media.md), on both pages.
- `npx serve landing -l 5050`, then open `/` and `/ar`:
  - poster shows first, video plays muted and loops;
  - the sound button restarts the video with music;
  - with reduce motion on (browser setting or Playwright `reducedMotion: "reduce"`), only the poster shows.

## 8. Ship

- Nothing is committed until the owner says "commit". Pushing to `main` deploys the landing page together with
  everything else on `main`.
