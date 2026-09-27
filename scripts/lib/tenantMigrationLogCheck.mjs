/**
 * Pure log-parsing for the per-tenant boot markers `scripts/deploy-api.mjs`'s
 * verifier scrapes from `fly logs` output
 * (`docs/plans/ongoing_plans/PRODUCTION_DATABASE_AND_HOSTING_PLAN.md` § 12.4,
 * ticket items 1/2). Extracted into its own module so it can be unit-tested
 * against a fixed log string instead of only ever exercised against a real
 * Fly deploy — `deploy-api.mjs` itself calls real `fetch`/`flyCapture`, which
 * a test has no business doing.
 *
 * Two things this checks for, both only ever relevant in
 * `TENANT_DB_MODE=per-tenant` (silent and correct in `shared` mode, where
 * neither marker is ever logged):
 *
 *   1. The safety-lock refusal marker (`connection.ts`'s
 *      `installTenantDbRouting()`): if the platform database still holds
 *      shop data, per-tenant routing was refused at boot. A HARD failure —
 *      the deploy is up, but per-tenant mode silently did not activate.
 *   2. The `"Tenant databases migrated"` boot line's `missing` count: how
 *      many tenants expected to have a database file (status active/
 *      suspended) had none found on disk. A non-zero `missing` count is the
 *      exact silent-outage scenario this whole guard exists for — flipping
 *      `TENANT_DB_MODE=per-tenant` before running the Phase D split leaves
 *      `/data/tenants` empty, `migrateAllTenants()` alone reports
 *      `{ok:0,failed:0}` (nothing to migrate when nothing was found), and
 *      the OLD verifier read that as green.
 */

/**
 * @param {string} logs raw `fly logs --no-tail` output
 * @returns {{ failures: string[], oks: string[], infos: string[] }}
 *   `failures` are hard verifier failures; `oks` and `infos` are for the
 *   verifier's own console output (a present-and-good marker vs. an
 *   absent-marker note that is NOT a failure — see `deploy-api.mjs`'s own
 *   "log window" caveat for why absence alone never fails this check).
 */
export function checkTenantMigrationLogs(logs) {
  const failures = [];
  const oks = [];
  const infos = [];

  if (/Per-tenant mode REFUSED/.test(logs)) {
    failures.push(
      "per-tenant mode REFUSED at boot — platform database still holds shop data; run the Phase D split first (check: yarn api:logs)",
    );
  }

  const tenantMigrationLine = logs
    .split("\n")
    .find((line) => /"msg":"Tenant databases migrated"/.test(line));

  if (!tenantMigrationLine) {
    infos.push(
      "per-tenant boot migration marker not found in this log window (expected only in TENANT_DB_MODE=per-tenant)",
    );
    return { failures, oks, infos };
  }

  const failedMatch = tenantMigrationLine.match(/"failed":(\d+)/);
  if (failedMatch && failedMatch[1] !== "0") {
    failures.push(
      `per-tenant boot migration reported failed:${failedMatch[1]} — check: yarn api:logs`,
    );
  } else if (failedMatch) {
    oks.push("per-tenant boot migration: failed:0");
  } else {
    infos.push(
      "per-tenant boot migration marker found but 'failed' count could not be parsed",
    );
  }

  const missingMatch = tenantMigrationLine.match(/"missing":(\d+)/);
  if (missingMatch && missingMatch[1] !== "0") {
    failures.push(
      `per-tenant boot migration reported missing:${missingMatch[1]} shop database file(s) — check: yarn api:logs`,
    );
  } else if (missingMatch) {
    oks.push("per-tenant boot migration: missing:0");
  } else {
    // The marker line IS present (so the boot code that logs it did run),
    // but carries no `missing` field at all — the pre-fix shape, which used
    // to slip through as a bare "failed:0" pass. Fail closed: we cannot
    // confirm every expected shop has a file, so this is never treated the
    // same as a confirmed missing:0.
    failures.push(
      "per-tenant boot migration marker found but no 'missing' count was reported — " +
        "redeploy the backend with the tenant-completeness check (see PRODUCTION_DATABASE_AND_HOSTING_PLAN.md § 12.4)",
    );
  }

  return { failures, oks, infos };
}
