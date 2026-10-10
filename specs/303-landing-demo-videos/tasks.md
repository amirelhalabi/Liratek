# Tasks: Landing Page Demo Videos (LIRA-303)

**Input**: Design documents from `specs/303-landing-demo-videos/`
**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/landing-hero-media.md](contracts/landing-hero-media.md), [quickstart.md](quickstart.md)

**Tests**: no code tests (no code changes). Each story ends with measured checks instead: size and length with
`ls`/`ffprobe`, a 2-frames-per-second frame check, and the landing page checked in a browser (quickstart).

**Paths**: `$OUT` = the timestamped output folder created in T001 (for example
`brag-output-2026-10-11-101500/`). All paths are relative to the repo root.

**Owner tasks** are marked **(owner)**: nothing after them in the same chain starts until the owner says so.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 = web-app video, US2 = desktop scene, US3 = phone-video follow-up

---

## Phase 1: Setup

- [x] T001 Create `$OUT/` and `$OUT/work/` at the repo root (name `brag-output-YYYY-MM-DD-HHmmss`, generated once and reused for every path in this run), and add `$OUT/` as a new line in `.git/info/exclude` next to `brag-output/`; confirm with `git check-ignore -v $OUT`
- [x] T002 Copy the earlier pipeline into the new run: `brag-output/work/comp.html`, `render.mjs`, `music.py` → `$OUT/work/`; leave `brag-output/` untouched as the reference
- [ ] T003 **(owner)** Seed the test shop per [data-model.md §1](data-model.md) (made-up shop, exchange rate, receipt header, 8–12 products, one customer, OMT/Whish set up with a few transfers, an MTC line and an Alfa line with recharge items, Loto priced in LBP, a made-up signed-in user name), then give the shop address and a sign-in for capture. Sign-in details are typed at capture time and never written to the repo or `$OUT/`

---

## Phase 2: Foundational (blocks all stories)

- [x] T004 [P] Rebrand the composition in `$OUT/work/comp.html`: replace every old green (`#10b981`, `#6ee7b7`, `#a7f3d0`, `rgba(16,185,129,…)`, `#0d3b4a`, `#04261b`) with the brand palette (violet `#d4adfc`, blue `#518cff`, navy `#0c134f` / `#020222`); replace the old "Ⱡ" logo tile with `landing/assets/liratek-swirl.png` and the wordmark with `landing/assets/liratek-logo.png` (copy both into `$OUT/work/`); set fonts to Inter and IBM Plex Sans Arabic for `.ar` lines
- [x] T005 [P] Re-time the soundtrack in `$OUT/work/music.py`: `DUR = 29.0`, keep A minor / 112 BPM / soft pad + plucked arpeggio + light kick; move the hits and whooshes to the scene starts in [data-model.md §2](data-model.md) (0, 3, 6, 10, 14, 18, 22, 26 s); write `$OUT/work/music.wav`
- [x] T006 [P] Set `DUR = 29.0` in `$OUT/work/render.mjs`, and set its Playwright import to the path that resolves on this Mac (`/Users/amir/Desktop/docs/Liratek/node_modules/playwright/index.mjs`); dry-run `node $OUT/work/render.mjs stills 0,3` and confirm `errors []`
- [x] T007 Write `$OUT/brag-plan.md` from [data-model.md §2](data-model.md): 8 scenes, times, EN titles with AR lines, screens, actions, currencies; mark the AR lines "needs native review"

**Checkpoint**: composition shows the new brand on the hook, logo and outro stills; music is 29.0 s (`ffprobe $OUT/work/music.wav`).

---

## Phase 3: User Story 1 — A visitor sees the web app in the new brand (Priority: P1) 🎯 MVP

**Goal**: a new-brand hero video with the POS, OMT/Whish, recharge and Loto scenes, on both landing pages.

**Independent Test**: open `/` and `/ar`; the poster shows first; the video plays muted and loops; no old logo, no green brand accent, no real data in any frame; every title has its Arabic line.

### Capture (needs T003)

- [x] T008 [US1] Sign in to the test shop in Playwright at 1920×1080 and confirm the top bar shows only the made-up user and shop name; stop and report if any real name, phone, shop or email appears
- [x] T009 [US1] Capture the POS shots to `$OUT/work/shots/pos-cart.png` and `$OUT/work/shots/pos-checkout.png` (`/pos`): a cart of 2–3 items, then checkout showing the dollar total **and** its LBP amount. Run T009 → T012 one after another in one signed-in browser: each completed action (sale, transfer, ticket) becomes history on the next screen, so order matters
- [x] T010 [US1] Capture the OMT/Whish shots to `$OUT/work/shots/services-empty.png` and `$OUT/work/shots/services-filled.png` (`/services`): the transfer form empty, then filled with the amount, the fee and the total, with the LBP amount visible
- [x] T011 [US1] Capture the recharge shots to `$OUT/work/shots/recharge.png` and `$OUT/work/shots/recharge-picked.png` (`/recharge`): MTC/Alfa items, then one picked with its price in LBP **and** dollars
- [x] T012 [US1] Capture the Loto shots to `$OUT/work/shots/loto.png` and `$OUT/work/shots/loto-sold.png` (`/loto`): the ticket page, then a sold ticket with its **LBP-only** total
- [x] T013 [US1] Check every shot in `$OUT/work/shots/` against [quickstart.md step 3](quickstart.md): POS, OMT/Whish and recharge show both USD and LBP; Loto shows LBP only; no real data. Retake any shot that fails, and record the pixel boxes of the highlighted amounts in `$OUT/work/shots/boxes.json`

### Build

- [x] T014 [US1] Build scenes 1–6 and 8 in `$OUT/work/comp.html` per [data-model.md §2](data-model.md) (hook 0–3 s, logo 3–6, POS 6–10, OMT/Whish 10–14, recharge 14–18, Loto 18–22, outro 26–29); for now let scene 6 run to 26 s so the video is complete without the desktop scene; every title carries its Arabic line; the outro shows "liratek.shop" and "Talk to us on WhatsApp" / "تواصل معنا على واتساب"
- [x] T015 [US1] Render stills at the middle of every scene and at every transition (`node $OUT/work/render.mjs stills 1.5,3,4.5,6,8,10,12,14,16,18,20,24,26,27.5`), look at each one, and fix overflow, collisions, low contrast, muddy crossfades and broken right-to-left Arabic in `$OUT/work/comp.html`; re-render the stills until all pass

### Render and measure

- [x] T016 [US1] Render all frames (`node $OUT/work/render.mjs frames`) and encode `$OUT/brag.mp4` with ffmpeg: H.264 1920×1080 30 fps, `-pix_fmt yuv420p`, `-movflags +faststart`, AAC stereo at 96 kbit/s from `$OUT/work/music.wav`; then `ls -l $OUT/brag.mp4` and `ffprobe -show_entries format=duration,bit_rate`. Required: duration about 29 s and "≤ 3 MB"; if larger, lower the quality (raise CRF) and re-encode. Measure loudness with `ffmpeg -i $OUT/brag.mp4 -af ebur128=peak=true -f null -`. Required: −17 to −15 LUFS integrated, true peak ≤ −1 dBTP; if not, adjust the gain in `$OUT/work/music.py` and re-encode
- [x] T017 [US1] Take frame 0 (the settled hook frame, spec FR-010) as `$OUT/brag.jpg`, and check that `render(0)` and `render(28.9)` look the same (the outro fades into frame 0). Do not pick a later frame: FR-010 overrides the skill's "strongest settled frame" rule
- [x] T018 [US1] Run the frame check from [quickstart.md step 6](quickstart.md) (`fps=2` into a scratch folder) and look at every frame: no old logo, no green brand accent (green inside a real product screen is allowed), no real data, every title with its Arabic line
- [x] T019 [US1] **(owner)** Watch `$OUT/brag.mp4` and the frame set from T018 and sign off (spec SC-002); collect any scene changes and loop back to T014

### Put on the page

- [x] T019a [US1] Before T020 changes anything, measure today's poster: serve `npx serve landing -l 5050`, then in Playwright at 375 px with Slow 4G throttling (CDP `Network.emulateNetworkConditions`), load `/` and `/ar` 3 times each and record the median Largest Contentful Paint; write the numbers into LIRA-303 in `current_sprint.md`
- [x] T020 [US1] Make `landing/assets/poster.webp` ("≤ 25 KB") and `landing/assets/poster.jpg` ("≤ 120 KB") from `$OUT/brag.jpg`, and copy `$OUT/brag.mp4` to `landing/assets/demo.mp4`; confirm sizes with `ls -l landing/assets/`
- [x] T021 [US1] Bump the cache-busting numbers in `landing/index.html` and `landing/ar.html` per [contracts/landing-hero-media.md](contracts/landing-hero-media.md): preload link and `poster` attribute `poster.webp?v=3` → `?v=4`, `<source>` `demo.mp4?v=2` → `?v=3`; leave the "Bump ?v= here AND on the <video> together" comments in place
- [x] T022 [US1] Serve `npx serve landing -l 5050` and check `/` and `/ar` in Playwright at 1440 and 375 px: poster first; muted autoplay and loop; the sound button restarts with sound and its label switches language-correctly; with `reducedMotion: "reduce"` only the poster shows and the video does not play; no new console errors except `/_vercel/insights/script.js`

- [x] T022a [US1] After T021, repeat the T019a measurement on the new poster. Required (spec SC-004): median LCP no more than 100 ms later than T019a's, on both pages; record the numbers in LIRA-303

**Checkpoint**: US1 is shippable on its own (a 29 s video without the desktop scene).

---

## Phase 4: User Story 2 — A visitor understands there is a desktop app too (Priority: P2)

**Goal**: the computer scene (22–27 s): the POS screen in the LiraTek app window on Windows 11, then in a browser on macOS.

**Independent Test**: watch 22–27 s alone: a shop owner sees the desktop app on Windows and the web app on a Mac; only the POS screen (in the current desktop release) is inside the Windows app window; no Mac app window anywhere.

- [x] T023 [US2] Draw a Windows 11 desktop in `$OUT/work/comp.html`: soft wallpaper in brand navy/violet, centred taskbar with a start button, search, and a LiraTek icon (`liratek-swirl.png`) marked as open; the app window has a thin title bar with the LiraTek icon, "LiraTek", and minimise / maximise / close; no menu bar (the app uses `autoHideMenuBar: true`). No Microsoft logos
- [x] T024 [US2] Draw a macOS desktop in `$OUT/work/comp.html`: menu bar whose front app is the browser (never "LiraTek", since there is no Mac app), a Dock with a few generic app tiles, and a generic browser window (traffic-light buttons, address bar reading `test.liratek.shop`, no browser brand). No Apple logos
- [x] T025 [US2] Build the computer scene (22–27 s) in `$OUT/work/comp.html`: `$OUT/work/shots/pos-checkout.png` shrinks from full screen into the Windows app window (22.0–24.5), then cut to the Mac browser window with the same screen (24.5–27.0); title "Also on your computer" / "أيضاً على الكمبيوتر"
- [x] T026 [US2] Re-render stills at 22, 23.5, 24.4, 24.6, 26 and 27 s and fix collisions, unreadable text or muddy transitions in `$OUT/work/comp.html`

**Checkpoint**: the computer scene reads as Windows app + Mac browser.

---

## Phase 5: User Story 3 — A visitor sees the phone app too (Priority: P3)

**Goal**: the phone scene (27–31 s): an iPhone 17 on the sign-in page in dark mode beside a drawn Galaxy-Ultra-style phone on Home in light mode.

**Independent Test**: watch 27–31 s alone: two phones with real LiraTek phone screens; no maker logos; no real data.

- [x] T027 [US3] With the iOS simulator (iPhone 17, booted) signed out and in dark mode (`xcrun simctl ui booted appearance dark`), capture the sign-in page with `xcrun simctl io booted screenshot $OUT/work/shots/phone-login-dark.png`
- [x] T028 [US3] Sign the simulator's phone app in to the test shop, switch to light mode (`xcrun simctl ui booted appearance light`), open Home and capture `$OUT/work/shots/phone-home-light.png`; check that only made-up names and amounts show
- [x] T029 [US3] Draw both phones in `$OUT/work/comp.html`: an iPhone-17-style frame (rounded corners, Dynamic Island) holding `phone-login-dark.png`, and a Galaxy-Ultra-style frame (squarer corners, flat edges, centred punch-hole camera) holding `phone-home-light.png` with its iOS status bar covered by an Android-style one (time, signal, battery); no maker logos
- [x] T030 [US3] Build the phone scene (27–31 s): the phones slide up one after the other, side by side, title "And on your phone" / "وعلى هاتفك"; move the outro to 31–34 s (`DUR = 34.0` in `comp.html`, `render.mjs` and `music.py`, scene cuts at 27, 31); re-render stills at 27, 28.5, 30, 31 and fix issues
- [x] T031 [US3] Re-run T016 → T018 on the full composition (render, encode "≤ 3 MB", −16 LUFS, poster = frame 0, frame check), then **(owner)** sign off and re-run T019a → T022a so `landing/assets/` carries the final video
- [ ] T032 [P] [US3] Write `specs/303-landing-demo-videos/phone-video-notes.md` for the later, fuller phone video: colours, fonts, title format, transitions, music, size budget, the drawn phone frames reused from this run

---

## Phase 6: Polish & cross-cutting

- [ ] T033 [P] Send every Arabic title in `$OUT/brag-plan.md` for native review and apply corrections in `$OUT/work/comp.html` before the final render (owner or a native speaker)
- [ ] T034 [P] Write `$OUT/share-copy.txt`: 1–3 sentences, plain shop-owner language, no "excited to share"
- [x] T035 Run `yarn lint` and `yarn typecheck` from the repo root and confirm they ran (elapsed time, not just empty output) — nothing outside `landing/` should have changed; `git status -s` shows only `landing/` files, `specs/303-landing-demo-videos/` and `current_sprint.md`. This is the owner-approved gate exception (plan.md): after a push, confirm the CI run on `main` is green (all gates) before calling LIRA-303 done
- [ ] T036 Update LIRA-303 in `current_sprint.md` with what was built and measured (length, file sizes) and its status; then stop — commit only when the owner says "commit", and only the `landing/`, `specs/303-…` and `current_sprint.md` changes

---

## Dependencies & execution order

- **Setup (T001–T003)**: T001 → T002. T003 is the owner and runs in parallel with everything up to Phase 2.
- **Foundational (T004–T007)**: after T002; T004, T005, T006 in parallel; T007 any time after T002.
- **US1 capture (T008–T013)**: needs T003. T009 → T012 in sequence after T008 (one browser; each action is history for the next).
- **US1 build → page (T014–T022a)**: needs Phase 2 and T013; strictly in order; T019 is an owner gate; T019a runs before T020 touches the poster.
- **US2 (T023–T026)**: needs T014 (the composition exists).
- **US3 (T027–T032)**: T027–T028 need the simulator and the test shop; T031 renders the final video after US1–US3.
- **Polish**: T033 before the final render (T031); T034 any time; T035–T036 last.

### Parallel examples

```text
# Phase 2, together:
T004 rebrand comp.html   |  T005 re-time music.py   |  T006 fix render.mjs

```

## Implementation strategy

- **MVP = US1**: a new-brand 29 s video with the four product scenes. It fixes the green poster and video on its own.
- **Recommended ship**: after US2, so the page changes once (one `?v=` bump, one sign-off). Ship after US1 only if the owner wants the new brand live sooner.
- **US3** is documentation for later; it does not block shipping.
- **Blocking**: T003 (seeded test shop). Phase 1–2 and US3 can be done while waiting.
