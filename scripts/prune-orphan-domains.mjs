#!/usr/bin/env node
/**
 * Delete the Cloudflare CNAME + Vercel project domain for tenant subdomains
 * that are ORPHANED — present in Cloudflare and/or Vercel but attached to no
 * tenant.
 *
 * WHY THIS EXISTS: `backend/src/services/tenantDomains.ts` provisions
 * `<slug>.<APP_BASE_DOMAIN>` on tenant signup (Cloudflare CNAME + Vercel
 * domain, in that order) but, before commit b82aa523, nothing tore it back
 * down on delete or slug-rename. Three subdomains from that gap are still
 * live: `acme-shop`, `echo-co`, `foxtrot-co`. The leak itself is fixed —
 * `deprovisionTenantDomain` is now wired into both the delete and the
 * slug-rename paths in `backend/src/api/admin.ts` — this script is only the
 * one-time cleanup of the pre-fix residue, reusing `tenantDomains.ts`'s own
 * two APIs (Cloudflare DNS, Vercel domains) and its own delete ORDER.
 *
 * `tools/ops-dashboard/` already computes this exact drift, read-only, on its
 * Tenants panel (`getTenantsSection`'s `drift.orphanDns` / `orphanVercel`).
 * This script's detection logic is deliberately the same shape — same three
 * sources, same "single-label CNAME under the zone pointing at Vercel, minus
 * the tenant slugs" rule — so the two never disagree about what's orphaned.
 *
 *   node scripts/prune-orphan-domains.mjs               # dry run (default)
 *   node scripts/prune-orphan-domains.mjs --yes          # actually delete
 *   node scripts/prune-orphan-domains.mjs --only=a,b      # limit the run
 *   node scripts/prune-orphan-domains.mjs --help
 *
 * Add to package.json as `yarn ops:prune`.
 */

// Must run before ANY networking happens, same reasoning as
// tools/ops-dashboard/server.mjs: IPv6 is broken on this machine — an
// IPv6-first Cloudflare/Vercel/backend host will connect and then just hang,
// no error, no timeout log, nothing, until something upstream eventually
// gives up. `AbortSignal.timeout()` below is the second line of defence;
// this is the first, and it's the one that stops the hang from happening at
// all. Losing this line costs about an hour of blaming the network.
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Resolved from this file's own location, not `process.cwd()` — the script
// must behave identically whether it's run as `node scripts/prune-orphan-
// domains.mjs` from the repo root or `node prune-orphan-domains.mjs` from
// inside scripts/.
const REPO_ROOT = path.resolve(__dirname, "..");
const ENV_PATH = path.join(REPO_ROOT, "backend", ".env");

const TIMEOUT_MS = 15_000;

const REQUIRED_ENV_VARS = [
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ZONE_ID",
  "VERCEL_TOKEN",
  "VERCEL_PROJECT_ID",
  "VERCEL_TEAM_ID",
  "APP_BASE_DOMAIN",
  "SUPER_ADMIN_USERNAME",
  "SUPER_ADMIN_PASSWORD",
];

// ---------------------------------------------------------------------------
// backend/.env — by hand, no dependency
// ---------------------------------------------------------------------------
//
// This is the same 15-line parser as tools/ops-dashboard/server.mjs, kept
// duplicated rather than shared: this is a standalone throwaway-ish ops
// script, not a module either file should import from, and the parser is
// small enough that copy-paste drift is not a real risk. Skip blanks/
// comments, split on the FIRST "=" only (a value may legitimately contain
// "=", e.g. a base64 secret), strip one layer of surrounding quotes.
function loadBackendEnv() {
  if (!existsSync(ENV_PATH)) return null;
  const out = {};
  const text = readFileSync(ENV_PATH, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function loadEnvOrExit() {
  const env = loadBackendEnv();
  if (!env) {
    console.error(
      `FATAL: ${ENV_PATH} not found. Nothing was touched.\n` +
        "This script needs backend/.env for Cloudflare, Vercel, and super-admin credentials.",
    );
    process.exit(1);
  }
  const missing = REQUIRED_ENV_VARS.filter((k) => !env[k]);
  if (missing.length > 0) {
    console.error(
      `FATAL: backend/.env is missing: ${missing.join(", ")}. Nothing was touched.`,
    );
    process.exit(1);
  }
  return env;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { yes: false, only: null, help: false };
  for (const raw of argv) {
    if (raw === "--help" || raw === "-h") {
      args.help = true;
    } else if (raw === "--yes") {
      args.yes = true;
    } else if (raw.startsWith("--only=")) {
      args.only = raw
        .slice("--only=".length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      console.error(`Unrecognized argument: ${raw} (see --help)`);
      process.exit(1);
    }
  }
  return args;
}

function printHelp() {
  console.log(`
Prune orphaned tenant subdomains (Cloudflare CNAME + Vercel project domain).

  node scripts/prune-orphan-domains.mjs               Dry run (default) — prints what would be removed
  node scripts/prune-orphan-domains.mjs --yes         Actually delete
  node scripts/prune-orphan-domains.mjs --only=a,b    Limit the run to these labels (still fully checked)
  node scripts/prune-orphan-domains.mjs --help        This message

An "orphan" is a label under APP_BASE_DOMAIN present in Cloudflare's DNS zone
and/or as a Vercel project domain, but that does not match any live tenant's
slug. Detection fails CLOSED: if the live tenant list can't be fetched, the
script refuses to compute orphans at all rather than risk treating a real
tenant as one (see the big comment on getTenantSlugs below).
`);
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON body (HTML error page, empty 204, etc). Caller decides if
    // that's fatal for its own endpoint.
  }
  return { status: res.status, json, text };
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Source 1 — Cloudflare DNS records
// ---------------------------------------------------------------------------

/**
 * Returns a Map<label, {id, name, content}> of CNAME records that LOOK like
 * tenant-provisioning records: single label under APP_BASE_DOMAIN, pointing
 * at Vercel. This mirrors `tools/ops-dashboard/server.mjs`'s `tenantHosts`
 * filter exactly, so the dashboard's drift numbers and this script's orphan
 * set never quietly diverge.
 */
async function getCloudflareCandidates(env) {
  const url = `https://api.cloudflare.com/client/v4/zones/${env.CLOUDFLARE_ZONE_ID}/dns_records?per_page=100`;
  const { json, status } = await fetchJson(url, {
    headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
  });
  // Cloudflare always answers 200 and wraps the real result in
  // {success, errors, result} — a bad token looks like a normal HTTP
  // response, not a fetch failure, so the error has to come from the body.
  if (!json?.success) {
    throw new Error(
      `Cloudflare dns_records lookup failed (${status}): ${json?.errors?.[0]?.message ?? "unknown error"}`,
    );
  }

  const suffix = `.${env.APP_BASE_DOMAIN}`;
  const singleLabelSuffixRe = new RegExp(`^[^.]+${escapeRegExp(suffix)}$`);
  const candidates = new Map();
  for (const r of json.result ?? []) {
    if (r.type !== "CNAME") continue;
    if (!/vercel-dns/i.test(r.content ?? "")) continue;
    if (!singleLabelSuffixRe.test(r.name)) continue; // apex, www, api, _acme-challenge.*, etc all fail this
    const label = r.name.slice(0, -suffix.length);
    candidates.set(label, { id: r.id, name: r.name, content: r.content });
  }
  return candidates;
}

async function deleteCloudflareRecord(env, recordId) {
  const url = `https://api.cloudflare.com/client/v4/zones/${env.CLOUDFLARE_ZONE_ID}/dns_records/${recordId}`;
  const { json, status } = await fetchJson(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
  });
  // Idempotent: a record that's already gone (81044 "record does not exist")
  // is the desired end state, same as `deprovisionTenantDomain`'s treatment
  // of a 404 from Vercel.
  if (json?.success) return { ok: true, detail: "DNS record deleted" };
  const code = json?.errors?.[0]?.code;
  if (status === 404 || code === 81044) {
    return { ok: true, detail: "DNS record already gone" };
  }
  return {
    ok: false,
    detail: `Cloudflare delete failed (${status}): ${json?.errors?.[0]?.message ?? "unknown error"}`,
  };
}

// ---------------------------------------------------------------------------
// Source 2 — Vercel project domains
// ---------------------------------------------------------------------------

async function getVercelDomains(env) {
  const url = `https://api.vercel.com/v9/projects/${encodeURIComponent(env.VERCEL_PROJECT_ID)}/domains?teamId=${encodeURIComponent(env.VERCEL_TEAM_ID)}`;
  const { json, status } = await fetchJson(url, {
    headers: { Authorization: `Bearer ${env.VERCEL_TOKEN}` },
  });
  if (status >= 400) {
    throw new Error(
      `Vercel domains lookup failed (${status}): ${json?.error?.message ?? "unknown error"}`,
    );
  }

  const suffix = `.${env.APP_BASE_DOMAIN}`;
  const singleLabelSuffixRe = new RegExp(`^[^.]+${escapeRegExp(suffix)}$`);
  const labels = new Set();
  for (const d of json?.domains ?? []) {
    if (typeof d.name === "string" && singleLabelSuffixRe.test(d.name)) {
      labels.add(d.name.slice(0, -suffix.length));
    }
  }
  return labels; // liratek.vercel.app, the bare apex, and www all fail the suffix test above
}

async function deleteVercelDomain(env, host) {
  const url = `https://api.vercel.com/v9/projects/${encodeURIComponent(env.VERCEL_PROJECT_ID)}/domains/${encodeURIComponent(host)}?teamId=${encodeURIComponent(env.VERCEL_TEAM_ID)}`;
  const { json, status } = await fetchJson(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${env.VERCEL_TOKEN}` },
  });
  // Same idempotency contract as `deprovisionTenantDomain`: 404 means it was
  // never registered (or already removed), which is the desired end state.
  if (status >= 200 && status < 300)
    return { ok: true, detail: "Vercel domain removed" };
  if (status === 404) return { ok: true, detail: "Vercel domain already gone" };
  return {
    ok: false,
    detail: `Vercel delete failed (${status}): ${json?.error?.code ?? "unknown error"}`,
  };
}

// ---------------------------------------------------------------------------
// Source 3 — the tenant registry (fail CLOSED)
// ---------------------------------------------------------------------------
//
// THIS IS THE SINGLE MOST IMPORTANT FUNCTION IN THE FILE.
//
// Everything else in this script computes "orphan = seen in Cloudflare/
// Vercel but not in this set". If this function returns an empty or
// incomplete set for ANY reason — a network blip, an expired super-admin
// password, a backend deploy in progress — every real tenant subdomain
// (starting with `cornertech`, the one paying tenant this exists to protect)
// looks orphaned too. A `--yes` run at that point would delete a LIVE
// tenant's hostname. So this function never returns a partial answer: it
// either returns the full, verified slug set, or it throws — and the caller
// treats a throw here as fatal for the WHOLE run, before any delete call is
// even considered, regardless of `--yes`.
async function getTenantSlugs(env) {
  // MUST go through www.liratek.shop, never api.liratek.shop directly.
  // Vercel's rewrite is what sets X-Forwarded-Host to the platform realm
  // (www./admin.) before the request reaches the backend; hit the backend's
  // own api.liratek.shop host directly and the tenant-resolution middleware
  // reads the literal Host header, treats "api" as a TENANT SLUG, finds no
  // such tenant, and refuses the login with a generic "Invalid credentials"
  // that looks exactly like a wrong password. Same trap, same fix, as
  // tools/ops-dashboard/server.mjs's `superAdminLogin` and
  // scripts/deploy-api.mjs's realm check — do not "simplify" this to
  // api.liratek.shop.
  const loginRes = await fetchJson("https://www.liratek.shop/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: env.SUPER_ADMIN_USERNAME,
      password: env.SUPER_ADMIN_PASSWORD,
    }),
  });
  // Envelope is {success, data|error} at HTTP 200 even on failure — never
  // branch on status code here, only on `success`.
  if (!loginRes.json?.success) {
    throw new Error(
      `super-admin login failed: ${loginRes.json?.error?.message ?? loginRes.json?.error ?? loginRes.status}`,
    );
  }
  const token = loginRes.json.data?.token;
  if (!token) {
    throw new Error("super-admin login reported success but returned no token");
  }

  const tenantsRes = await fetchJson(
    "https://www.liratek.shop/api/admin/tenants",
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!tenantsRes.json?.success) {
    throw new Error(
      `/api/admin/tenants failed: ${tenantsRes.json?.error?.message ?? tenantsRes.json?.error ?? tenantsRes.status}`,
    );
  }
  const tenants = tenantsRes.json.data?.tenants;
  if (!Array.isArray(tenants)) {
    throw new Error("/api/admin/tenants returned no tenants array");
  }

  const slugs = new Set(tenants.map((t) => t.slug).filter(Boolean));
  // An empty result is exactly as dangerous as a failed request — it makes
  // every subdomain look orphaned — so treat it the same way: fail closed
  // instead of quietly proceeding with an empty protected set.
  if (slugs.size === 0) {
    throw new Error(
      "/api/admin/tenants returned zero tenants — refusing to trust an empty tenant list",
    );
  }
  return slugs;
}

// ---------------------------------------------------------------------------
// Protection — never deletable, regardless of what the drift detection says
// ---------------------------------------------------------------------------

function buildProtection(env, tenantSlugs) {
  const baseDomain = env.APP_BASE_DOMAIN;
  const exactHostnames = new Set([
    baseDomain, // apex
    `www.${baseDomain}`,
    `api.${baseDomain}`,
    "liratek.vercel.app",
  ]);
  const suffix = `.${baseDomain}`;
  const singleLabelSuffixRe = new RegExp(`^[^.]+${escapeRegExp(suffix)}$`);

  /** True if `label` (a single label, no dots) must never be deleted. */
  function isProtectedLabel(label) {
    if (tenantSlugs.has(label)) return true;
    if (label.startsWith("_acme-challenge")) return true;
    if (exactHostnames.has(`${label}${suffix}`)) return true;
    return false;
  }

  /** True if `hostname` (a full name, as it appears in a CF/Vercel record)
   * is safe to act on at all — i.e. it is exactly one label under
   * APP_BASE_DOMAIN and that label isn't protected. Anything else (the
   * apex, a multi-label name, a name under a different domain entirely) is
   * refused outright rather than silently skipped, because reaching this
   * function with such a name means the candidate-collection regexes above
   * have a bug — and a bug in THAT logic is not something to paper over. */
  function isSafeToActOn(hostname) {
    if (exactHostnames.has(hostname)) return false;
    if (!singleLabelSuffixRe.test(hostname)) return false;
    const label = hostname.slice(0, -suffix.length);
    return !isProtectedLabel(label);
  }

  return { isProtectedLabel, isSafeToActOn, exactHostnames };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function printTable(rows, columns) {
  const widths = columns.map((c) =>
    Math.max(c.header.length, ...rows.map((r) => String(r[c.key]).length)),
  );
  const line = (cells) =>
    cells.map((c, i) => String(c).padEnd(widths[i])).join("  ");
  console.log(line(columns.map((c) => c.header)));
  console.log(line(widths.map((w) => "-".repeat(w))));
  for (const r of rows) console.log(line(columns.map((c) => r[c.key])));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const env = loadEnvOrExit();

  console.log(
    "Fetching the live tenant registry (this must succeed before anything else runs)...",
  );
  let tenantSlugs;
  try {
    tenantSlugs = await getTenantSlugs(env);
  } catch (err) {
    console.error(
      `\nFATAL — tenant lookup failed, nothing was touched:\n  ${err.message}\n`,
    );
    console.error(
      "Refusing to compute an orphan set without a verified tenant list — an\n" +
        "incomplete list would make every real tenant subdomain look orphaned.",
    );
    process.exit(1);
  }
  console.log(`  ${tenantSlugs.size} live tenant slug(s) loaded.`);

  console.log("Fetching Cloudflare DNS records and Vercel project domains...");
  const [cfCandidates, vercelLabels] = await Promise.all([
    getCloudflareCandidates(env),
    getVercelDomains(env),
  ]);

  const protection = buildProtection(env, tenantSlugs);

  const allLabels = new Set([...cfCandidates.keys(), ...vercelLabels]);
  const orphanLabels = [...allLabels]
    .filter(
      (label) => !tenantSlugs.has(label) && !protection.isProtectedLabel(label),
    )
    .sort();

  // Reassurance list: candidate-looking labels that WERE kept, and why.
  const keptLabels = [...allLabels]
    .filter(
      (label) => tenantSlugs.has(label) || protection.isProtectedLabel(label),
    )
    .sort();

  let targetLabels = orphanLabels;
  if (args.only) {
    const requestedSet = new Set(args.only);
    const notOrphaned = args.only.filter((l) => !orphanLabels.includes(l));
    if (notOrphaned.length > 0) {
      console.log(
        `Note: --only named label(s) not in the computed orphan set (nothing to do for them): ${notOrphaned.join(", ")}`,
      );
    }
    targetLabels = orphanLabels.filter((l) => requestedSet.has(l));
  }

  // Final safety gate, independent of how targetLabels was derived above.
  // If detection logic upstream has a bug, this is the last line of defence
  // — and per spec, a protected name reaching here means the bug is bad
  // enough that the whole run aborts rather than quietly skipping just that
  // one name.
  const host = (label) => `${label}.${env.APP_BASE_DOMAIN}`;
  for (const label of targetLabels) {
    if (!protection.isSafeToActOn(host(label))) {
      console.error(
        `\nFATAL — internal safety check refused label "${label}" (${host(label)}).\n` +
          "This means the orphan-detection logic above disagrees with the protection\n" +
          "logic, which is not safe to proceed past. Aborting the ENTIRE run without\n" +
          "deleting anything.",
      );
      process.exit(1);
    }
  }

  console.log("\n=== Would remove (orphans) ===");
  if (targetLabels.length === 0) {
    console.log("  (none)");
  } else {
    printTable(
      targetLabels.map((label) => ({
        label,
        host: host(label),
        cloudflare: cfCandidates.has(label) ? "yes" : "no",
        vercel: vercelLabels.has(label) ? "yes" : "no",
      })),
      [
        { key: "label", header: "Label" },
        { key: "host", header: "Host" },
        { key: "cloudflare", header: "Cloudflare" },
        { key: "vercel", header: "Vercel" },
      ],
    );
  }

  console.log("\n=== Untouched (protected / matches a live tenant) ===");
  if (keptLabels.length === 0) {
    console.log("  (none seen)");
  } else {
    printTable(
      keptLabels.map((label) => ({
        label,
        host: host(label),
        reason: tenantSlugs.has(label) ? "live tenant slug" : "protected",
      })),
      [
        { key: "label", header: "Label" },
        { key: "host", header: "Host" },
        { key: "reason", header: "Reason" },
      ],
    );
  }

  if (!args.yes) {
    console.log(
      targetLabels.length > 0
        ? `\nDry run only — nothing was deleted. Re-run with --yes to remove the ${targetLabels.length} label(s) above.`
        : "\nDry run only — nothing to delete.",
    );
    process.exit(0);
  }

  if (targetLabels.length === 0) {
    console.log("\nNothing to delete.");
    process.exit(0);
  }

  console.log(`\n=== Deleting ${targetLabels.length} label(s) ===`);
  let anyFailed = false;
  const summary = [];
  for (const label of targetLabels) {
    const h = host(label);
    const cfRecord = cfCandidates.get(label);

    // Cloudflare DNS record FIRST, then the Vercel domain. Reversing this
    // order leaves a window where the CNAME still points at Vercel's shared
    // edge with no project claiming that hostname on Vercel's side — exactly
    // the dangling-CNAME shape a subdomain takeover exploits. Same order as
    // `deprovisionTenantDomain` in backend/src/services/tenantDomains.ts;
    // staying consistent with it is the point.
    let cfResult = { ok: true, detail: "no DNS record to delete" };
    if (cfRecord) {
      cfResult = await deleteCloudflareRecord(env, cfRecord.id);
    }
    console.log(
      `  ${cfResult.ok ? "✓" : "✗"} [${h}] Cloudflare: ${cfResult.detail}`,
    );

    let vercelResult = { ok: true, detail: "not registered on Vercel" };
    if (vercelLabels.has(label)) {
      vercelResult = await deleteVercelDomain(env, h);
    }
    console.log(
      `  ${vercelResult.ok ? "✓" : "✗"} [${h}] Vercel: ${vercelResult.detail}`,
    );

    const ok = cfResult.ok && vercelResult.ok;
    if (!ok) anyFailed = true;
    summary.push({
      label,
      host: h,
      cloudflare: cfResult.detail,
      vercel: vercelResult.detail,
      ok,
    });
  }

  console.log("\n=== Summary ===");
  printTable(
    summary.map((s) => ({ ...s, ok: s.ok ? "OK" : "FAILED" })),
    [
      { key: "label", header: "Label" },
      { key: "host", header: "Host" },
      { key: "cloudflare", header: "Cloudflare" },
      { key: "vercel", header: "Vercel" },
      { key: "ok", header: "Result" },
    ],
  );

  process.exit(anyFailed ? 1 : 0);
}

main().catch((err) => {
  console.error(`\nUNEXPECTED FAILURE: ${err?.stack ?? err}`);
  process.exit(1);
});
