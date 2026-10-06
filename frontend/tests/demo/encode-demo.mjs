// Turns the Playwright recording of the demo tour into the landing page's
// video + poster (LANDING_PAGE_PLAN.md, Phase 3a).
//
//   landing/assets/demo.mp4   H.264, no audio, web-optimised (plays on iPhone)
//   landing/assets/poster.jpg one frame, shown while the video loads
//
// Needs ffmpeg on PATH. Run after `playwright test --config playwright.demo.config.ts`.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(here, "..", "..", "test-results", "demo", "output");
const assetsDir = path.join(here, "..", "..", "..", "landing", "assets");

const tourDir = fs.readdirSync(outputDir).find((name) => name.includes("tour"));
const webm = tourDir && path.join(outputDir, tourDir, "video.webm");
if (!webm || !fs.existsSync(webm)) {
  console.error(`No tour recording found under ${outputDir}`);
  process.exit(1);
}

fs.mkdirSync(assetsDir, { recursive: true });
const mp4 = path.join(assetsDir, "demo.mp4");
const poster = path.join(assetsDir, "poster.jpg");

execFileSync(
  "ffmpeg",
  [
    "-y",
    "-loglevel",
    "error",
    "-i",
    webm,
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "26",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-an",
    mp4,
  ],
  { stdio: "inherit" },
);
// A frame from the POS step ("Sell in seconds") — the most product-like still.
execFileSync(
  "ffmpeg",
  [
    "-y",
    "-loglevel",
    "error",
    "-ss",
    "9",
    "-i",
    mp4,
    "-frames:v",
    "1",
    "-q:v",
    "3",
    poster,
  ],
  { stdio: "inherit" },
);

const mb = (file) => (fs.statSync(file).size / 1024 / 1024).toFixed(2);
console.log(`demo.mp4  ${mb(mp4)} MB\nposter.jpg ${mb(poster)} MB`);
