// One command for the launch video. See README.md.
//   node tools/launch-video/make.mjs [--format landscape|vertical|both] [--screens] [--publish]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};
const formats = { both: ["landscape", "vertical"] }[
  opt("--format", "both")
] ?? [opt("--format", "both")];
const run = (cmd, cmdArgs, cwd = here) =>
  execFileSync(cmd, cmdArgs, { cwd, stdio: "inherit" });

// 1. Screens: real app, fictional demo data (needs better-sqlite3 on the Node ABI).
if (
  args.includes("--screens") ||
  !fs.existsSync(path.join(here, "shots", "checkout.png"))
) {
  run(
    "npx",
    [
      "playwright",
      "test",
      "--config",
      "playwright.demo.config.ts",
      "tests/demo/capture-screens.spec.ts",
    ],
    path.join(root, "frontend"),
  );
}

// 2. Music (same 21 s track for every format).
fs.mkdirSync(path.join(here, "work"), { recursive: true });
const wav = path.join(here, "work", "music.wav");
run("python3", ["music.py", wav]);

// 3. Frames + encode. Frame 0 is replaced by the settled outro frame so every
// platform's thumbnail shows it (same frame count, so audio stays in sync).
fs.mkdirSync(path.join(here, "out"), { recursive: true });
for (const format of formats) {
  run("node", ["render.mjs", format, "frames"]);
  const frames = path.join(here, "work", `frames-${format}`);
  const posterFrame = path.join(frames, "f0594.jpg");
  const poster = path.join(here, "out", `liratek-${format}.jpg`);
  fs.copyFileSync(posterFrame, poster);
  fs.copyFileSync(posterFrame, path.join(frames, "f0000.jpg"));
  const mp4 = path.join(here, "out", `liratek-${format}.mp4`);
  run("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-framerate",
    "30",
    "-i",
    path.join(frames, "f%04d.jpg"),
    "-i",
    wav,
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-movflags",
    "+faststart",
    "-shortest",
    mp4,
  ]);
  console.log(`${format}: ${mp4}`);
}

// 4. Optionally replace the landing page's video with the landscape cut.
if (args.includes("--publish")) {
  const assets = path.join(root, "landing", "assets");
  fs.copyFileSync(
    path.join(here, "out", "liratek-landscape.mp4"),
    path.join(assets, "demo.mp4"),
  );
  fs.copyFileSync(
    path.join(here, "out", "liratek-landscape.jpg"),
    path.join(assets, "poster.jpg"),
  );
  console.log("Published to landing/assets/ — review, then commit.");
}
