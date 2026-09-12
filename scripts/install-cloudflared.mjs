/**
 * ============================================================================
 * TEMPORARY SCAFFOLDING -- delete this file once the backend is properly hosted.
 * ============================================================================
 *
 * Downloads the cloudflared binary.
 *
 * Throwaway: nothing needs cloudflared once the backend is not behind a tunnel.
 *
 * It exists only because the Express backend currently runs on a developer PC
 * and is exposed through a free Cloudflare quick tunnel. The day the backend
 * runs on a real always-on host with its own database, none of this applies:
 * the frontend simply points at that host, and this file should be removed
 * along with its package.json script. See docs/DEPLOYMENT.md
 * (section: Temporary scaffolding) for the full keep/delete list.
 */
/**
 * Installs the `cloudflared` binary into .tools/ (gitignored).
 *
 *   yarn web:tunnel:install
 *
 * Kept repo-local rather than global so the whole web-tunnel flow works from a
 * fresh clone with no machine setup, and so nothing lands on PATH unasked.
 *
 * Downloads via `curl -4` on purpose. `-4` forces IPv4: cloudflare/github
 * release hosts resolve IPv6-first, and on a machine whose IPv6 path is broken
 * an IPv6-preferring client connects and then hangs with no error (this cost an
 * hour once -- a 613MB download stalled at 0 bytes with "empty reply from
 * server"). Node's fetch would inherit the same problem.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, chmodSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const toolsDir = join(repoRoot, ".tools");

const BASE =
  "https://github.com/cloudflare/cloudflared/releases/latest/download";

function assetFor(platform, arch) {
  const a = arch === "arm64" ? "arm64" : "amd64";
  if (platform === "win32")
    return { file: `cloudflared-windows-${a}.exe`, out: "cloudflared.exe" };
  if (platform === "linux")
    return { file: `cloudflared-linux-${a}`, out: "cloudflared" };
  return null; // macOS ships a .tgz -- `brew install cloudflared` is simpler there
}

const asset = assetFor(process.platform, process.arch);
if (!asset) {
  console.error(
    `[cloudflared] No prebuilt asset handled for ${process.platform}/${process.arch}.\n` +
      `  macOS: brew install cloudflared\n` +
      `  Then point the tunnel at it: set CLOUDFLARED_PATH=/path/to/cloudflared`,
  );
  process.exit(1);
}

const target = join(toolsDir, asset.out);

if (existsSync(target) && !process.argv.includes("--force")) {
  const v = spawnSync(target, ["--version"], { encoding: "utf8" });
  console.log(`[cloudflared] already installed: ${target}`);
  if (v.stdout) console.log(`  ${v.stdout.trim()}`);
  console.log(`  re-download with: yarn web:tunnel:install --force`);
  process.exit(0);
}

mkdirSync(toolsDir, { recursive: true });

const url = `${BASE}/${asset.file}`;
console.log(`[cloudflared] downloading ${url}`);
console.log(`[cloudflared] -> ${target}`);

const r = spawnSync(
  "curl",
  [
    "-4",
    "-L",
    "--fail",
    "--retry",
    "2",
    "--retry-delay",
    "3",
    "-#",
    "-o",
    target,
    url,
  ],
  { stdio: "inherit" },
);

if (r.error) {
  console.error(
    `[cloudflared] curl unavailable (${r.error.message}). Download manually:\n  ${url}`,
  );
  process.exit(1);
}
if (r.status !== 0) {
  console.error(`[cloudflared] download failed (curl exit ${r.status}).`);
  process.exit(r.status ?? 1);
}

if (process.platform !== "win32") chmodSync(target, 0o755);

const v = spawnSync(target, ["--version"], { encoding: "utf8" });
if (v.status !== 0) {
  console.error(
    `[cloudflared] downloaded but will not run:\n${v.stderr || ""}`,
  );
  process.exit(1);
}
console.log(`[cloudflared] installed: ${v.stdout.trim()}`);
