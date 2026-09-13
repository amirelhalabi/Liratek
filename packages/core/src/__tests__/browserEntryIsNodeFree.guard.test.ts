/**
 * GUARD: nothing reachable from `browser.ts` may import a Node built-in.
 *
 * `packages/core` has TWO entry points — `index.ts` for Node (Electron main,
 * the Fly backend) and `browser.ts` for Vite and the frontend jest config.
 * Anything the browser entry can reach, transitively, ends up in the Vercel
 * bundle.
 *
 * This exists because that failure is INVISIBLE to every gate we run locally.
 * `tsc --noEmit` typechecks fine (types don't care about bundling), core's own
 * jest runs under Node (where `node:async_hooks` resolves happily), and the
 * frontend suite only fails if a test happens to import the offending path.
 * The first thing that notices is `vite build` — i.e. the Vercel deployment,
 * after the push. That is exactly how `5f323027` shipped a broken deploy:
 * `clientDay()` was added to `utils/localDate.ts`, which is reachable from
 * `browser.ts` via `utils/carrierLineValidity.ts`, and it imported
 * `db/tenantContext.ts` → `node:async_hooks`.
 *
 * The fix pattern when this test fails is NOT to shim the built-in: split the
 * server-only function into its own module (see `utils/requestDay.ts`, and
 * `utils/formatMoney.ts` before it) and keep the browser-facing module a leaf.
 */

import { builtinModules } from "node:module";
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve(__dirname, "..");
const ENTRY = path.join(SRC, "browser.ts");

const NODE_BUILTINS = new Set(builtinModules);

/**
 * Every VALUE import specifier in a source file.
 *
 * Type-only imports are deliberately excluded: `export type { ProductEntity }
 * from "./repositories/ProductRepository.js"` in `browser.ts` is erased at
 * compile time and puts nothing in the bundle, so following it would report
 * every repository (and through them `node:async_hooks`, `fs`, `crypto`) as an
 * offender — the guard would be a wall of false positives and get deleted. A
 * brace list whose bindings are ALL `type `-prefixed is erased the same way.
 */
function valueImportSpecifiers(source: string): string[] {
  // Strip block/line comments first so a `from "node:fs"` inside prose — this
  // file's own header, for one — cannot register as an import.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  const specs: string[] = [];

  const statement =
    /\b(import|export)\b(\s+type\b)?([\s\S]*?)\bfrom\s+["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = statement.exec(code)) !== null) {
    const [, , typeKeyword, clause, spec] = m;
    if (typeKeyword) continue; // `import type … from` / `export type … from`

    const braces = clause.match(/\{([\s\S]*)\}/);
    if (braces) {
      const bindings = braces[1]
        .split(",")
        .map((b) => b.trim())
        .filter(Boolean);
      const hasDefaultOrNamespace = /(^|[^{])\b(\*|\w+)\s*(,|$)/.test(
        clause.replace(/\{[\s\S]*\}/, ""),
      );
      if (
        bindings.length > 0 &&
        !hasDefaultOrNamespace &&
        bindings.every((b) => /^type\s/.test(b))
      ) {
        continue; // every binding is type-only → erased
      }
    }
    specs.push(spec);
  }

  // Side-effect imports, dynamic imports and require() — all value-bearing.
  for (const re of [
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\s+["']([^"']+)["']/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ]) {
    let s: RegExpExecArray | null;
    while ((s = re.exec(code)) !== null) specs.push(s[1]);
  }

  return specs;
}

/** Resolve a relative `./x.js` specifier back to its `.ts` source file. */
function resolveLocal(fromFile: string, spec: string): string | null {
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [
    base.replace(/\.js$/, ".ts"),
    `${base}.ts`,
    path.join(base, "index.ts"),
  ];
  return candidates.find((c) => fs.existsSync(c)) ?? null;
}

function isNodeBuiltin(spec: string): boolean {
  if (spec.startsWith("node:")) return true;
  return NODE_BUILTINS.has(spec.split("/")[0]);
}

describe("browser entry point is free of Node built-ins", () => {
  it("reaches no `node:` import from browser.ts, at any depth", () => {
    const seen = new Set<string>();
    /** `[builtin, the chain of files that reached it]` */
    const offenders: Array<{ builtin: string; chain: string[] }> = [];

    const walk = (file: string, chain: string[]): void => {
      if (seen.has(file)) return;
      seen.add(file);

      const source = fs.readFileSync(file, "utf-8");
      const here = [...chain, path.relative(SRC, file).replace(/\\/g, "/")];

      for (const spec of valueImportSpecifiers(source)) {
        if (isNodeBuiltin(spec)) {
          offenders.push({ builtin: spec, chain: here });
          continue;
        }
        // Bare package specifiers (zod, better-sqlite3, …) are not walked:
        // Vite/rollup resolve those itself, and a Node-only DEPENDENCY would
        // fail the build with its own, legible error. This guard is about our
        // own source graph, which is the part that silently drifts.
        if (!spec.startsWith(".")) continue;

        const next = resolveLocal(file, spec);
        if (next) walk(next, here);
      }
    };

    walk(ENTRY, []);

    const report = offenders
      .map((o) => `  ${o.builtin}\n    via ${o.chain.join("\n     → ")}`)
      .join("\n");

    expect(
      offenders.length === 0
        ? ""
        : `browser.ts transitively imports Node built-ins — this breaks the ` +
            `Vercel build (vite/rollup cannot resolve them) even though ` +
            `tsc and this jest run both pass:\n${report}\n\n` +
            `Split the server-only code into its own module and keep the ` +
            `browser-facing one a leaf (see utils/requestDay.ts).`,
    ).toBe("");
  });

  it("actually walks the graph — the traversal is not vacuously empty", () => {
    // Without this, deleting a `walk()` recursion would make the test above
    // pass for the wrong reason.
    const seen = new Set<string>();
    const walk = (file: string): void => {
      if (seen.has(file)) return;
      seen.add(file);
      for (const spec of valueImportSpecifiers(
        fs.readFileSync(file, "utf-8"),
      )) {
        if (!spec.startsWith(".")) continue;
        const next = resolveLocal(file, spec);
        if (next) walk(next);
      }
    };
    walk(ENTRY);

    expect(seen.size).toBeGreaterThan(20);
    expect([...seen].some((f) => f.endsWith("carrierLineValidity.ts"))).toBe(
      true,
    );
  });
});
