// Publish APPROVED posts to Instagram through the official Graph API (Content Publishing).
// Usage: node publish.mjs            → dry run (default): prints every call it would make, sends nothing
//        node publish.mjs --dry-run  → same
//        node publish.mjs --live     → really publishes (needs IG_USER_ID, IG_ACCESS_TOKEN, PUBLIC_BASE_URL)
//
// A post is due when: status === "approved", planned_date <= today (local date), published_id === null.
// The Graph API fetches media itself, so every file must already be reachable at a PUBLIC https URL:
//   post.public_urls (same order as post.media) if filled, else PUBLIC_BASE_URL/<post id>/<media path>,
//   e.g. https://example.com/ig/01-intro/media/slide-01.png
import fs from "node:fs";
import path from "node:path";

// Verify the current Graph API version in Meta's docs before going live — this is not a claim that v23.0 is current.
const GRAPH_VERSION = "v23.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

const ROOT = path.resolve(new URL(".", import.meta.url).pathname);
const POSTS = path.join(ROOT, "posts");

const live = process.argv.includes("--live");
const { IG_USER_ID, IG_ACCESS_TOKEN, PUBLIC_BASE_URL } = process.env;
const missing = ["IG_USER_ID", "IG_ACCESS_TOKEN", "PUBLIC_BASE_URL"].filter((k) => !process.env[k]);

if (live && missing.length) {
  console.error(`--live needs ${missing.join(", ")}. Nothing was sent.`);
  process.exit(1);
}

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const today = localToday();

const caption = (p) => [p.caption_en || "", p.caption_ar || "", (p.hashtags || []).join(" ")].join("\n\n");

const base = (PUBLIC_BASE_URL || "<PUBLIC_BASE_URL>").replace(/\/+$/, "");
const publicUrl = (p, i) => p.public_urls?.[i] || `${base}/${p.id}/${p.media[i]}`;

const redact = (params) => ({ ...params, ...(params.caption ? { caption: `<${params.caption.length} chars>` } : {}) });

// ---- Graph API calls (only ever reached with --live) -------------------------------------------
async function graph(method, pathPart, params = {}) {
  const url = new URL(`${GRAPH}/${pathPart}`);
  const init = { method };
  const all = { ...params, access_token: IG_ACCESS_TOKEN };
  if (method === "GET") for (const [k, v] of Object.entries(all)) url.searchParams.set(k, String(v));
  else init.body = new URLSearchParams(Object.entries(all).map(([k, v]) => [k, String(v)]));
  const res = await fetch(url, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(`${method} /${pathPart} → ${res.status} ${JSON.stringify(json.error || json)}`);
  return json;
}

// Containers (especially video) are processed asynchronously; wait until status_code is FINISHED.
async function waitFinished(containerId, { tries = 60, everyMs = 5000 } = {}) {
  for (let i = 0; i < tries; i++) {
    const { status_code } = await graph("GET", containerId, { fields: "status_code" });
    if (status_code === "FINISHED") return;
    if (status_code === "ERROR" || status_code === "EXPIRED") throw new Error(`container ${containerId} status ${status_code}`);
    await new Promise((r) => setTimeout(r, everyMs));
  }
  throw new Error(`container ${containerId} not FINISHED after ${(tries * everyMs) / 1000}s`);
}

// ---- Plan: the list of steps for one post, shared by dry run and live run ---------------------------
function plan(p) {
  const cap = caption(p);
  const me = IG_USER_ID || "<IG_USER_ID>";
  if (p.type === "image") {
    return [
      { call: "POST", path: `${me}/media`, params: { image_url: publicUrl(p, 0), caption: cap }, as: "parent" },
      { call: "POLL", of: "parent" },
    ];
  }
  if (p.type === "carousel") {
    const steps = p.media.map((_, i) => ({
      call: "POST",
      path: `${me}/media`,
      params: { image_url: publicUrl(p, i), is_carousel_item: true },
      as: `child${i}`,
    }));
    steps.push(...p.media.map((_, i) => ({ call: "POLL", of: `child${i}` })));
    steps.push({
      call: "POST",
      path: `${me}/media`,
      params: { media_type: "CAROUSEL", children: p.media.map((_, i) => `<child${i}>`).join(","), caption: cap },
      as: "parent",
    });
    steps.push({ call: "POLL", of: "parent" });
    return steps;
  }
  if (p.type === "reel") {
    const vi = p.media.findIndex((m) => m.endsWith(".mp4"));
    const ci = p.media.findIndex((m) => /\.(jpe?g|png)$/.test(m));
    const params = { media_type: "REELS", video_url: publicUrl(p, vi), caption: cap };
    if (ci >= 0) params.cover_url = publicUrl(p, ci);
    return [
      { call: "POST", path: `${me}/media`, params, as: "parent" },
      { call: "POLL", of: "parent" },
    ];
  }
  throw new Error(`unknown post type "${p.type}"`);
}

function problems(p) {
  const out = [];
  if (!p.media?.length) out.push("no rendered media — run `node render.mjs " + p.id + "` first");
  if (p.type === "image" && p.media?.length !== 1) out.push(`image post should have exactly 1 media file, has ${p.media?.length ?? 0}`);
  if (p.type === "carousel" && p.media?.length && (p.media.length < 2 || p.media.length > 10))
    out.push(`carousel needs 2–10 items (verify the limit in Meta docs), has ${p.media.length}`);
  if (p.type === "reel" && p.media?.length && !p.media.some((m) => m.endsWith(".mp4"))) out.push("reel has no .mp4");
  if (p.public_urls?.length && p.public_urls.length !== p.media?.length) out.push("public_urls length does not match media");
  return out;
}

// ---- Run ----------------------------------------------------------------------------------------------
const files = fs
  .readdirSync(POSTS)
  .filter((d) => fs.existsSync(path.join(POSTS, d, "post.json")))
  .sort();

const due = [];
for (const id of files) {
  const p = JSON.parse(fs.readFileSync(path.join(POSTS, id, "post.json"), "utf8"));
  if (p.status === "approved" && p.planned_date && p.planned_date <= today && p.published_id == null) due.push(p);
}

console.log(`${live ? "LIVE" : "DRY RUN"} · Graph ${GRAPH_VERSION} · today ${today} · ${due.length} approved post(s) due of ${files.length}`);
if (!live && missing.length) console.log(`(env not set: ${missing.join(", ")} — placeholders shown)`);

let failed = 0;
for (const p of due) {
  console.log(`\n▶ ${p.id}  [${p.type}]  planned ${p.planned_date}`);
  const bad = problems(p);
  if (bad.length) {
    bad.forEach((b) => console.log(`  ✗ ${b}`));
    failed++;
    continue;
  }
  // Likely, based on Meta's Content Publishing docs as of training: feed images must be JPEG. Verify before going live.
  if (p.type !== "reel" && p.media.some((m) => !/\.jpe?g$/i.test(m)))
    console.log("  ⚠ media are not JPEG — verify in Meta docs whether PNG is accepted for image_url");

  const steps = plan(p);
  if (!live) {
    for (const s of steps) {
      if (s.call === "POLL") console.log(`  GET  /{${s.of}}?fields=status_code  (repeat until FINISHED)`);
      else console.log(`  POST ${GRAPH}/${s.path}  ${JSON.stringify(redact(s.params))}  → <${s.as}>`);
    }
    console.log(`  POST ${GRAPH}/${IG_USER_ID || "<IG_USER_ID>"}/media_publish  {"creation_id":"<parent>"}`);
    console.log(`  then write published_id + published_at to posts/${p.id}/post.json`);
    continue;
  }

  try {
    const ids = {};
    for (const s of steps) {
      if (s.call === "POLL") {
        await waitFinished(ids[s.of]);
        continue;
      }
      const params = { ...s.params };
      if (params.children) params.children = params.children.replace(/<(child\d+)>/g, (_, k) => ids[k]);
      ids[s.as] = (await graph("POST", s.path, params)).id;
      console.log(`  ✓ container ${s.as} = ${ids[s.as]}`);
    }
    const { id: mediaId } = await graph("POST", `${IG_USER_ID}/media_publish`, { creation_id: ids.parent });
    const file = path.join(POSTS, p.id, "post.json");
    const fresh = JSON.parse(fs.readFileSync(file, "utf8"));
    fresh.published_id = mediaId;
    fresh.published_at = new Date().toISOString();
    fs.writeFileSync(file, JSON.stringify(fresh, null, 2) + "\n");
    console.log(`  ✓ published ${mediaId}`);
  } catch (e) {
    console.log(`  ✗ ${e.message}`);
    failed++;
  }
}

if (failed) process.exit(1);
