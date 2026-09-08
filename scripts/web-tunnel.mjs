/**
 * ============================================================================
 * TEMPORARY SCAFFOLDING -- delete this file once the backend is properly hosted.
 * ============================================================================
 *
 * Starts a Cloudflare quick tunnel and rewires the Vercel rewrites to it.
 *
 * Throwaway: its whole job is working around a hostname that changes on every restart.
 *
 * It exists only because the Express backend currently runs on a developer PC
 * and is exposed through a free Cloudflare quick tunnel. The day the backend
 * runs on a real always-on host with its own database, none of this applies:
 * the frontend simply points at that host, and this file should be removed
 * along with its package.json script. See docs/DEPLOYMENT.md
 * (section: Temporary scaffolding) for the full keep/delete list.
 */
/**
 * Starts a Cloudflare quick tunnel to the local web backend, then rewires the
 * Vercel deployment to it.
 *
 *   yarn web:tunnel            # start the tunnel, patch vercel.json, print next step
 *   yarn web:tunnel --deploy   # ...and run `vercel deploy --prod` automatically
 *
 * Why this exists: a free quick tunnel gets a NEW random *.trycloudflare.com
 * hostname on every start, and that hostname is baked into vercel.json's
 * rewrites. So every restart otherwise means hand-editing a file and
 * redeploying. This captures the new URL and does both.
 *
 * The shape of the whole setup:
 *
 *   browser -> liratek.vercel.app        (Vercel serves ONLY the built SPA)
 *           -> vercel.json rewrite /api/* -> the tunnel hostname
 *           -> Cloudflare edge -> cloudflared on THIS machine (outbound
 *              connection; no inbound port, no router config)
 *           -> http://127.0.0.1:PORT     (Express, backend/dist/server.js)
 *           -> @liratek/core             (the same layer desktop uses over IPC)
 *           -> the SQLite file at DATABASE_PATH
 *
 * Because /api is proxied on the SPA's own origin, the browser sees ONE origin:
 * no CORS, no mixed content, and frontend/src/api/httpClient.ts keeps resolving
 * the API base from window.location.origin with nothing hardcoded.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vercelJson = join(repoRoot, "vercel.json");
const PORT = process.env.WEB_BACKEND_PORT || process.env.PORT || "3000";
const DEPLOY = process.argv.includes("--deploy");

const QUICK_TUNNEL_RE = /https:\/\/[a-z0-9][a-z0-9-]*\.trycloudflare\.com/;

// ── locate cloudflared ──────────────────────────────────────────────────────
function resolveCloudflared() {
  if (process.env.CLOUDFLARED_PATH) return process.env.CLOUDFLARED_PATH;

  const exe = process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
  const candidates = [
    join(repoRoot, ".tools", exe), // yarn web:tunnel:install
    join(homedir(), ".local", "bin", exe), // manual install
  ];
  for (const c of candidates) if (existsSync(c)) return c;

  // Fall back to PATH.
  const probe = spawnSync(exe, ["--version"], { encoding: "utf8" });
  if (!probe.error && probe.status === 0) return exe;

  return null;
}

const bin = resolveCloudflared();
if (!bin) {
  console.error(
    "[tunnel] cloudflared not found.\n" +
      "  Install it with:  yarn web:tunnel:install\n" +
      "  Or point at an existing binary:  CLOUDFLARED_PATH=/path/to/cloudflared",
  );
  process.exit(1);
}

// ── is the backend actually up? ─────────────────────────────────────────────
// A tunnel to nothing "succeeds" and then every request 502s, which reads like
// a tunnel problem. Fail loudly here instead.
async function backendIsUp() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/health`, {
      signal: AbortSignal.timeout(4000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

if (!(await backendIsUp())) {
  console.error(
    `[tunnel] Nothing answering http://127.0.0.1:${PORT}/health\n` +
      `  Start the backend first:  yarn web:backend\n` +
      `  (or run both together:    yarn web:up)`,
  );
  process.exit(1);
}
console.log(`[tunnel] backend healthy on 127.0.0.1:${PORT}`);

// ── point vercel.json at the new hostname ───────────────────────────────────
function patchVercelJson(origin) {
  const cfg = JSON.parse(readFileSync(vercelJson, "utf8"));
  cfg.rewrites = Array.isArray(cfg.rewrites) ? cfg.rewrites : [];

  const stringDests = cfg.rewrites.filter(
    (r) =>
      typeof r.destination === "string" && QUICK_TUNNEL_RE.test(r.destination),
  );

  if (stringDests.length > 0) {
    // Swap the origin, keep each path template as-is.
    for (const r of stringDests) {
      r.destination = r.destination.replace(QUICK_TUNNEL_RE, origin);
    }
  } else {
    // First run (or someone replaced these with a real domain): insert the
    // standard set BEFORE the SPA catch-all, which must stay last or it
    // swallows /api.
    const proxied = [
      { source: "/health", destination: `${origin}/health` },
      { source: "/health/:path*", destination: `${origin}/health/:path*` },
      { source: "/api/:path*", destination: `${origin}/api/:path*` },
      // ":path*" does not match "/socket.io/" with an empty remainder, which
      // 404s the handshake; ":path(.*)" matches empty too.
      {
        source: "/socket.io/:path(.*)",
        destination: `${origin}/socket.io/:path`,
      },
    ];
    const catchAllAt = cfg.rewrites.findIndex((r) => r.source === "/(.*)");
    if (catchAllAt === -1) cfg.rewrites.push(...proxied);
    else cfg.rewrites.splice(catchAllAt, 0, ...proxied);
  }

  writeFileSync(vercelJson, JSON.stringify(cfg, null, 2) + "\n");
}

// ── named tunnel: the whole reason this file is scaffolding goes away ───────
//
// A NAMED tunnel keeps ONE stable hostname across restarts, so vercel.json is
// correct permanently and there is nothing to patch and nothing to redeploy.
// Everything below the quick-tunnel branch -- URL capture, JSON rewriting,
// an automatic `vercel deploy` -- exists ONLY to chase a hostname that changes.
//
// This is now the DEFAULT: `liratek-web` exists (created 2026-09-08, id
// 722b2841-15e8-410f-9031-70927d4cacdf) and api.liratek.shop is routed to it,
// so `yarn web:up` should use it without anyone having to remember an env var.
//
// It is chosen only when the tunnel's credentials are actually present, because
// `cloudflared tunnel run` on a machine that has never logged in fails with a
// certificate error that says nothing about the cause. Absent credentials, the
// quick tunnel still works, which keeps this script usable on a fresh clone.
//
// Overrides: TUNNEL_NAME=<other> picks a different tunnel, TUNNEL_NAME= (empty)
// or TUNNEL_QUICK=1 forces the quick tunnel.
//
// The hard prerequisite for any of this: `tunnel route dns` writes a CNAME to
// <id>.cfargotunnel.com, which resolves only for a zone CLOUDFLARE hosts. On a
// registrar's own nameservers there is no named-tunnel option at all.
const DEFAULT_TUNNEL_NAME = "liratek-web";

function haveTunnelCredentials() {
  try {
    // `tunnel login` writes cert.pem; `tunnel create` writes <id>.json beside
    // it. Both are needed, and neither lives in the repo.
    const dir = join(homedir(), ".cloudflared");
    if (!existsSync(join(dir, "cert.pem"))) return false;
    return readdirSync(dir).some((f) => /^[0-9a-f-]{36}\.json$/i.test(f));
  } catch {
    return false;
  }
}

const TUNNEL_NAME =
  process.env.TUNNEL_QUICK === "1"
    ? ""
    : (process.env.TUNNEL_NAME ??
      (haveTunnelCredentials() ? DEFAULT_TUNNEL_NAME : ""));
const named = Boolean(TUNNEL_NAME);

// ── run it ──────────────────────────────────────────────────────────────────
const args = named
  ? [
      "tunnel",
      // Ingress inline rather than a config.yml: one less file to keep in sync
      // with PORT, and it is the same routing either way.
      "--url",
      `http://127.0.0.1:${PORT}`,
      "--edge-ip-version",
      "4",
      "--no-autoupdate",
      "run",
      TUNNEL_NAME,
    ]
  : [
      "tunnel",
      "--url",
      `http://127.0.0.1:${PORT}`,
      // Same IPv4 pin as the installer: an IPv6-first edge lookup on a host with a
      // broken IPv6 path hangs instead of failing over.
      "--edge-ip-version",
      "4",
      "--no-autoupdate",
    ];

console.log(`[tunnel] ${bin} ${args.join(" ")}`);
const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });

if (named) {
  console.log(
    `[tunnel] NAMED tunnel "${TUNNEL_NAME}" — stable hostname, so vercel.json\n` +
      `[tunnel] is left alone and nothing is redeployed. If /api breaks now it is\n` +
      `[tunnel] the tunnel or the DNS record, never a stale rewrite.`,
  );
  child.stdout.on("data", (c) => process.stdout.write(c.toString()));
  child.stderr.on("data", (c) => process.stdout.write(c.toString()));
}

let captured = null;

function onOutput(chunk) {
  const text = chunk.toString();
  process.stdout.write(text);
  if (captured) return;

  const m = text.match(QUICK_TUNNEL_RE);
  if (!m) return;
  captured = m[0];

  console.log(`\n[tunnel] URL: ${captured}`);
  try {
    patchVercelJson(captured);
    console.log(`[tunnel] vercel.json rewrites -> ${captured}`);
  } catch (e) {
    console.error(`[tunnel] could not patch vercel.json: ${e.message}`);
    return;
  }

  if (!DEPLOY) {
    console.log(
      `[tunnel] Not deployed yet. The live site still points at the OLD URL.\n` +
        `[tunnel] Run:  vercel deploy --prod --yes     (or use: yarn web:tunnel --deploy)`,
    );
    return;
  }

  console.log(`[tunnel] deploying so the live site uses this URL...`);
  const d = spawnSync("vercel", ["deploy", "--prod", "--yes"], {
    cwd: repoRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (d.status === 0)
    console.log(`[tunnel] deployed. The site now proxies /api here.`);
  else
    console.error(`[tunnel] deploy failed (exit ${d.status}). Run it by hand.`);
}

if (!named) {
  child.stdout.on("data", onOutput);
  child.stderr.on("data", onOutput); // cloudflared logs the URL on stderr
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    child.kill();
    process.exit(0);
  });
}

child.on("exit", (code) => {
  console.log(`[tunnel] cloudflared exited (${code}).`);
  console.log(
    `[tunnel] The live site's /api is now dead until a tunnel is running again.`,
  );
  process.exit(code ?? 0);
});
