#!/usr/bin/env node
/**
 * The www sign-in directory's repair command (LIRA-288) — thin wrapper
 * around `runSigninDirectoryCommand` (database/signinDirectoryCheck.ts) and
 * core's `SigninDirectoryService`. Runs INSIDE the Fly container (ships in
 * `backend/dist`, like `tenantSplitCli.js`):
 *
 *   yarn api ssh console -C "node dist/scripts/signinDirectoryCli.js"           # dry run
 *   yarn api ssh console -C "node dist/scripts/signinDirectoryCli.js --write"   # rebuild
 *
 * Opens the database exactly as the server does (`database/connection.ts`:
 * the platform file, plus every shop file in per-tenant mode), so the
 * comparison reads the same records the app does. The dry run only reads;
 * `--write` replaces the directory in one platform transaction, and first
 * fills every shop's empty contact email from its first admin's confirmed
 * email (LIRA-290 — the per-tenant-mode back-fill migration v201 cannot do). Both are
 * safe while the server runs (SQLite WAL; the rebuild is idempotent).
 *
 * Prints the JSON report to stdout via `process.stdout.write` (backend lint's
 * `no-console` is an error) and status lines to stderr. Exit code 0 = clean
 * (or rebuilt), 1 = differences / an unreadable shop, 2 = bad arguments.
 */
import { getSigninDirectoryService } from "@liratek/core";
import { closeDatabase, getDatabase } from "../database/connection.js";
import { runSigninDirectoryCommand } from "../database/signinDirectoryCheck.js";

function main(): number {
  getDatabase();
  try {
    return runSigninDirectoryCommand(
      process.argv.slice(2),
      getSigninDirectoryService(),
      new Date().toISOString(),
      {
        write: (text) => process.stdout.write(text),
        error: (text) => process.stderr.write(text),
      },
    );
  } finally {
    closeDatabase();
  }
}

// process.exit: per-tenant mode's idle-sweep timer must not keep it alive.
process.exit(main());
