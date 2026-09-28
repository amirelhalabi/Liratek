#!/usr/bin/env node
/**
 * Guards the direct-invocation check in `scripts/fly.mjs`.
 *
 * Rule 17 — proven failing-first, on the REAL unfixed code:
 * `scripts/fly.mjs` used to gate its passthrough block with
 *   `import.meta.url === \`file://${process.argv[1].replace(/\\/g, "/")}\``
 * On Windows, `import.meta.url` for a file opened by an absolute path is
 * `file:///C:/...` (three slashes — POSIX file URLs for an absolute path with
 * a drive letter get an extra `/` before the drive), while the hand-built
 * string is `file://C:/...` (two slashes). The two never match, so the
 * `if` was never entered: `node scripts/fly.mjs` (with or without args)
 * printed NOTHING and exited 0 — no usage message, no flyctl invocation,
 * nothing. `yarn api`, `yarn api:logs`, `yarn api:status` and `yarn api:ssh`
 * were all silently broken on the owner's Windows machine.
 *
 * Run directly: node scripts/__tests__/flyEntryGuard.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FLY_SCRIPT = path.resolve(__dirname, "..", "fly.mjs");

test("direct invocation with no args prints usage and exits 1 (was: silent exit 0)", () => {
  const result = spawnSync(process.execPath, [FLY_SCRIPT], {
    encoding: "utf8",
  });

  assert.equal(
    result.status,
    1,
    `expected exit 1, got ${result.status} (stdout=${JSON.stringify(
      result.stdout,
    )} stderr=${JSON.stringify(result.stderr)})`,
  );
  assert.match(result.stderr, /usage: yarn api/);
});

test("importing the module does NOT trigger the direct-invocation block", async () => {
  const mod = await import(`${pathToFileURL(FLY_SCRIPT).href}?t=${Date.now()}`);

  // If the direct-invocation block ran on import, it would have called
  // process.exit() already and this line would never execute.
  assert.equal(typeof mod.resolveFlyctl, "function");
  assert.equal(typeof mod.fly, "function");
  assert.equal(typeof mod.flyCapture, "function");
});
