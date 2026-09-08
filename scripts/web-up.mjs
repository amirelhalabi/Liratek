/**
 * ============================================================================
 * TEMPORARY SCAFFOLDING -- delete this file once the backend is properly hosted.
 * ============================================================================
 *
 * Starts the whole local web stack: backend, then the Cloudflare tunnel, then a
 * Vercel deploy so the live site points at the new tunnel hostname.
 *
 * Throwaway: it only exists because the backend runs on a developer PC behind a
 * quick tunnel. See docs/DEPLOYMENT.md (section: Temporary scaffolding).
 *
 * ── Why this replaced the `concurrently` one-liner ──
 *
 * The old version was:
 *
 *   concurrently -k "yarn web:backend" "wait-on tcp:3000 && yarn web:tunnel --deploy"
 *
 * which fails badly when a backend is ALREADY listening on 3000 — e.g. one left
 * running by a previous session, or an agent's. `wait-on tcp:3000` succeeds
 * instantly against the existing server, so the tunnel starts and deploys
 * happily, while `yarn web:backend` dies with EADDRINUSE and `-k` then tears
 * the tunnel down too. The result is a half-built stack and a confusing split
 * error, which is exactly what happened.
 *
 * So: probe first. If something healthy is already serving, reuse it and say
 * so, rather than trying to start a second one.
 */

import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = process.env.WEB_BACKEND_PORT || process.env.PORT || "3000";
const HEALTH = `http://127.0.0.1:${PORT}/health`;

const children = [];

function run(label, command, args) {
  console.log(`[web:up] ${label}: ${command} ${args.join(" ")}`);
  const child = spawn(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  children.push(child);
  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[web:up] ${label} exited ${code}`);
      shutdown(code);
    }
  });
  return child;
}

function shutdown(code) {
  for (const c of children) {
    try {
      c.kill();
    } catch {
      // already gone
    }
  }
  process.exit(code ?? 0);
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => shutdown(0));
}

/** Is something already answering /health on this port? */
async function probeBackend() {
  try {
    const r = await fetch(HEALTH, { signal: AbortSignal.timeout(2500) });
    return r.ok;
  } catch {
    return false;
  }
}

async function waitForBackend(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probeBackend()) return true;
    await new Promise((r) => setTimeout(r, 750));
  }
  return false;
}

// ── 1. Backend: reuse or start ──────────────────────────────────────────────
const alreadyUp = await probeBackend();

if (alreadyUp) {
  console.log(
    `[web:up] a backend is ALREADY serving ${HEALTH} — reusing it.\n` +
      `[web:up] (not starting a second one; that is what used to fail with EADDRINUSE)`,
  );
} else {
  run("backend", "yarn", ["web:backend"]);
  if (!(await waitForBackend())) {
    console.error(`[web:up] backend never became healthy on ${HEALTH}`);
    shutdown(1);
  }
  console.log(`[web:up] backend healthy on 127.0.0.1:${PORT}`);
}

// ── 2. Tunnel + deploy ──────────────────────────────────────────────────────
// web-tunnel.mjs re-probes /health itself and refuses to open a tunnel to
// nothing, so this stays correct even if the backend dies in between.
const tunnel = run("tunnel", "yarn", ["web:tunnel", "--deploy"]);

tunnel.on("exit", (code) => {
  console.log(`[web:up] tunnel exited (${code}).`);
  if (alreadyUp) {
    console.log(
      `[web:up] the backend was not started by this command, so it is still running.`,
    );
  }
  shutdown(code ?? 0);
});
