# Launch video

The 21-second LiraTek video on https://liratek.shop, plus a vertical cut for
Instagram Reels, TikTok and WhatsApp Status. It is built in the style of the
[`/brag`](https://github.com/latent-spaces/brag) skill: real app screens,
motion, captions in English and Arabic, and a synthesised soundtrack.

## Make it

From `frontend/`:

```bash
yarn launch-video                       # both formats → tools/launch-video/out/
yarn launch-video --format vertical     # one format only
yarn launch-video --screens             # re-capture the app screens first
yarn launch-video --publish             # also copy the landscape cut to landing/assets/
```

Output:

| File | Use |
| --- | --- |
| `out/liratek-landscape.mp4` + `.jpg` | Landing page, YouTube, LinkedIn (1920×1080) |
| `out/liratek-vertical.mp4` + `.jpg` | Reels, TikTok, WhatsApp Status (1080×1920) |

Run it after a release when the screens have changed (`--screens`), so the
video shows the current app.

## Needs

- `ffmpeg` and `python3` on `PATH`.
- Internet access while rendering: the fonts load from Google Fonts. The
  renderer refuses to run with fallback fonts.
- For `--screens`: `better-sqlite3` on the Node ABI (`yarn rebuild:node`),
  because it starts the same web stack as the web e2e suite. Run `yarn dev`
  or `yarn rebuild:native` afterwards before desktop e2e.

## How it works

| File | Role |
| --- | --- |
| `frontend/tests/demo/capture-screens.spec.ts` | Starts the web app against a brand-new database, adds invented products, makes one sale and one OMT transfer, and saves `shots/checkout.png`, `omt.png`, `dashboard.png`. Never point it at real shop data: the video is public. |
| `comp.html` | The composition. Every frame is a pure function of time (`window.render(t)`). `?format=landscape\|vertical` picks the layout. |
| `music.py` | The soundtrack: A minor, 112 BPM, effects in the same key. |
| `render.mjs` | Screenshots `comp.html` at 30 fps. `node render.mjs vertical stills 2,7.5` renders single frames for checking. |
| `make.mjs` | Runs everything and encodes with `ffmpeg`. Frame 0 is replaced by the settled outro frame, so platforms show it as the thumbnail. |

`shots/`, `work/` and `out/` are generated and not committed.

## Changing it

- Timing lives in `S` in `comp.html` (scene start/end, seconds). Keep any
  line a viewer must read on screen for about 0.3 s per word.
- Layout for each format lives in `LAYOUTS`. In the vertical layout, keep text
  out of the bottom ~20% and right ~12%, where Reels and TikTok draw their own
  buttons (approximate).
- Screen positions (crops, rings, the typing mask) are in screenshot pixels. If
  the app's layout changes, re-capture and check stills before rendering.
