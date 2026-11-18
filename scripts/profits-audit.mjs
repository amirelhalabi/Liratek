#!/usr/bin/env node
/**
 * Profits audit (LIRA-397): reads one shop's Profits views over the web API
 * and checks that they agree with each other and that every drill-down row
 * makes sense. Read-only — the only writes are the login session and the
 * Profits unlock, both released at the end.
 *
 *   LIRATEK_PASSWORD=… LIRATEK_PROFITS_PASSWORD=… \
 *   yarn profits:audit --host cornertech.liratek.shop --user admin \
 *                      --from 2026-09-01 --to 2026-11-16
 *                      [--json] [--module SALE] [--strict-zero-rows]
 *                      [--save-input <file>]
 *   yarn profits:audit --input <file> [--json] [--strict-zero-rows]   (offline replay)
 *
 * Secrets come ONLY from the environment and are never printed or written
 * anywhere (`--save-input` writes the fetched views, never a password or the
 * token); the bearer token lives in memory for the length of the run.
 *
 * Requests are strictly sequential: each one starts at least 300 ms after the
 * previous RESPONSE finished. The server runs better-sqlite3, which is
 * synchronous: parallel Profits calls have taken production down (LIRA-376).
 * A timed-out request stops the run — the server is still busy with it, so
 * firing the next one would stack load. Never run two audits at once.
 *
 * Exit: 0 no FAIL · 1 at least one FAIL · 2 usage / login / unlock / fetch error.
 * The checks themselves live in scripts/lib/profitsAuditChecks.mjs.
 */
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { runAllChecks, formatReport } from "./lib/profitsAuditChecks.mjs";

const MIN_GAP_MS = 300;
const REQUEST_TIMEOUT_MS = 120_000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const USAGE = `Usage: LIRATEK_PASSWORD=… LIRATEK_PROFITS_PASSWORD=… \\
  node scripts/profits-audit.mjs --host <shop host> --user <username> --from YYYY-MM-DD --to YYYY-MM-DD
                                 [--json] [--module <MODULE_KEY>] [--strict-zero-rows] [--save-input <file>]
  node scripts/profits-audit.mjs --input <file> [--json] [--strict-zero-rows]`;

class UsageError extends Error {}
class StepError extends Error {}

export function parseArgs(argv) {
  const opts = { json: false, strictZeroRows: false, module: null };
  const valued = {
    "--host": "host",
    "--user": "user",
    "--from": "from",
    "--to": "to",
    "--module": "module",
    "--save-input": "saveInput",
    "--input": "input",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") opts.json = true;
    else if (a === "--strict-zero-rows") opts.strictZeroRows = true;
    else if (a === "--help" || a === "-h") throw new UsageError("");
    else if (valued[a]) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--"))
        throw new UsageError(`${a} needs a value`);
      opts[valued[a]] = v;
      i++;
    } else {
      // Never echo what follows an unknown flag: it may be a password.
      throw new UsageError(
        `unknown option ${a.split("=")[0]} — passwords are read from LIRATEK_PASSWORD / LIRATEK_PROFITS_PASSWORD only`,
      );
    }
  }
  if (opts.input) {
    if (opts.host || opts.user || opts.saveInput || opts.module)
      throw new UsageError(
        "--input replays a saved run: do not combine it with --host/--user/--module/--save-input",
      );
    return opts;
  }
  for (const k of ["host", "user", "from", "to"]) {
    if (!opts[k]) throw new UsageError(`missing --${k}`);
  }
  if (!DAY.test(opts.from) || !DAY.test(opts.to))
    throw new UsageError("--from / --to must be YYYY-MM-DD");
  if (opts.from > opts.to) throw new UsageError("--from is after --to");
  opts.base = /^https?:\/\//.test(opts.host)
    ? opts.host.replace(/\/+$/, "")
    : `https://${opts.host}`;
  return opts;
}

function readSecrets(env) {
  const missing = ["LIRATEK_PASSWORD", "LIRATEK_PROFITS_PASSWORD"].filter(
    (k) => !env[k],
  );
  if (missing.length)
    throw new UsageError(
      `missing environment variable(s): ${missing.join(", ")}`,
    );
  return {
    password: env.LIRATEK_PASSWORD,
    profitsPassword: env.LIRATEK_PROFITS_PASSWORD,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A strictly sequential client: one request in flight, and each request
 * starts ≥ MIN_GAP_MS after the previous response was fully read.
 */
function makeClient(base) {
  let token = null;
  let lastEnd = 0;
  const timings = [];

  async function call(method, path, body, label) {
    const wait = lastEnd + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    const started = Date.now();
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      let res;
      try {
        res = await fetch(`${base}${path}`, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (e) {
        throw new StepError(
          `${method} ${label}: ${e.name === "TimeoutError" ? `timed out after ${REQUEST_TIMEOUT_MS / 1000} s` : e.message}`,
        );
      }
      const text = await res.text();
      timings.push({ endpoint: label, ms: Date.now() - started });
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* HTML error page */
      }
      return { status: res.status, json };
    } finally {
      lastEnd = Date.now();
    }
  }

  return {
    call,
    timings,
    setToken: (t) => (token = t),
    hasToken: () => token !== null,
  };
}

const errorText = (r) => {
  const e = r.json?.error;
  const msg = typeof e === "string" ? e : e?.message;
  return `HTTP ${r.status}${msg ? ` — ${msg}` : ""}`;
};

/** Fetches every view into `input` (mutated as it goes, so a failure keeps what was read). */
async function fetchAll(opts, secrets, input) {
  const client = makeClient(opts.base);
  const q = `from=${opts.from}&to=${opts.to}`;
  input.timings = client.timings;

  const need = async (path, label) => {
    const r = await client.call("GET", path, undefined, label);
    if (r.status !== 200 || r.json?.success !== true)
      throw new StepError(`GET ${label}: ${errorText(r)}`);
    return r.json.data;
  };

  try {
    const login = await client.call(
      "POST",
      "/api/auth/login",
      { username: opts.user, password: secrets.password },
      "/auth/login",
    );
    const token = login.json?.data?.token;
    if (login.status !== 200 || login.json?.success !== true || !token)
      throw new StepError(`login failed: ${errorText(login)}`);
    client.setToken(token);

    const unlock = await client.call(
      "POST",
      "/api/profits/unlock",
      { password: secrets.profitsPassword },
      "/profits/unlock",
    );
    if (unlock.status !== 200 || unlock.json?.success !== true)
      throw new StepError(`Profits unlock failed: ${errorText(unlock)}`);

    input.byModule = await need(`/api/profits/by-module?${q}`, "/by-module");
    const keys = input.byModule
      .map((r) => r.module)
      .filter((m) => !opts.module || m === opts.module);
    if (opts.module && keys.length === 0)
      throw new StepError(
        `module ${opts.module} is not in By Module for this range (keys: ${input.byModule.map((r) => r.module).join(", ")})`,
      );
    for (const m of keys) {
      const label = `/module-detail ${m}`;
      const r = await client.call(
        "GET",
        `/api/profits/module-detail?module=${encodeURIComponent(m)}&${q}`,
        undefined,
        label,
      );
      if (r.status === 200 && r.json?.success === true)
        input.details[m] = { ok: true, data: r.json.data };
      else if (r.status === 200 && r.json?.success === false)
        input.details[m] = { ok: false, error: r.json.error ?? "no detail" };
      else throw new StepError(`GET ${label}: ${errorText(r)}`);
    }
    input.summary = await need(`/api/profits/summary?${q}`, "/summary");
    input.byDate = await need(`/api/profits/by-date?${q}`, "/by-date");
    input.byUser = await need(`/api/profits/by-user?${q}`, "/by-user");
    input.byClient = await need(
      `/api/profits/by-client?${q}&limit=20`,
      "/by-client",
    );
    input.byPaymentMethod = await need(
      `/api/profits/by-payment-method?${q}`,
      "/by-payment-method",
    );
  } finally {
    // Best effort: release the unlock and the session even after a failure.
    if (client.hasToken()) {
      const n = client.timings.length;
      await client
        .call("POST", "/api/profits/lock", {}, "/profits/lock")
        .catch(() => {});
      await client
        .call("POST", "/api/auth/logout", {}, "/auth/logout")
        .catch(() => {});
      client.setToken(null);
      client.timings.splice(n);
    }
  }
}

/** The fetched views only — never a password or the token. */
function saveInput(file, input, opts) {
  const { host, from, to, module } = opts;
  fs.writeFileSync(
    file,
    `${JSON.stringify({ meta: { host, from, to, module }, input }, null, 2)}\n`,
    { mode: 0o600 },
  );
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  let opts;
  try {
    opts = parseArgs(argv);
    let input;
    let meta;
    let elapsedMs = 0;
    if (opts.input) {
      let saved;
      try {
        saved = JSON.parse(fs.readFileSync(opts.input, "utf8"));
      } catch (e) {
        throw new StepError(`cannot read --input: ${e.message}`);
      }
      input = saved.input;
      meta = saved.meta ?? {};
    } else {
      const secrets = readSecrets(env);
      meta = {
        host: opts.host,
        from: opts.from,
        to: opts.to,
        module: opts.module,
      };
      input = { details: {}, timings: [] };
      const started = Date.now();
      try {
        await fetchAll(opts, secrets, input);
      } finally {
        if (opts.saveInput) saveInput(opts.saveInput, input, opts);
      }
      elapsedMs = Date.now() - started;
    }
    input.options = { strictZeroRows: opts.strictZeroRows };
    const result = runAllChecks(input);
    if (opts.json) {
      process.stdout.write(
        `${JSON.stringify({ ...meta, replay: Boolean(opts.input), elapsed_ms: elapsedMs, failed: result.failed, checks: result.checks, timings: input.timings }, null, 2)}\n`,
      );
    } else {
      console.log(
        `Profits audit — ${meta.host} — ${meta.from} → ${meta.to}${meta.module ? ` — module ${meta.module}` : ""}${opts.input ? " — replay of a saved run" : ""}`,
      );
      if (!opts.input)
        console.log(
          `${input.timings.length} requests, ${(elapsedMs / 1000).toFixed(1)} s`,
        );
      console.log("");
      console.log(formatReport(result));
    }
    return result.failed ? 1 : 0;
  } catch (e) {
    if (e instanceof UsageError) {
      if (e.message) console.error(`profits-audit: ${e.message}`);
      console.error(USAGE);
      return 2;
    }
    if (e instanceof StepError) {
      console.error(`profits-audit: ${e.message}`);
      return 2;
    }
    throw e;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  // exitCode, not exit(): a large --json write to a pipe must finish flushing.
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      console.error(`profits-audit: unexpected error: ${e?.message ?? e}`);
      process.exitCode = 2;
    },
  );
}
