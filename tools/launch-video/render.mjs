// Renders comp.html frame by frame.
//   node render.mjs <landscape|vertical> frames          -> work/frames-<format>/
//   node render.mjs <landscape|vertical> stills 1,5.5,9  -> work/stills-<format>/
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const [format = "landscape", mode = "frames", list = ""] =
  process.argv.slice(2);
const FPS = 30;
const DUR = 21.0;
// [font, sample text in the script that font is used for]
const FONTS = [
  ['800 40px "Inter"', "LiraTek"],
  ['600 40px "IBM Plex Sans Arabic"', "عملتان"],
  ['700 40px "JetBrains Mono"', "$152.00"],
];

const browser = await chromium.launch();
const probe = await browser.newPage();
await probe.goto(`file://${here}/comp.html?format=${format}`);
const { W, H } = await probe.evaluate(() => ({
  W: window.LAYOUT.W,
  H: window.LAYOUT.H,
}));
await probe.close();

const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`file://${here}/comp.html?format=${format}`);
const missing = await page.evaluate(async (fonts) => {
  await Promise.all(
    fonts.map(([f, text]) => document.fonts.load(f, text).catch(() => null)),
  );
  await document.fonts.ready;
  return fonts
    .filter(([f, text]) => !document.fonts.check(f, text))
    .map(([f]) => f);
}, FONTS);
if (missing.length) {
  console.error(
    `Fonts did not load (offline?): ${missing.join(", ")}. Refusing to render with fallbacks.`,
  );
  process.exit(1);
}
const broken = await page.evaluate(() =>
  [...document.images]
    .filter((i) => !i.complete || i.naturalWidth === 0)
    .map((i) => i.getAttribute("src")),
);
if (broken.length) {
  console.error(
    `Missing screens: ${[...new Set(broken)].join(", ")} — capture them first (see README).`,
  );
  process.exit(1);
}

const outDir = path.join(here, "work", `${mode}-${format}`);
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const times =
  mode === "stills"
    ? list.split(",").map(Number)
    : Array.from({ length: Math.round(FPS * DUR) }, (_, i) => i / FPS);
for (const [i, t] of times.entries()) {
  await page.evaluate((x) => window.render(x), t);
  const name =
    mode === "stills"
      ? `t${t.toFixed(2)}.jpg`
      : `f${String(i).padStart(4, "0")}.jpg`;
  await page.screenshot({
    path: path.join(outDir, name),
    type: "jpeg",
    quality: mode === "stills" ? 85 : 93,
  });
}
await browser.close();
if (errors.length) {
  console.error("Page errors:", errors);
  process.exit(1);
}
console.log(`${mode}: ${times.length} image(s) in ${outDir}`);
