#!/usr/bin/env node
/**
 * flyctl passthrough that actually finds flyctl.
 *
 * WHY THIS EXISTS: the official installer drops the binary in
 * `%USERPROFILE%\.fly\bin\flyctl.exe` and then tries to create a shortcut,
 * which needs elevation — so on a normal Windows install the binary works but
 * `fly` is NOT on PATH. In Git Bash it is not on PATH either way. An agent (or
 * a new laptop) hits "command not found", concludes flyctl is missing, and
 * stops. That has already happened once.
 *
 * Resolution order: whatever is on PATH, then the installer's default location.
 *
 *   yarn api -- status
 *   yarn api -- logs
 *   yarn api -- ssh console
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const APP = "liratek-api";

function onPath(bin) {
  const probe = spawnSync(bin, ["version"], {
    stdio: "ignore",
    shell: process.platform === "win32",
  });
  return probe.status === 0;
}

export function resolveFlyctl() {
  for (const bin of ["flyctl", "fly"]) {
    if (onPath(bin)) return bin;
  }
  const candidates =
    process.platform === "win32"
      ? [path.join(homedir(), ".fly", "bin", "flyctl.exe")]
      : [
          path.join(homedir(), ".fly", "bin", "flyctl"),
          "/usr/local/bin/flyctl",
          "/opt/homebrew/bin/flyctl",
        ];
  for (const c of candidates) if (existsSync(c)) return c;

  console.error(
    "[fly] flyctl not found.\n" +
      "      Install:  pwsh -c \"iwr https://fly.io/install.ps1 -useb | iex\"\n" +
      "      Then log in ONCE in your own terminal — `fly auth login` refuses to\n" +
      "      run in a non-interactive shell:\n" +
      `      "${path.join(homedir(), ".fly", "bin", "flyctl.exe")}" auth login`,
  );
  process.exit(1);
}

/** Run flyctl, inheriting stdio. Resolves with the exit code. */
export function fly(args, { app = APP } = {}) {
  const bin = resolveFlyctl();
  // --app is appended unless the caller already scoped the command.
  const full = args.includes("--app") ? args : [...args, "--app", app];
  return new Promise((resolve) => {
    const child = spawn(bin, full, {
      stdio: "inherit",
      shell: false,
      env: { ...process.env, FLY_NO_UPDATE_CHECK: "1" },
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

/** Run flyctl and CAPTURE stdout (for log scraping). */
export function flyCapture(args, { app = APP } = {}) {
  const bin = resolveFlyctl();
  const full = args.includes("--app") ? args : [...args, "--app", app];
  const r = spawnSync(bin, full, {
    encoding: "utf8",
    shell: false,
    env: { ...process.env, FLY_NO_UPDATE_CHECK: "1" },
  });
  return `${r.stdout ?? ""}${r.stderr ?? ""}`;
}

// Direct invocation: pure passthrough. argv[1] is undefined when this module is
// imported (e.g. `node -e "import('./scripts/fly.mjs')"`), so guard it.
if (
  process.argv[1] &&
  import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`
) {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("usage: yarn api -- <flyctl args>   e.g. yarn api -- status");
    process.exit(1);
  }
  fly(args).then((code) => process.exit(code));
}
