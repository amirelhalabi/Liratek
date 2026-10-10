# Contract: Landing Hero Media (LIRA-303)

What the landing pages expect from the new video and poster. Both `landing/index.html` and `landing/ar.html`
use the same files.

## Files

| Path | What | Limit |
|---|---|---|
| `landing/assets/demo.mp4` / `demo-ar.mp4` | English / Arabic video: H.264 + AAC, 1920×1080, 30 fps, about 34 s, loops cleanly | ≤ 3 MB each |
| `landing/assets/poster.webp` / `poster-ar.webp` | First paint per language; frame 0 = the settled hook frame | ≤ 25 KB each |
| `landing/assets/poster.jpg` / `poster-ar.jpg` | Same frames, fallback | ≤ 120 KB each |

`index.html` uses the English files; `ar.html` uses the `-ar` files (owner decision 2026-10-10: one language per video).

- Frame 0 of `demo.mp4` = the settled hook frame = the poster (spec FR-010), so the switch from poster to video
  is seamless.
- The outro's last 0.5 s fades into frame 0, so the loop does not jump.
- One `?v=` bump per release of new media; if US1 ships before US2, the second release bumps once more
  (poster `?v=5`, video `?v=4`).

## Page changes (both pages, nothing else)

| Element | Today | After |
|---|---|---|
| `<link rel="preload" as="image" href="/assets/poster.webp?v=…">` | `?v=3` | `?v=4` |
| `<video poster="/assets/poster.webp?v=…">` | `?v=3` | `?v=4` |
| `<source src="/assets/demo.mp4?v=…">` | `?v=2` | `?v=3` |

Unchanged and must keep working: `autoplay muted loop playsinline preload="metadata"`, the sound button
(`#sound-toggle`, `main.js`: restart with sound, label in the page's language), and the reduce-motion rule
(poster only, no autoplay).

## Content rules (checked before the files are copied in)

- No old logo, no green brand accent in any frame or in the poster.
- No real person, phone number, shop or email in any frame.
- Every title has its Arabic line.
- Inside the Windows app window: only screens in the current desktop release. The Mac part shows a browser window, never a native Mac app.
- Drawn phones and desktops carry no maker logos.
