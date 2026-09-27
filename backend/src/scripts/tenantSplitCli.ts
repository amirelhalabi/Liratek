#!/usr/bin/env node
/**
 * Phase D split CLI — thin wrapper around `@liratek/core`'s
 * `splitTenantDatabase` (`packages/core/src/db/tenantSplit.ts`). Runs INSIDE
 * the Fly container (ships in `backend/dist`, same as every other compiled
 * backend file — no Dockerfile change needed, `backend/dist` is copied
 * wholesale into the runtime image).
 *
 * Usage (see the Phase D runbook, `PRODUCTION_DATABASE_AND_HOSTING_PLAN.md`
 * § 12):
 *
 *   node dist/scripts/tenantSplitCli.js <sourceDbPath> <outputDir>            # dry run (default)
 *   node dist/scripts/tenantSplitCli.js <sourceDbPath> <outputDir> --write    # actually writes files
 *
 * `<sourceDbPath>` MUST be a COPY of the live database, never the live file
 * itself — this script does not enforce that (it can't tell a copy from the
 * original), the runbook does: snapshot first, then point this at the
 * snapshot.
 *
 * Prints the full JSON report to stdout via `process.stdout.write` (never
 * `console.log` — backend lint's `no-console` is an ERROR with no `log`
 * exception, only `warn`/`error`; status lines below use `console.error` for
 * the same reason `console.warn`/`console.error` stay allowed there: they're
 * operator-facing stderr, not app runtime logging). Exit code is `0` when the
 * report's `ok` is `true`, `1` otherwise, so this composes with `&&` in the
 * runbook's shell commands.
 */
import { splitTenantDatabase } from "@liratek/core";

function usage(): never {
  console.error(
    "Usage: tenantSplitCli <sourceDbPath> <outputDir> [--write]\n" +
      "  (dry run by default; pass --write to actually produce files)",
  );
  process.exit(2);
}

function main(): void {
  const args = process.argv.slice(2).filter((a) => a !== "--write");
  const write = process.argv.slice(2).includes("--write");
  const [sourceDbPath, outputDir] = args;

  if (!sourceDbPath || !outputDir) usage();

  const report = splitTenantDatabase({ sourceDbPath, outputDir, write });

  process.stdout.write(JSON.stringify(report, null, 2) + "\n");

  if (!report.ok) {
    console.error(
      `\ntenantSplitCli: FAILED — ${report.mismatches.length} count mismatch(es), ` +
        `${report.unexpectedGlobalRows.length} unexpected global-row table(s), ` +
        `${report.fileChecks.filter((c) => c.foreignKeyViolations > 0 || c.integrityCheck !== "ok").length} file integrity failure(s).`,
    );
    process.exit(1);
  }

  console.error(
    report.dryRun
      ? "\ntenantSplitCli: dry run OK — nothing written. Re-run with --write to produce files."
      : "\ntenantSplitCli: split OK.",
  );
}

main();
