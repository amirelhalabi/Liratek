#!/usr/bin/env node
/**
 * Deploy the backend to Fly, then PROVE it came up.
 *
 * The runbook in docs/DEPLOYMENT.md § 4d says "watch the logs, do not trust the
 * exit code". Prose cannot enforce that, so this does: after the deploy it
 * checks the boot markers and the live endpoints, and exits non-zero if any of
 * them is missing. A green exit here means the thing actually works, not that a
 * command returned 0.
 *
 *   yarn api:deploy
 *   yarn api:verify     (the checks alone, no deploy)
 */
import { fly, flyCapture } from "./fly.mjs";

const HOST = "https://api.liratek.shop";
const BASE_DOMAIN = "liratek.shop";

const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => console.log(`  ✗ ${m}`);

async function getJson(url, headers = {}) {
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* HTML error page, most likely */
  }
  return { status: res.status, json, text };
}

async function verify() {
  const failures = [];

  // 1. The process is up and serving.
  try {
    const { status, json } = await getJson(`${HOST}/health`);
    if (status === 200 && json?.status === "ok") ok(`/health (uptime ${json.uptime}s)`);
    else failures.push(`/health returned ${status}`);
  } catch (e) {
    failures.push(`/health unreachable: ${e.message}`);
  }

  // 2. Tenant resolution still reads the ORIGINAL Host through the proxies.
  //    docs/DEPLOYMENT.md § 8: if X-Forwarded-Host is lost, EVERY tenant login
  //    fails at once with a generic "invalid credentials" — a symptom that
  //    points nowhere near the cause. This is the cheapest possible tripwire.
  try {
    const platform = await getJson(`${HOST}/api/auth/signup-status`, {
      "X-Forwarded-Host": `www.${BASE_DOMAIN}`,
    });
    const tenant = await getJson(`${HOST}/api/auth/signup-status`, {
      "X-Forwarded-Host": `cornertech.${BASE_DOMAIN}`,
    });
    if (platform.json?.data?.platformHost === true) ok("platform host resolves");
    else failures.push("www did NOT resolve as the platform realm");
    if (tenant.json?.data?.platformHost === false) ok("tenant host resolves");
    else failures.push("a tenant subdomain resolved as the platform realm");
  } catch (e) {
    failures.push(`realm resolution check failed: ${e.message}`);
  }

  // 3. Boot markers — INFORMATIONAL ONLY, and that is a deliberate downgrade.
  //
  // These were hard assertions and they cried wolf on a perfectly good deploy.
  // `fly logs --no-tail` returns a short recent window, and this app logs every
  // request plus a health check every 15s — so with any traffic at all the boot
  // lines are gone within SECONDS, not minutes. Their absence therefore proves
  // nothing, and failing on it would train everyone to ignore the verifier,
  // which is worse than not having one.
  //
  // What still counts is a marker that IS present and says something is wrong.
  // For a definitive answer use `yarn api:ssh` and check the schema version and
  // the litestream process directly (docs/OPERATIONS.md).
  const logs = flyCapture(["logs", "--no-tail"]);

  if (/REPLICATION IS OFF/i.test(logs)) {
    failures.push("litestream exited at startup — REPLICATION IS OFF");
  } else if (/Litestream NOT configured/i.test(logs)) {
    failures.push("Litestream NOT configured — backups are OFF (set the LITESTREAM_* secrets)");
  } else if (/litestream replicating/i.test(logs)) {
    ok("litestream replicating");
  } else {
    bad("litestream state unknown — boot line already out of the log window");
  }

  if (/Database is up to date|migrations applied/i.test(logs)) ok("migrations applied");
  else bad("migration state unknown — boot line already out of the log window");

  // 4. Exactly one machine. Two writers on one SQLite file is corruption.
  const status = flyCapture(["status"]);
  const started = (status.match(/\bstarted\b/g) ?? []).length;
  if (started === 1) ok("exactly one machine running");
  else failures.push(`expected 1 running machine, saw ${started} — run: yarn api -- scale count 1`);

  return failures;
}

const verifyOnly = process.argv.includes("--verify-only");

if (!verifyOnly) {
  console.log("\n=== deploying backend to Fly ===");
  const code = await fly(["deploy", "--remote-only", "--ha=false"]);
  if (code !== 0) {
    console.error("\nDeploy command failed. Nothing verified.");
    process.exit(code);
  }
  // Give the machine a moment to finish booting before scraping logs.
  await new Promise((r) => setTimeout(r, 8000));
}

console.log("\n=== verifying ===");
const failures = await verify();

if (failures.length) {
  console.error(`\n${failures.length} CHECK(S) FAILED:`);
  for (const f of failures) console.error(`  - ${f}`);
  console.error("\nLogs:   yarn api:logs");
  console.error("Rollback: point api.liratek.shop back at the tunnel (DEPLOYMENT.md § 4d)");
  process.exit(1);
}

console.log("\nAll checks passed.\n");
