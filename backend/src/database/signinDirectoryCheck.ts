/**
 * The www sign-in directory's operator command and boot drift check
 * (LIRA-288). The directory (`signin_directory`, platform level) is an
 * INDEX of the shops' own users and Google links; core's
 * `SigninDirectoryService` keeps it in step after every write, but a crash
 * between a shop write and the platform write (two files in per-tenant mode)
 * can leave it behind. These two tools find and repair that.
 *
 * Kept free of runtime imports (only types from core, erased at compile
 * time) so both are unit-testable without the database: the CLI
 * (`scripts/signinDirectoryCli.ts`) and `server.ts` pass the real service.
 *
 * Neither ever blocks anything: the boot check only logs a warning, and a
 * shop's own address never reads the directory, so drift can only hide a
 * shop from the www lists until the next repair.
 */
import type {
  SigninDirectoryDiff,
  SigninDirectoryRebuildResult,
} from "@liratek/core";

/** The slice of `SigninDirectoryService` these tools use. */
export interface SigninDirectoryCommandService {
  diff(): SigninDirectoryDiff;
  rebuildAll(now: string): SigninDirectoryRebuildResult;
}

export interface CommandIo {
  /** stdout (the JSON report). */
  write: (text: string) => void;
  /** stderr (operator status lines). */
  error: (text: string) => void;
}

const USAGE =
  "Usage: signinDirectoryCli [--write]\n" +
  "  (dry run by default: prints { missing, extra, stale, failedTenantIds } and exits 1 if any;\n" +
  "   --write rebuilds the directory from every shop's records)";

/**
 * Runs the operator command. Returns the exit code:
 *   - dry run: 0 when the directory matches every shop, 1 when anything
 *     differs or a shop could not be read, 2 for bad arguments;
 *   - `--write`: 0, or 1 when a shop could not be read (its rows were kept).
 * "Now" is the caller's clock — a maintenance job, not a request (rule 27).
 */
export function runSigninDirectoryCommand(
  args: string[],
  service: SigninDirectoryCommandService,
  now: string,
  io: CommandIo,
): number {
  const unknown = args.filter((a) => a !== "--write");
  if (unknown.length > 0) {
    io.error(`${USAGE}\n`);
    return 2;
  }

  if (args.includes("--write")) {
    const result = service.rebuildAll(now);
    io.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.failedTenantIds.length > 0) {
      io.error(
        `\nsigninDirectoryCli: rebuilt, but ${result.failedTenantIds.length} shop(s) could not be read; their rows were kept.\n`,
      );
      return 1;
    }
    io.error("\nsigninDirectoryCli: rebuilt. Run again without --write to confirm zero differences.\n");
    return 0;
  }

  const diff = service.diff();
  io.write(`${JSON.stringify(diff, null, 2)}\n`);
  const differences = diff.missing.length + diff.extra.length + diff.stale.length;
  if (differences > 0 || diff.failedTenantIds.length > 0) {
    io.error(
      `\nsigninDirectoryCli: ${differences} difference(s), ${diff.failedTenantIds.length} unreadable shop(s). Re-run with --write to rebuild.\n`,
    );
    return 1;
  }
  io.error("\nsigninDirectoryCli: zero differences.\n");
  return 0;
}

/** The logger slice the boot check uses (pino-shaped). */
export interface DirectoryCheckLogger {
  warn: (obj: object, msg: string) => void;
  info: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
}

export interface SigninDirectoryCheckResult {
  ok: boolean;
  missing: number;
  extra: number;
  stale: number;
  failedTenantIds: number[];
}

/**
 * Compares the directory with every shop's records and logs a WARNING when
 * they differ (counts only: the rows hold emails). Never fixes, never
 * throws.
 */
export function checkSigninDirectory(
  service: Pick<SigninDirectoryCommandService, "diff">,
  log: DirectoryCheckLogger,
): SigninDirectoryCheckResult {
  try {
    const diff = service.diff();
    const result: SigninDirectoryCheckResult = {
      ok:
        diff.missing.length + diff.extra.length + diff.stale.length === 0 &&
        diff.failedTenantIds.length === 0,
      missing: diff.missing.length,
      extra: diff.extra.length,
      stale: diff.stale.length,
      failedTenantIds: diff.failedTenantIds,
    };
    if (result.ok) {
      log.info({}, "Sign-in directory matches every shop");
    } else {
      log.warn(
        {
          missing: result.missing,
          extra: result.extra,
          stale: result.stale,
          failedTenantIds: result.failedTenantIds,
        },
        "Sign-in directory differs from the shops' records — run `node dist/scripts/signinDirectoryCli.js --write` (www sign-in lists may be incomplete until then)",
      );
    }
    return result;
  } catch (error) {
    log.error({ error }, "Sign-in directory check failed");
    return { ok: false, missing: 0, extra: 0, stale: 0, failedTenantIds: [] };
  }
}

/** One check, shortly after boot, so it never competes with startup. */
export const SIGNIN_DIRECTORY_CHECK_DELAY_MS = 60 * 1000;

/** Schedules the boot check once; returns a stop function. The timer never
 * holds the process open. */
export function scheduleSigninDirectoryCheck(
  service: Pick<SigninDirectoryCommandService, "diff">,
  log: DirectoryCheckLogger,
  delayMs: number = SIGNIN_DIRECTORY_CHECK_DELAY_MS,
): () => void {
  const timer = setTimeout(() => {
    checkSigninDirectory(service, log);
  }, delayMs);
  timer.unref?.();
  return () => clearTimeout(timer);
}
