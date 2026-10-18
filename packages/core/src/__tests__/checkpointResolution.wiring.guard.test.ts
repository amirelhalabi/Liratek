/**
 * LIRA-335 T014 — wiring guard for the checkpoint resolution engine
 * (research R1: there is no single posting chokepoint, so each money flow
 * calls `resolveBackTimedDrawerMovement` at the end of its own db
 * transaction).
 *
 * Every `repositories/*Repository.ts` that hands a caller-supplied time to
 * `createTransaction` (`transaction_time: …`) must also call the engine, or
 * be listed in `CHECKPOINT_RESOLUTION_EXCLUSIONS` with a reason. A new flow
 * that accepts Set custom time and forgets the call fails here, naming the
 * file — instead of silently double-counting a drawer at the next checkpoint.
 *
 * Per-file, by design: a file is the unit that owns its flows. Which call
 * sites inside a file are covered by which engine call is reviewed in the
 * file itself (each call carries a comment naming the flows it covers).
 */
import fs from "node:fs";
import path from "node:path";
import { CHECKPOINT_RESOLUTION_EXCLUSIONS } from "../repositories/checkpointResolution";

const SRC_DIR = path.join(__dirname, "..");
const REPO_DIR = path.join(SRC_DIR, "repositories");

function repositoryFiles(): string[] {
  return fs
    .readdirSync(REPO_DIR)
    .filter((f) => f.endsWith("Repository.ts"))
    .sort();
}

function source(file: string): string {
  return fs.readFileSync(path.join(REPO_DIR, file), "utf8");
}

/** Passes a caller-supplied time into createTransaction. */
function takesTransactionTime(text: string): boolean {
  return (
    text.includes("createTransaction(") &&
    /\btransaction_time:\s*[a-zA-Z_]/.test(text)
  );
}

function callsEngine(text: string): boolean {
  return text.includes("resolveBackTimedDrawerMovement(");
}

describe("LIRA-335 — every back-timeable flow calls the checkpoint resolution engine", () => {
  it("scans a real set of repositories (the guard is not vacuous)", () => {
    const timed = repositoryFiles().filter((f) =>
      takesTransactionTime(source(f)),
    );
    expect(timed.length).toBeGreaterThanOrEqual(12);
    expect(timed).toContain("SalesRepository.ts");
    expect(timed).toContain("ExpenseRepository.ts");
  });

  it("no repository takes a transaction time without calling resolveBackTimedDrawerMovement", () => {
    const offenders = repositoryFiles().filter((f) => {
      const text = source(f);
      return (
        takesTransactionTime(text) &&
        !callsEngine(text) &&
        !(`repositories/${f}` in CHECKPOINT_RESOLUTION_EXCLUSIONS)
      );
    });
    expect(offenders).toEqual([]);
  });

  it("every exclusion names a real repository, gives a reason, and is still needed", () => {
    for (const [file, reason] of Object.entries(
      CHECKPOINT_RESOLUTION_EXCLUSIONS,
    )) {
      const full = path.join(SRC_DIR, file);
      expect(fs.existsSync(full)).toBe(true);
      expect(reason.trim().length).toBeGreaterThan(20);
      expect(callsEngine(fs.readFileSync(full, "utf8"))).toBe(false);
    }
  });
});
