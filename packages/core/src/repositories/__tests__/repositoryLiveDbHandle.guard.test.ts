/**
 * GUARD (Phase A, `PRODUCTION_DATABASE_AND_HOSTING_PLAN.md` § 11.2): no
 * repository may capture `getDatabase()` once and keep it. Every access must
 * re-resolve the current connection, because under per-tenant routing
 * (§ 11.1's resolver) a process-wide singleton built while one tenant was
 * current would otherwise keep serving that tenant's file to every other
 * tenant forever — a cross-tenant leak with no error (see
 * `SingletonLiveHandle.routing.test.ts` for the runtime demonstration).
 *
 * Two shapes are banned in any `packages/core/src/**\/*Repository.ts`:
 *   1. `this.<field> = <expr containing getDatabase()>` — assigning the
 *      result of `getDatabase()` (directly, or via `x ?? getDatabase()`) to
 *      an instance field freezes it at construction time.
 *   2. `new XRepository(getDatabase())` inside a singleton getter — passing
 *      an already-resolved handle into the constructor has the same effect
 *      one level removed.
 *
 * `BaseRepository`'s own `protected get db() { return getDatabase(); }` is
 * the sanctioned pattern (a getter, re-invoked on every access) and does not
 * match either shape: it has no `this.x =` assignment.
 *
 * This test is written and run FIRST (rule 17): as of writing, 13 of the 14
 * repositories named in § 11.2 still capture a handle (`CategoryRepository`
 * was fixed in the same pass that added this guard), so this test is
 * expected to FAIL, listing every offending file, before the § 11.2 refactor
 * lands.
 */
import fs from "node:fs";
import path from "node:path";

const REPOS_DIR = path.resolve(__dirname, "..");

function listRepositoryFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") continue;
      out.push(...listRepositoryFiles(full));
    } else if (entry.isFile() && /Repository\.ts$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

interface Violation {
  file: string;
  line: number;
  text: string;
  kind: "field-capture" | "constructor-arg-capture";
}

function findViolations(file: string): Violation[] {
  const raw = fs.readFileSync(file, "utf8");
  const code = stripComments(raw);
  const lines = code.split("\n");
  const violations: Violation[] = [];

  const fieldCapture = /this\.\w+\s*=[^;\n]*getDatabase\(\)/;
  const ctorArgCapture = /new\s+\w+Repository\(\s*getDatabase\(\)\s*\)/;

  lines.forEach((line, idx) => {
    if (fieldCapture.test(line)) {
      violations.push({
        file,
        line: idx + 1,
        text: line.trim(),
        kind: "field-capture",
      });
    }
    if (ctorArgCapture.test(line)) {
      violations.push({
        file,
        line: idx + 1,
        text: line.trim(),
        kind: "constructor-arg-capture",
      });
    }
  });

  return violations;
}

describe("repository live-handle guard", () => {
  it("no *Repository.ts assigns getDatabase() to a field or passes it into a singleton constructor call", () => {
    const files = listRepositoryFiles(REPOS_DIR);
    const allViolations = files.flatMap(findViolations);

    if (allViolations.length > 0) {
      const report = allViolations
        .map(
          (v) =>
            `  ${path.relative(REPOS_DIR, v.file)}:${v.line} [${v.kind}] ${v.text}`,
        )
        .join("\n");
      throw new Error(
        `Found ${allViolations.length} captured-handle violation(s):\n${report}\n\n` +
          `Fix: read the connection through a live getter (\`private get db() { return this._db ?? getDatabase(); }\`) ` +
          `with an optional constructor override for tests, per § 11.2.`,
      );
    }

    expect(allViolations).toEqual([]);
  });
});
