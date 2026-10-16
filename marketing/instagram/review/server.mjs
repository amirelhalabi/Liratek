// Local review app for Instagram posts. No dependencies.
// Usage: node review/server.mjs  → http://localhost:4747
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const POSTS = path.join(ROOT, "posts");
const PORT = Number(process.env.PORT || 4747);
const EDITABLE = ["status", "notes", "caption_en", "caption_ar", "hashtags", "planned_date"];
const STATUSES = ["draft", "approved", "rejected", "changes"];

const TYPES = { ".html": "text/html; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".mp4": "video/mp4", ".json": "application/json" };

const readPost = (id) => JSON.parse(fs.readFileSync(path.join(POSTS, id, "post.json"), "utf8"));
const listPosts = () =>
  fs
    .readdirSync(POSTS)
    .filter((d) => fs.existsSync(path.join(POSTS, d, "post.json")))
    .sort()
    .map(readPost);

const send = (res, code, body, type = "application/json") => {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

// Serves a file with HTTP range support so <video> can seek.
function serveFile(req, res, file) {
  if (!fs.existsSync(file)) return send(res, 404, { error: "not found" });
  const size = fs.statSync(file).size;
  const type = TYPES[path.extname(file)] || "application/octet-stream";
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || "");
  if (range) {
    const start = Number(range[1] || 0);
    const end = range[2] ? Number(range[2]) : size - 1;
    res.writeHead(206, { "Content-Type": type, "Content-Range": `bytes ${start}-${end}/${size}`, "Accept-Ranges": "bytes", "Content-Length": end - start + 1 });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { "Content-Type": type, "Content-Length": size, "Accept-Ranges": "bytes", "Cache-Control": "no-store" });
  fs.createReadStream(file).pipe(res);
}

const body = (req) =>
  new Promise((ok, fail) => {
    let s = "";
    req.on("data", (c) => (s += c));
    req.on("end", () => {
      try {
        ok(JSON.parse(s || "{}"));
      } catch (e) {
        fail(e);
      }
    });
  });

const safeId = (id) => /^[\w-]+$/.test(id) && fs.existsSync(path.join(POSTS, id, "post.json"));

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const p = decodeURIComponent(url.pathname);
    try {
      if (p === "/" || p === "/index.html") return serveFile(req, res, path.join(ROOT, "review", "index.html"));
      if (p === "/api/posts" && req.method === "GET") return send(res, 200, listPosts());

      const m = /^\/api\/posts\/([\w-]+)(\/render)?$/.exec(p);
      if (m && safeId(m[1])) {
        const id = m[1];
        if (m[2] && req.method === "POST") {
          execFile("node", [path.join(ROOT, "render.mjs"), id], { cwd: ROOT }, (err, out, errOut) =>
            send(res, err ? 500 : 200, err ? { error: errOut || String(err) } : readPost(id)),
          );
          return;
        }
        if (req.method === "PATCH") {
          const patch = await body(req);
          const post = readPost(id);
          for (const k of EDITABLE) if (k in patch) post[k] = patch[k];
          if (!STATUSES.includes(post.status)) return send(res, 400, { error: "bad status" });
          if ("status" in patch) post.status_changed_at = new Date().toISOString();
          fs.writeFileSync(path.join(POSTS, id, "post.json"), JSON.stringify(post, null, 2) + "\n");
          return send(res, 200, post);
        }
      }

      const f = /^\/posts\/([\w-]+)\/(media\/[\w.-]+)$/.exec(p);
      if (f && safeId(f[1])) return serveFile(req, res, path.join(POSTS, f[1], f[2]));
      send(res, 404, { error: "not found" });
    } catch (e) {
      send(res, 500, { error: String(e) });
    }
  })
  .listen(PORT, "127.0.0.1", () => console.log(`LiraTek posts review → http://localhost:${PORT}`));
