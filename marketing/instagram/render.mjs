// Render every post's slides (PNG) and reels (MP4) from posts/<id>/post.json.
// Usage: node render.mjs            → all posts
//        node render.mjs 03-omt     → one post (id prefix match)
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { slideHtml, SIZES, ROOT } from "./lib/templates.mjs";
import { reelFrameHtml, scenesHtml } from "./lib/reels.mjs";

const POSTS = path.join(ROOT, "posts");
const BUILD = path.join(ROOT, "build");
fs.mkdirSync(BUILD, { recursive: true });

const only = process.argv[2];
const ids = fs
  .readdirSync(POSTS)
  .filter((d) => fs.existsSync(path.join(POSTS, d, "post.json")))
  .filter((d) => !only || d.startsWith(only))
  .sort();

const browser = await chromium.launch();
const errors = [];

async function shoot(html, size, out, name) {
  const page = await browser.newPage({ viewport: SIZES[size] });
  page.on("pageerror", (e) => errors.push(`${name}: ${e}`));
  const tmp = path.join(BUILD, name + ".html");
  fs.writeFileSync(tmp, html);
  await page.goto("file://" + tmp, { waitUntil: "load", timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
  await page.screenshot({ path: out, type: out.endsWith(".jpg") ? "jpeg" : "png", quality: out.endsWith(".jpg") ? 92 : undefined });
  return page;
}

const ffmpeg = (args) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: "inherit" });

for (const id of ids) {
  const file = path.join(POSTS, id, "post.json");
  const post = JSON.parse(fs.readFileSync(file, "utf8"));
  const dir = path.join(POSTS, id, "media");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const media = [];

  if (post.type === "reel") {
    const r = post.reel;
    const cover = path.join(dir, "cover.jpg");
    const out = path.join(dir, "reel.mp4");
    if (r.kind === "framed-video") {
      // Brand frame (headline above, CTA below) with the landscape demo laid in the middle.
      const frame = path.join(BUILD, `${id}-frame.png`);
      const slot = { x: 40, y: 640, w: 1000, h: 562 };
      await (await shoot(reelFrameHtml(r, slot), "story", frame, `${id}-frame`)).close();
      const src = path.join(ROOT, "assets", "brand", r.video);
      ffmpeg([
        "-loop", "1", "-i", frame, "-i", src,
        "-filter_complex",
        `[1:v]scale=${slot.w}:${slot.h},format=yuv420p[v];[0:v][v]overlay=${slot.x}:${slot.y}:shortest=1,format=yuv420p[o]`,
        "-map", "[o]", "-map", "1:a?", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-r", "30",
        "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", out,
      ]);
      ffmpeg(["-ss", "3", "-i", out, "-frames:v", "1", "-q:v", "3", cover]);
    } else if (r.kind === "scenes") {
      // HTML timeline rendered frame by frame (window.render(t)), then encoded with the brand music.
      const fps = 30;
      const frames = path.join(BUILD, `${id}-frames`);
      fs.rmSync(frames, { recursive: true, force: true });
      fs.mkdirSync(frames, { recursive: true });
      const page = await shoot(scenesHtml(r), "story", path.join(frames, "probe.jpg"), `${id}-scenes`);
      const n = Math.round(r.duration * fps);
      for (let i = 0; i < n; i++) {
        await page.evaluate((t) => window.render(t), i / fps);
        await page.screenshot({ path: path.join(frames, `f${String(i).padStart(4, "0")}.jpg`), type: "jpeg", quality: 90 });
      }
      await page.close();
      const music = path.join(ROOT, "assets", "brand", "music.wav");
      ffmpeg([
        "-framerate", String(fps), "-i", path.join(frames, "f%04d.jpg"), "-i", music,
        "-filter_complex", `[1:a]atrim=0:${r.duration},afade=t=out:st=${r.duration - 1.5}:d=1.5[a]`,
        "-map", "0:v", "-map", "[a]", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", out,
      ]);
      fs.copyFileSync(path.join(frames, `f${String(Math.round((r.cover_at ?? 1) * fps)).padStart(4, "0")}.jpg`), cover);
    }
    media.push("media/reel.mp4", "media/cover.jpg");
  } else {
    for (const [i, slide] of post.slides.entries()) {
      const name = `slide-${String(i + 1).padStart(2, "0")}.jpg`; // Graph API takes JPEG only for feed images
      const html = slideHtml(slide, { index: i, total: post.slides.length, size: "feed" });
      await (await shoot(html, "feed", path.join(dir, name), `${id}-${i + 1}`)).close();
      media.push("media/" + name);
    }
  }

  post.media = media;
  post.rendered_at = new Date().toISOString();
  fs.writeFileSync(file, JSON.stringify(post, null, 2) + "\n");
  console.log(`✓ ${id}  ${media.length} file(s)`);
}

await browser.close();
if (errors.length) {
  console.error("Page errors:\n" + errors.join("\n"));
  process.exit(1);
}
