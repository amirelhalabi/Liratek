/**
 * Guard: every relative import in the Electron main process carries a `.js`
 * extension.
 *
 * The main process is compiled by plain `tsc` and runs as native ESM, which
 * never adds extensions. `tsc` and this jest config (its moduleNameMapper
 * strips `.js`) both accept an extensionless import, so nothing caught
 * `offline/bootstrap.ts` importing "./bootDecision": the built app died on
 * load with ERR_MODULE_NOT_FOUND before opening a window, and every desktop
 * e2e spec failed on the CI runner (2026-10-17).
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const SKIP_DIRS = new Set(["node_modules", "dist", "__tests__", "logs"]);
const RELATIVE_IMPORT =
  /(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)["'](\.{1,2}\/[^"']+)["']/gm;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        out.push(...sourceFiles(path.join(dir, entry.name)));
      }
    } else if (
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".d.ts") &&
      !entry.name.endsWith(".test.ts")
    ) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

/** Relative specifiers in `source` that native ESM cannot resolve as written. */
export function extensionlessImports(source: string): string[] {
  const found: string[] = [];
  for (const m of source.matchAll(RELATIVE_IMPORT)) {
    if (!/\.(js|cjs|mjs|json)$/.test(m[1])) found.push(m[1]);
  }
  return found;
}

describe("Electron main process: relative imports end in .js", () => {
  it("detects an extensionless import", () => {
    expect(
      extensionlessImports(`import { decideBoot } from "./bootDecision";`),
    ).toEqual(["./bootDecision"]);
    expect(
      extensionlessImports(`import { decideBoot } from "./bootDecision.js";`),
    ).toEqual([]);
  });

  it("finds none in electron-app sources", () => {
    const offenders = sourceFiles(ROOT).flatMap((file) =>
      extensionlessImports(fs.readFileSync(file, "utf8")).map(
        (spec) => `${path.relative(ROOT, file)} -> ${spec}`,
      ),
    );
    expect(offenders).toEqual([]);
  });
});
