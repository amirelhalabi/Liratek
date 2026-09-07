/**
 * LIRA-176 phase 8a — guard against the reintroduction of the "In Progress"
 * (space form) status literal in production code.
 *
 * The real maintenance status enum value is `In_Progress` (underscore) — see
 * `create_db.sql` / the validator. `MaintenanceRepository.createJob`/
 * `updateJob` and `MaintenanceService.saveJob` all carry doc comments
 * recording that a `"In Progress"` (space) literal was once used as a status
 * default/comparison and could never match the real enum, silently landing
 * jobs in an unfilterable state. This guard scans core production source
 * (mirroring `constants/__tests__/moduleDebtTypes.guard.test.ts`'s
 * `collectSourceFiles`: `.ts` files, excluding `__tests__` dirs and
 * `*.test.ts` files) for a quoted `"In Progress"` / `'In Progress'` literal
 * OUTSIDE a `//` comment — the three existing occurrences are all inside
 * doc-comment lines discussing this exact historical bug, and must not trip
 * the guard; a NEW occurrence in actual code is what this exists to catch.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const SRC_ROOT = path.join(__dirname, "..", "..");
const SPACE_LITERAL = /['"]In Progress['"]/;

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      out.push(...collectSourceFiles(full));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Naive but sufficient for this narrow scan: strip everything from the
 * first `//` onward on each line before checking for the literal. Every
 * legitimate occurrence today is a WHOLE-LINE `//` doc comment (see the
 * three source lines this guard is proven against below), so this cannot
 * false-positive on them; a genuine code literal (never inside a comment)
 * survives the strip and is caught.
 */
function stripLineComments(source: string): string {
  return source
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("//");
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join("\n");
}

describe('Maintenance status — no "In Progress" (space) literal in production code (LIRA-176 phase 8a)', () => {
  it('no core source file (outside comments/tests) contains a quoted "In Progress" literal', () => {
    const offenders: string[] = [];
    for (const file of collectSourceFiles(SRC_ROOT)) {
      const source = fs.readFileSync(file, "utf8");
      const codeOnly = stripLineComments(source);
      if (SPACE_LITERAL.test(codeOnly)) {
        offenders.push(path.relative(SRC_ROOT, file));
      }
    }
    if (offenders.length > 0) {
      throw new Error(
        `Found a literal "In Progress" (space) status string in: ${offenders.join(", ")} — ` +
          `the real enum value is "In_Progress" (underscore); this can never match and silently ` +
          `strands a job in an unfilterable state. See MaintenanceRepository.createJob's doc comment.`,
      );
    }
  });

  it("sanity: the known historical comment-only mentions do NOT trip the guard (proves the strip works, not just that nothing matches)", () => {
    const maintenanceRepoSrc = fs.readFileSync(
      path.join(SRC_ROOT, "repositories", "MaintenanceRepository.ts"),
      "utf8",
    );
    // The raw (unstripped) source DOES contain the literal, in comments —
    // confirms this test fixture is actually exercising the strip, not
    // trivially passing because the string is absent altogether.
    expect(SPACE_LITERAL.test(maintenanceRepoSrc)).toBe(true);
    expect(SPACE_LITERAL.test(stripLineComments(maintenanceRepoSrc))).toBe(false);
  });
});
