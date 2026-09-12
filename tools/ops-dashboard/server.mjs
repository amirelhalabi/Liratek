#!/usr/bin/env node
/**
 * Local-only ops dashboard for LiraTek's live services.
 *
 * A window, not a control panel: everything below is a GET against Fly,
 * Vercel, Cloudflare, and the live backend. No route here can mutate
 * anything (rule 8). It exists because "is prod okay right now" currently
 * means opening four different tools (flyctl, two dashboards, curl) and
 * cross-referencing them by hand — this just does that every 30s and shows
 * the result on one page.
 *
 *   yarn ops        →  http://127.0.0.1:4500
 *
 * Every field name and endpoint below was checked against the LIVE services
 * on 2026-09-10 (see tools/ops-dashboard/README.md's sibling contract notes).
 * Resist the urge to "clean up" a field name — these are what the APIs
 * actually return, not what would be nicer.
 */

// Must run before ANY networking happens. IPv6 is broken on this machine:
// an IPv6-first Fly/Vercel/Cloudflare host will connect and then just hang —
// no error, no timeout log, nothing — until something upstream eventually
// gives up. `AbortSignal.timeout()` below is the second line of defence;
// this is the first, and it is the one that stops the hang from happening
// at all. Losing this line costs about an hour of blaming the network.
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import http from "node:http";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Reused on purpose, not reimplemented: this repo already has one script
// that knows where flyctl lives and why (`scripts/fly.mjs`'s doc comment
// explains the Windows installer trap). We import its resolver but do NOT
// use its `fly()`/`flyCapture()` helpers — see `runFlyctl()` below for why.
import { resolveFlyctl } from "../../scripts/fly.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const PORT = Number(process.env.OPS_PORT) || 4500;
const HOST_HEADER_OK = new RegExp(`^(127\\.0\\.0\\.1|localhost):${PORT}$`);

const APP = "liratek-api";
const CACHE_TTL_MS = 15_000;

// -----------------------------------------------------------------------
// Env loading — backend/.env, by hand
// -----------------------------------------------------------------------
//
// Rule 4 forbids a dotenv dependency here (this tool has ZERO deps), so this
// is a deliberately dumb 15-line parser: skip blanks/comments, split on the
// FIRST "=" only (values may legitimately contain "=", e.g. base64 secrets),
// strip one layer of surrounding quotes. It does not export into
// `process.env` — everything reads from the returned object so this script
// can never accidentally leak backend secrets into a child process's env
// beyond the ones flyctl itself needs.
function loadBackendEnv() {
  const envPath = path.join(REPO_ROOT, "backend", ".env");
  if (!existsSync(envPath)) return null;
  const out = {};
  const text = readFileSync(envPath, "utf8");
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

const ENV = loadBackendEnv();

function envError(name) {
  return `backend/.env not found — cannot read ${name}. See tools/ops-dashboard/README.md.`;
}

// -----------------------------------------------------------------------
// Small helpers
// -----------------------------------------------------------------------

/** Never trust `err instanceof Error` here (rule 6) — this repo's own
 * `requestJson` throws a plain `{status, message, details}` object, not an
 * Error, and `message` can itself be an object (e.g. the `{code, message}`
 * shape `createErrorResponse` produces). Always fall through to `String()`. */
function errMessage(err) {
  if (err == null) return "unknown error";
  if (typeof err === "string") return err;
  const m = err.message ?? err.error?.message ?? err;
  if (typeof m === "string") return m;
  try {
    return JSON.stringify(m);
  } catch {
    return String(m);
  }
}

/** First defined value across a list of possible key-casings. flyctl mixes
 * PascalCase (GraphQL-era commands like `releases`/`volumes`) and snake_case
 * (Machines-API-era commands like `status`) depending on which backend a
 * given subcommand talks to — the pinned contract only nails down `status`'s
 * casing exactly, so `releases`/`volumes` parsing stays defensive. */
function pick(obj, keys) {
  if (!obj) return undefined;
  for (const k of keys) {
    if (obj[k] !== undefined) return obj[k];
  }
  return undefined;
}

async function timed(fn) {
  const start = Date.now();
  try {
    const data = await fn();
    return { ok: true, ms: Date.now() - start, data };
  } catch (err) {
    return { ok: false, ms: Date.now() - start, error: errMessage(err) };
  }
}

// Tiny cache: name -> { at, section }. A browser refresh (or two people
// looking at the same dashboard) should not re-hit Fly/Vercel/Cloudflare/the
// login rate limiter every time. `?fresh=1` on either API route bypasses it.
const cache = new Map();

async function cached(name, fresh, fn) {
  if (!fresh) {
    const hit = cache.get(name);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.section;
  }
  const section = await timed(fn);
  cache.set(name, { at: Date.now(), section });
  return section;
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON — caller decides whether that's fatal */
  }
  return { status: res.status, json, text };
}

// -----------------------------------------------------------------------
// flyctl — resolve once, call three (four) subcommands ourselves
// -----------------------------------------------------------------------
//
// `scripts/fly.mjs`'s `fly()`/`flyCapture()` helpers auto-append
// `--app liratek-api` to EVERY invocation unless the args already contain
// `--app`. That's convenient for the deploy script, which never calls a
// app-less subcommand, but it actively breaks anything that must NOT take
// `--app` (`version`, `auth whoami`) — those fail with "unknown flag: --app".
// So this dashboard calls `spawnSync` directly and passes `--app` itself on
// every subcommand that needs it (all of ours do).
//
// `resolveFlyctl()` itself is fine to reuse for the search logic, EXCEPT it
// calls `process.exit(1)` when nothing is found — appropriate for a one-shot
// CLI script, fatal for a long-running dashboard server. So we duplicate its
// probe (PATH, then `~/.fly/bin/flyctl.exe`) as a side-effect-free check
// first, and only call the real `resolveFlyctl()` once we already know it
// will succeed. One missing binary must never take the whole server down.
function flyctlAvailable() {
  for (const bin of ["flyctl", "fly"]) {
    const probe = spawnSync(bin, ["version"], {
      stdio: "ignore",
      shell: process.platform === "win32",
    });
    if (probe.status === 0) return true;
  }
  const candidate =
    process.platform === "win32"
      ? path.join(homedir(), ".fly", "bin", "flyctl.exe")
      : path.join(homedir(), ".fly", "bin", "flyctl");
  return existsSync(candidate);
}

function runFlyctl(args, timeoutMs) {
  const bin = resolveFlyctl(); // safe: only reached after flyctlAvailable() === true
  const r = spawnSync(bin, [...args, "--app", APP], {
    encoding: "utf8",
    shell: false,
    timeout: timeoutMs,
    env: { ...process.env, FLY_NO_UPDATE_CHECK: "1" },
  });
  if (r.error) {
    // Covers ETIMEDOUT (spawnSync's `timeout` kills the child but still sets
    // `.error` on some Node versions) and ENOENT.
    throw new Error(`flyctl ${args[0]}: ${r.error.message}`);
  }
  if (r.status !== 0) {
    const firstStderrLine =
      (r.stderr || "").split(/\r?\n/).find((l) => l.trim()) ??
      `exit ${r.status}`;
    throw new Error(`flyctl ${args[0]}: ${firstStderrLine}`);
  }
  return JSON.parse(r.stdout);
}

async function getFlySection() {
  if (!flyctlAvailable()) {
    throw new Error(
      "flyctl not found on PATH or ~/.fly/bin — see scripts/fly.mjs",
    );
  }

  const status = runFlyctl(["status", "--json"], 15_000);
  const releases = runFlyctl(["releases", "--json"], 15_000);
  const volumesRaw = runFlyctl(["volumes", "list", "--json"], 15_000);

  const machines = (status.Machines ?? []).map((m) => {
    const checks = (m.checks ?? []).map((c) => {
      let output = c.output;
      try {
        output = JSON.parse(c.output);
      } catch {
        // `/health`'s body wasn't JSON, or the check has no output yet —
        // the contract says fall back to the raw string, so keep it as-is.
      }
      return { name: c.name, status: c.status, output };
    });
    const recentEvents = (m.events ?? [])
      .slice()
      .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
      .slice(0, 5)
      .map((e) => ({
        type: e.type,
        status: e.status,
        source: e.source,
        at: e.timestamp ? new Date(e.timestamp).toISOString() : null,
      }));
    return {
      id: m.id,
      name: m.name,
      state: m.state,
      region: m.region,
      imageTag: m.image_ref?.tag ?? null,
      createdAt: m.created_at,
      updatedAt: m.updated_at,
      cpuKind: m.config?.guest?.cpu_kind ?? null,
      cpus: m.config?.guest?.cpus ?? null,
      memoryMb: m.config?.guest?.memory_mb ?? null,
      hostStatus: m.host_status,
      cordoned: m.cordoned,
      checks,
      recentEvents,
    };
  });

  const releaseList = (Array.isArray(releases) ? releases : [])
    .map((r) => ({
      version: pick(r, ["Version", "version"]),
      status: pick(r, ["Status", "status"]),
      description: pick(r, ["Description", "description"]),
      reason: pick(r, ["Reason", "reason"]),
      createdAt: pick(r, ["CreatedAt", "created_at"]),
      user:
        pick(r, ["User", "user"])?.Email ??
        pick(r, ["User", "user"])?.email ??
        pick(r, ["User", "user"]) ??
        null,
      imageRef: pick(r, ["ImageRef", "image_ref"]),
      inProgress: pick(r, ["InProgress", "in_progress"]) ?? false,
      stable: pick(r, ["Stable", "stable"]) ?? false,
    }))
    .sort((a, b) => Number(b.version ?? 0) - Number(a.version ?? 0))
    .slice(0, 10);

  const volumeList = Array.isArray(volumesRaw) ? volumesRaw : [];
  const volumes = volumeList.map((v) => {
    const id = pick(v, ["id", "ID"]);
    let snapshots = [];
    try {
      const snapRaw = id
        ? runFlyctl(["volumes", "snapshots", "list", id, "--json"], 15_000)
        : [];
      snapshots = (Array.isArray(snapRaw) ? snapRaw : []).map((s) => ({
        id: pick(s, ["id", "ID"]),
        createdAt: pick(s, ["created_at", "CreatedAt"]),
        size: pick(s, ["size", "Size"]),
        status: pick(s, ["status", "Status"]),
      }));
    } catch {
      // A young volume legitimately has no snapshots; the contract says [] is
      // normal. Any other failure here shouldn't blank out the whole `fly`
      // section over one volume's snapshot list, so swallow and move on.
      snapshots = [];
    }
    return {
      id,
      name: pick(v, ["name", "Name"]),
      sizeGb: pick(v, ["size_gb", "SizeGb", "SizeGB"]),
      region: pick(v, ["region", "Region"]),
      state: pick(v, ["state", "State"]),
      encrypted: pick(v, ["encrypted", "Encrypted"]) ?? false,
      attachedMachineId:
        pick(v, ["attached_machine_id", "AttachedMachineId"]) ?? null,
      snapshotRetention:
        pick(v, ["snapshot_retention", "SnapshotRetention"]) ?? null,
      autoBackupEnabled:
        pick(v, ["auto_backup_enabled", "AutoBackupEnabled"]) ?? false,
      hostStatus: pick(v, ["host_status", "HostStatus"]) ?? null,
      snapshots,
    };
  });

  const machineCount = machines.length;
  return {
    app: APP,
    name: status.Name,
    hostname: status.Hostname,
    deployed: status.Deployed,
    status: status.Status,
    platformVersion: status.PlatformVersion,
    organization:
      status.Organization && typeof status.Organization === "object"
        ? status.Organization.Name || status.Organization.Slug || null
        : (status.Organization ?? null),
    machineCount,
    // machineCount !== 1 is an INCIDENT, not spare capacity — SQLite has one
    // writer, and two machines on this volume means active corruption
    // (fly.toml says so at length). The UI renders this false as hard red.
    machineCountOk: machineCount === 1,
    machines,
    releases: releaseList,
    volumes,
  };
}

// -----------------------------------------------------------------------
// Vercel
// -----------------------------------------------------------------------

async function getVercelSection() {
  if (!ENV) throw new Error(envError("VERCEL_TOKEN"));
  const { VERCEL_TOKEN, VERCEL_PROJECT_ID, VERCEL_TEAM_ID } = ENV;
  if (!VERCEL_TOKEN || !VERCEL_PROJECT_ID) {
    throw new Error(
      "VERCEL_TOKEN / VERCEL_PROJECT_ID missing from backend/.env",
    );
  }
  const headers = { Authorization: `Bearer ${VERCEL_TOKEN}` };
  const qs = (extra) => {
    const p = new URLSearchParams({ projectId: VERCEL_PROJECT_ID, ...extra });
    if (VERCEL_TEAM_ID) p.set("teamId", VERCEL_TEAM_ID);
    return p.toString();
  };

  const [depRes, domRes] = await Promise.all([
    fetchJson(`https://api.vercel.com/v6/deployments?${qs({ limit: "10" })}`, {
      headers,
    }),
    fetchJson(
      `https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}/domains${VERCEL_TEAM_ID ? `?teamId=${VERCEL_TEAM_ID}` : ""}`,
      { headers },
    ),
  ]);

  if (depRes.status >= 400)
    throw new Error(
      `Vercel deployments ${depRes.status}: ${depRes.json?.error?.message ?? depRes.text.slice(0, 200)}`,
    );
  if (domRes.status >= 400)
    throw new Error(
      `Vercel domains ${domRes.status}: ${domRes.json?.error?.message ?? domRes.text.slice(0, 200)}`,
    );

  const deployments = (depRes.json?.deployments ?? []).map((d) => ({
    uid: d.uid,
    state: d.state ?? d.readyState ?? null,
    target: d.target ?? null,
    createdAt: d.created ? new Date(d.created).toISOString() : null,
    url: d.url,
    branch: d.meta?.githubCommitRef ?? null,
    commitMessage: d.meta?.githubCommitMessage ?? null,
    commitSha: d.meta?.githubCommitSha ?? null,
    author: d.meta?.githubCommitAuthorName ?? d.creator?.username ?? null,
    buildMs: d.ready && d.buildingAt ? d.ready - d.buildingAt : null,
  }));

  const domains = (domRes.json?.domains ?? []).map((d) => ({
    name: d.name,
    verified: d.verified,
    apexName: d.apexName,
    redirect: d.redirect ?? null,
  }));

  return {
    // ids are not secrets — the TOKEN is what never leaves this server.
    projectId: VERCEL_PROJECT_ID,
    teamId: VERCEL_TEAM_ID ?? null,
    deployments,
    domains,
    productionUrl: "https://www.liratek.shop",
  };
}

// -----------------------------------------------------------------------
// Cloudflare
// -----------------------------------------------------------------------

async function getCloudflareSection() {
  if (!ENV) throw new Error(envError("CLOUDFLARE_API_TOKEN"));
  const { CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID, APP_BASE_DOMAIN } = ENV;
  if (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ZONE_ID) {
    throw new Error(
      "CLOUDFLARE_API_TOKEN / CLOUDFLARE_ZONE_ID missing from backend/.env",
    );
  }
  const headers = { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` };
  const base = `https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}`;

  const [zoneRes, recRes] = await Promise.all([
    fetchJson(base, { headers }),
    fetchJson(`${base}/dns_records?per_page=100`, { headers }),
  ]);

  // Cloudflare always answers 200 and wraps the real result in
  // {success, errors, result} — a bad token looks like a normal HTTP
  // response, not a fetch failure, so the error has to come from the body.
  if (!zoneRes.json?.success)
    throw new Error(
      zoneRes.json?.errors?.[0]?.message ??
        `zone lookup failed (${zoneRes.status})`,
    );
  if (!recRes.json?.success)
    throw new Error(
      recRes.json?.errors?.[0]?.message ??
        `dns_records lookup failed (${recRes.status})`,
    );

  const z = zoneRes.json.result;
  const records = (recRes.json.result ?? [])
    .map((r) => ({
      type: r.type,
      name: r.name,
      content: r.content,
      proxied: !!r.proxied,
      ttl: r.ttl,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const baseDomain = APP_BASE_DOMAIN || z.name;
  // "Single-label CNAME under the zone pointing at Vercel, minus www" — i.e.
  // the tenant-provisioning CNAMEs `tenantDomains.ts` creates for
  // `<slug>.<APP_BASE_DOMAIN>`. `www` is the platform host, not a tenant.
  const tenantHosts = records
    .filter((r) => r.type === "CNAME" && /vercel-dns/i.test(r.content))
    .map((r) =>
      r.name.endsWith(`.${baseDomain}`)
        ? r.name.slice(0, -(baseDomain.length + 1))
        : r.name,
    )
    .filter((label) => label && label !== "www" && !label.includes("."));

  return {
    zone: {
      name: z.name,
      status: z.status,
      paused: z.paused,
      type: z.type,
      plan: z.plan?.name ?? null,
      nameServers: z.name_servers ?? [],
      originalNameServers: z.original_name_servers ?? [],
    },
    records,
    tenantHosts,
  };
}

// -----------------------------------------------------------------------
// Backend health
// -----------------------------------------------------------------------

async function getBackendSection() {
  const baseUrl = "https://www.liratek.shop";
  const basicStart = Date.now();
  const basic = await fetchJson(`${baseUrl}/health`);
  const basicMs = Date.now() - basicStart;
  if (basic.status >= 400 && !basic.json) {
    throw new Error(`/health unreachable (${basic.status})`);
  }

  const detailedRes = await fetchJson(`${baseUrl}/health/detailed`);
  const d = detailedRes.json ?? {};
  const notes = [];

  // KNOWN FALSE ALARM: the memory check's "healthy" threshold is ~52MB of
  // heap on a 512MB Fly machine, and Node idles around 93% of that just
  // running the process — so `checks.memory.healthy: false` (and therefore
  // the top-level `status: "unhealthy"`) is the NORMAL steady state, not an
  // outage. The real signal is the database check plus reachability, so
  // that's what drives the red/green light here; memory is surfaced as an
  // informational note instead of painting the whole dashboard red for
  // something that trips on every single poll.
  if (d.checks?.memory && d.checks.memory.healthy === false) {
    notes.push(
      "memory check uses a ~52MB heap threshold and trips routinely — not an outage signal; database + reachability are the real lights",
    );
  }

  return {
    baseUrl,
    reachable: true,
    basicStatus: basic.json?.status ?? null,
    basicMs,
    detailed: {
      status: d.status ?? null,
      uptimeSeconds: d.uptime ?? null,
      version: d.version ?? null,
      database: d.checks?.database ?? null,
      memory: d.checks?.memory ?? null,
      system: d.checks?.system ?? null,
    },
    notes,
  };
}

// -----------------------------------------------------------------------
// Tenants — super-admin login (cached), two admin reads, reconciliation
// -----------------------------------------------------------------------

// Cached at module scope so it survives across polls, not just within one
// request. There's a login rate limiter in front of `/api/auth/login`; a
// dashboard that logged in on every 30s poll would eventually lock the owner
// out of their own admin account. Only re-login when we have no token, or
// when the backend tells us it's no longer valid (401).
let jwtCache = null; // { token }

async function superAdminLogin() {
  const { SUPER_ADMIN_USERNAME, SUPER_ADMIN_PASSWORD } = ENV;
  if (!SUPER_ADMIN_USERNAME || !SUPER_ADMIN_PASSWORD) {
    throw new Error(
      "SUPER_ADMIN_USERNAME / SUPER_ADMIN_PASSWORD missing from backend/.env",
    );
  }
  // MUST go through www.liratek.shop, never api.liratek.shop directly.
  // Vercel's rewrite is what sets X-Forwarded-Host to the platform realm
  // (www./admin.) before the request reaches the backend; hit the backend's
  // own api.liratek.shop host directly and the tenant-resolution middleware
  // reads the literal Host header, treats "api" as a TENANT SLUG, finds no
  // such tenant, and refuses the login with a generic "Invalid credentials"
  // that looks exactly like a wrong password. This has already cost someone
  // an afternoon elsewhere in this repo (see docs/DEPLOYMENT.md §8) — do not
  // "simplify" this to api.liratek.shop, it will silently break super-admin
  // login for this dashboard.
  const res = await fetchJson("https://www.liratek.shop/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: SUPER_ADMIN_USERNAME,
      password: SUPER_ADMIN_PASSWORD,
    }),
  });
  // Envelope is {success, data|error} at HTTP 200 even on failure — never
  // branch on status code here.
  if (!res.json?.success) {
    throw new Error(
      `super-admin login failed: ${errMessage(res.json?.error) ?? res.status}`,
    );
  }
  jwtCache = { token: res.json.data.token };
  return jwtCache.token;
}

async function adminGet(pathname) {
  let token = jwtCache?.token ?? (await superAdminLogin());
  let res = await fetchJson(`https://www.liratek.shop${pathname}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    jwtCache = null;
    token = await superAdminLogin();
    res = await fetchJson(`https://www.liratek.shop${pathname}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }
  if (!res.json?.success) {
    throw new Error(
      `${pathname} failed: ${errMessage(res.json?.error) ?? res.status}`,
    );
  }
  return res.json.data;
}

async function getTenantsSection(vercelSection, cloudflareSection) {
  if (!ENV) throw new Error(envError("SUPER_ADMIN_USERNAME"));

  const [tenantsData, subsData] = await Promise.all([
    adminGet("/api/admin/tenants"),
    adminGet("/api/admin/subscriptions"),
  ]);

  const baseDomain = ENV.APP_BASE_DOMAIN || "liratek.shop";
  const subsByTenantId = new Map(
    (subsData.subscriptions ?? []).map((s) => [s.tenant_id, s]),
  );

  const cfHosts = cloudflareSection.ok
    ? new Set(cloudflareSection.data.tenantHosts)
    : null;
  const vercelDomainNames = vercelSection.ok
    ? new Set(vercelSection.data.domains.map((d) => d.name))
    : null;

  const tenants = (tenantsData.tenants ?? []).map((t) => {
    const sub = subsByTenantId.get(t.id) ?? null;
    return {
      id: t.id,
      name: t.name,
      slug: t.slug,
      status: t.status,
      userCount: t.user_count,
      lastActivity: t.last_activity,
      createdAt: t.created_at,
      url: `https://${t.slug}.${baseDomain}`,
      subscription: sub
        ? {
            plan: sub.plan,
            status: sub.status,
            currentPeriodEnd: sub.current_period_end,
            graceEndsAt: sub.grace_ends_at,
            // Never forward the real key (rule 3 / contract): boolean only.
            hasLicenseKey: !!sub.license_key,
          }
        : null,
      dns: cfHosts ? cfHosts.has(t.slug) : null,
      vercelDomain: vercelDomainNames
        ? vercelDomainNames.has(`${t.slug}.${baseDomain}`)
        : null,
    };
  });

  // Reconciliation happens here, server-side, because this handler already
  // has both the Cloudflare and Vercel payloads from the SAME /api/summary
  // fan-out — recomputing them with fresh requests would be wasteful and
  // could race against a differently-timed cache expiry.
  let drift;
  if (!cloudflareSection.ok || !vercelSection.ok) {
    drift = { orphanDns: null, missingDns: null, orphanVercel: null };
    drift.reason = "cannot reconcile — Cloudflare/Vercel unavailable";
  } else {
    const tenantSlugs = new Set(tenants.map((t) => t.slug));
    const orphanDns = [...cfHosts].filter((h) => !tenantSlugs.has(h));
    const missingDns = tenants
      .filter((t) => !cfHosts.has(t.slug))
      .map((t) => t.slug);
    const orphanVercel = [...vercelDomainNames]
      .filter((name) => name.endsWith(`.${baseDomain}`))
      .map((name) => name.slice(0, -(baseDomain.length + 1)))
      .filter((label) => label && label !== "www" && !tenantSlugs.has(label));
    drift = { orphanDns, missingDns, orphanVercel };
  }

  return {
    tenants,
    sellableModules: subsData.sellableModules ?? [],
    drift,
  };
}

// -----------------------------------------------------------------------
// Backups — what's knowable, with or without an R2-scoped token
// -----------------------------------------------------------------------

async function getBackupsSection(flySection) {
  const volumeSnapshots = flySection.ok
    ? flySection.data.volumes.flatMap((v) =>
        v.snapshots.map((s) => ({ volumeId: v.id, ...s })),
      )
    : [];

  const base = {
    bucket: "liratek-backups",
    prefix: "web/liratek",
    syncInterval: "1s",
    // LITESTREAM_* only exist on the Fly machine's env, never locally — this
    // is a statement about the LOCAL env this dashboard runs in, not about
    // whether replication is actually happening (that's the `logs` section's
    // litestream verdict).
    endpointConfigured: !!(
      ENV &&
      (ENV.LITESTREAM_ACCESS_KEY_ID || ENV.LITESTREAM_BUCKET)
    ),
    volumeSnapshots,
    note: "The bucket holds .ltx transaction segments, not a .db file — nothing to download and open; `litestream restore` reassembles them.",
  };

  const R2_API_TOKEN = ENV?.R2_API_TOKEN;
  const R2_ACCOUNT_ID = ENV?.R2_ACCOUNT_ID;
  if (!R2_API_TOKEN || !R2_ACCOUNT_ID) {
    return {
      ...base,
      r2: {
        available: false,
        reason:
          "CLOUDFLARE_API_TOKEN is zone-scoped (DNS only); the R2 API rejects it. Add an R2-scoped token as R2_API_TOKEN + R2_ACCOUNT_ID to backend/.env to light this up.",
      },
    };
  }

  try {
    const res = await fetchJson(
      `https://api.cloudflare.com/client/v4/accounts/${R2_ACCOUNT_ID}/r2/buckets`,
      {
        headers: { Authorization: `Bearer ${R2_API_TOKEN}` },
      },
    );
    if (!res.json?.success)
      throw new Error(
        res.json?.errors?.[0]?.message ?? `r2 buckets failed (${res.status})`,
      );
    return {
      ...base,
      r2: {
        available: true,
        buckets: (res.json.result ?? []).map((b) => ({
          name: b.name,
          creation_date: b.creation_date,
        })),
      },
    };
  } catch (err) {
    // Degrade, never throw — an R2 hiccup shouldn't take out the whole
    // `backups` card when the fly-volume-snapshot half of it is still fine.
    return {
      ...base,
      r2: { available: false, reason: errMessage(err) },
    };
  }
}

// -----------------------------------------------------------------------
// Logs — the slow one
// -----------------------------------------------------------------------

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const PINO_LEVELS = {
  10: "trace",
  20: "debug",
  30: "info",
  40: "warn",
  50: "error",
  60: "fatal",
};

function parseLogLine(raw) {
  const line = raw.replace(ANSI_RE, "");
  // "2026-09-09T21:41:18Z app[d8962dea53d438] fra [info]{...json...}"
  const m = line.match(/^(\S+)\s+app\[([^\]]+)\]\s+(\S+)\s+\[(\w+)\]\s*(.*)$/);
  if (!m)
    return { at: null, machine: null, region: null, level: null, text: line };
  const [, at, machine, region, flyLevel, tail] = m;
  const braceIdx = tail.indexOf("{");
  let parsed = null;
  if (braceIdx !== -1) {
    try {
      parsed = JSON.parse(tail.slice(braceIdx));
    } catch {
      parsed = null; // keep raw tail as `text` below
    }
  }
  if (parsed) {
    return {
      at,
      machine,
      region,
      level: PINO_LEVELS[parsed.level] ?? flyLevel,
      method: parsed.method ?? null,
      url: parsed.url ?? null,
      statusCode: parsed.statusCode ?? null,
      durationMs: parsed.duration ?? null,
      msg: parsed.msg ?? null,
      text: null,
    };
  }
  return { at, machine, region, level: flyLevel, text: tail };
}

async function getLogsSection(limit) {
  if (!flyctlAvailable()) {
    throw new Error(
      "flyctl not found on PATH or ~/.fly/bin — see scripts/fly.mjs",
    );
  }
  const bin = resolveFlyctl();
  const r = spawnSync(bin, ["logs", "--no-tail", "--app", APP], {
    encoding: "utf8",
    shell: false,
    timeout: 60_000, // ~35KB of logs, a few seconds normally — 60s is slack, not the expectation
    env: { ...process.env, FLY_NO_UPDATE_CHECK: "1" },
    maxBuffer: 16 * 1024 * 1024,
  });
  if (r.error) throw new Error(`flyctl logs: ${r.error.message}`);
  if (r.status !== 0) {
    const firstLine =
      (r.stderr || "").split(/\r?\n/).find((l) => l.trim()) ??
      `exit ${r.status}`;
    throw new Error(`flyctl logs: ${firstLine}`);
  }
  const rawLines = (r.stdout || "").split(/\r?\n/).filter((l) => l.trim());
  const parsed = rawLines.map(parseLogLine);
  const machineIds = [...new Set(parsed.map((l) => l.machine).filter(Boolean))];

  const counts = {
    total: parsed.length,
    error: 0,
    warn: 0,
    http4xx: 0,
    http5xx: 0,
  };
  for (const l of parsed) {
    if (l.level === "error" || l.level === "fatal") counts.error++;
    else if (l.level === "warn") counts.warn++;
    if (typeof l.statusCode === "number") {
      if (l.statusCode >= 400 && l.statusCode < 500) counts.http4xx++;
      else if (l.statusCode >= 500) counts.http5xx++;
    }
  }

  // Litestream verdict — mirrors scripts/deploy-api.mjs's own logic exactly
  // (that script already learned the hard way not to hard-fail on this; see
  // its comment). Order matters: "exited" is checked first because an app
  // that both booted litestream once and later crashed it would otherwise
  // match "replicating" from the earlier, now-stale line.
  const full = r.stdout || "";
  let litestream;
  if (/litestream exited/i.test(full)) {
    const evidence =
      full.split(/\r?\n/).find((l) => /litestream exited/i.test(l)) ?? null;
    litestream = { verdict: "exited", evidence };
  } else if (/litestream replicating/i.test(full)) {
    const evidence =
      full.split(/\r?\n/).find((l) => /litestream replicating/i.test(l)) ??
      null;
    litestream = { verdict: "replicating", evidence };
  } else if (/Litestream NOT configured/i.test(full)) {
    const evidence =
      full.split(/\r?\n/).find((l) => /Litestream NOT configured/i.test(l)) ??
      null;
    litestream = { verdict: "not-configured", evidence };
  } else {
    // NORMAL steady state, not a problem: the boot marker is printed once
    // and `fly logs --no-tail` only returns a short recent window, so with
    // any traffic at all (this app health-checks itself every 15s) the
    // marker scrolls out within minutes. Render this grey, not red.
    litestream = {
      verdict: "unknown",
      evidence: null,
      note: "no boot marker in the current log window (normal — markers scroll away; `yarn api:verify` checks it at deploy time)",
    };
  }

  const lines = parsed.slice(-Math.max(1, limit));
  return { machineIds, lines, counts, litestream };
}

// -----------------------------------------------------------------------
// HTTP server
// -----------------------------------------------------------------------

const PUBLIC_DIR = path.join(__dirname, "public");
const INDEX_HTML = path.join(PUBLIC_DIR, "index.html");

function sendJson(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(json),
  });
  res.end(json);
}

async function buildSummary(fresh) {
  const [fly, vercel, cloudflare, backend] = await Promise.all([
    cached("fly", fresh, getFlySection),
    cached("vercel", fresh, getVercelSection),
    cached("cloudflare", fresh, getCloudflareSection),
    cached("backend", fresh, getBackendSection),
  ]);

  // `tenants` and `backups` each need another section's already-fetched
  // result (reconciliation, and reused volume-snapshot data respectively) —
  // computed after the four independent ones above, but still each wrapped
  // in its own try/catch via `cached()`/`timed()` so a failure here can
  // never blank the sections that already succeeded (rule: one broken
  // source, one broken card).
  const [tenants, backups] = await Promise.all([
    cached("tenants", fresh, () => getTenantsSection(vercel, cloudflare)),
    cached("backups", fresh, () => getBackupsSection(fly)),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    sections: { fly, vercel, cloudflare, backend, tenants, backups },
  };
}

async function buildLogs(fresh, limit) {
  const logs = await cached(`logs:${limit}`, fresh, () =>
    getLogsSection(limit),
  );
  return { generatedAt: new Date().toISOString(), sections: { logs } };
}

const server = http.createServer(async (req, res) => {
  try {
    // Cheap DNS-rebinding guard (rule 1): a page served from some other
    // origin cannot get a browser to send a Host header that matches this,
    // so this alone keeps a malicious page from using the victim's browser
    // as a proxy into this dashboard.
    const hostHeader = req.headers.host ?? "";
    if (!HOST_HEADER_OK.test(hostHeader)) {
      sendJson(res, 403, { error: "forbidden host" });
      return;
    }

    const url = new URL(req.url, `http://${hostHeader}`);
    const fresh = url.searchParams.get("fresh") === "1";

    if (req.method !== "GET") {
      sendJson(res, 405, { error: "read-only dashboard — GET only" });
      return;
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      if (!existsSync(INDEX_HTML)) {
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        res.end(
          "ops dashboard: page not built yet (tools/ops-dashboard/public/index.html is missing)\n",
        );
        return;
      }
      const html = readFileSync(INDEX_HTML);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    if (url.pathname === "/api/summary") {
      const summary = await buildSummary(fresh);
      sendJson(res, 200, summary);
      return;
    }

    if (url.pathname === "/api/logs") {
      const limit = Math.min(
        1000,
        Math.max(1, Number(url.searchParams.get("limit")) || 100),
      );
      const logs = await buildLogs(fresh, limit);
      sendJson(res, 200, logs);
      return;
    }

    sendJson(res, 404, { error: "not found" });
  } catch (err) {
    // Should be unreachable — every section function is wrapped by
    // `timed()`/`cached()` — but a server that 500s with a stack trace on a
    // typo is worse than one that says so plainly.
    sendJson(res, 500, { error: errMessage(err) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[ops-dashboard] http://127.0.0.1:${PORT} (localhost-only)`);
  if (!ENV) {
    console.log(
      "[ops-dashboard] backend/.env not found — credential-dependent sections will report errors, not crash",
    );
  }
});
