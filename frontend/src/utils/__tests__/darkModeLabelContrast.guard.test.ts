/**
 * Dark-mode invisible-label guard.
 *
 * index.css repaints the bare Tailwind slate classes from theme tokens, and in
 * dark mode several of those tokens are the SAME hex (#3e4d7d):
 *
 *   background  --s-600 / --b-600 :  bg-slate-600, bg-slate-500, bg-slate-400,
 *                                    disabled:bg-slate-600 (when disabled)
 *   text        --t-600           :  text-slate-600, text-gray-600,
 *                                    disabled:text-slate-500, disabled:text-slate-600
 *                                    (when disabled), AND text-slate-400 whenever
 *                                    it sits next to bg-slate-600 -- the compound
 *                                    rule `.bg-slate-600.text-slate-400` repaints
 *                                    that exact pair to --t-600.
 *
 * Any element carrying one class from each column therefore shows text in the
 * colour of its own background: a disabled button becomes an empty bar. That
 * shipped on eight payment screens (found on PaymentSheet in LIRA-321). The
 * readable disabled look is `bg-slate-700 text-slate-300` (PaymentSheet).
 *
 * The scan groups class tokens two ways and fails if either group holds a
 * colliding pair: (1) each whole `className=` expression or clsx/cn call (so
 * `cn("bg-slate-600", cond && "text-slate-400")` is caught), and (2) each
 * single string/template literal (so a class string kept in a constant is
 * caught). Comments are stripped first, so a fix comment that names the bad
 * pair does not trip it. If index.css changes which tokens collide, update
 * the sets below.
 */
import * as fs from "node:fs";
import * as path from "node:path";

const FRONTEND_SRC = path.join(__dirname, "..", "..");
const UI_SRC = path.join(FRONTEND_SRC, "..", "..", "packages", "ui", "src");

const BG_ALWAYS = ["bg-slate-600", "bg-slate-500", "bg-slate-400"];
const BG_DISABLED = ["disabled:bg-slate-600"];
const TEXT_ALWAYS = ["text-slate-600", "text-gray-600"];
const TEXT_DISABLED = ["disabled:text-slate-500", "disabled:text-slate-600"];

function collidingPairs(tokens: Set<string>): string[] {
  const has = (list: string[]) => list.filter((c) => tokens.has(c));
  const out: string[] = [];
  const bg = has(BG_ALWAYS);
  const bgDis = has(BG_DISABLED);
  const txt = has(TEXT_ALWAYS);
  const txtDis = has(TEXT_DISABLED);
  if (bg.length && txt.length) out.push([...bg, ...txt].join(" + "));
  if (tokens.has("bg-slate-600") && tokens.has("text-slate-400"))
    out.push("bg-slate-600 + text-slate-400");
  if ((bg.length || bgDis.length) && txtDis.length)
    out.push([...bg, ...bgDis, ...txtDis].join(" + "));
  if (bgDis.length && txt.length) out.push([...bgDis, ...txt].join(" + "));
  return out;
}

function collectSourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "__tests__") continue;
      out.push(...collectSourceFiles(full));
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.(test|spec)\.tsx?$/.test(entry.name) &&
      !entry.name.endsWith(".d.ts")
    ) {
      out.push(full);
    }
  }
  return out;
}

/** Blank out comments (keeping newlines so line numbers survive). */
function stripComments(src: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, " ");
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(
      /(^|[^:"'`\\])\/\/[^\n]*/g,
      (m, lead: string) => lead + blank(m.slice(lead.length)),
    );
}

function balanced(src: string, start: number, open: string, close: string) {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === open) depth++;
    else if (src[i] === close && --depth === 0) return src.slice(start, i + 1);
  }
  return src.slice(start);
}

const tokenize = (s: string) =>
  new Set(s.split(/[\s"'`{}$()?,]+/).filter(Boolean));

const lineOf = (src: string, idx: number) =>
  src.slice(0, idx).split("\n").length;

function scanFile(file: string): string[] {
  const src = stripComments(fs.readFileSync(file, "utf8"));
  const groups: Array<{ idx: number; text: string }> = [];

  for (const m of src.matchAll(
    /className=|\b(?:clsx|cn|classNames|twMerge)\(/g,
  )) {
    const i = (m.index ?? 0) + m[0].length;
    if (m[0] === "className=") {
      if (src[i] === "{")
        groups.push({ idx: i, text: balanced(src, i, "{", "}") });
      else if (src[i] === '"' || src[i] === "'")
        groups.push({
          idx: i,
          text: src.slice(i, src.indexOf(src[i], i + 1) + 1),
        });
    } else {
      groups.push({ idx: i - 1, text: balanced(src, i - 1, "(", ")") });
    }
  }
  for (const m of src.matchAll(/"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`/g)) {
    groups.push({ idx: m.index ?? 0, text: m[0] });
  }

  const rel = path.relative(path.join(FRONTEND_SRC, "..", ".."), file);
  const hits = new Set<string>();
  for (const g of groups) {
    for (const pair of collidingPairs(tokenize(g.text))) {
      hits.add(`${rel}:${lineOf(src, g.idx)}  ${pair}`);
    }
  }
  return [...hits];
}

describe("dark-mode invisible label guard", () => {
  it("flags the colliding pair it exists to catch", () => {
    expect(
      collidingPairs(
        tokenize('"bg-slate-600 text-slate-400 cursor-not-allowed"'),
      ),
    ).not.toHaveLength(0);
    expect(
      collidingPairs(
        tokenize('"disabled:bg-slate-600 disabled:text-slate-500"'),
      ),
    ).not.toHaveLength(0);
    expect(
      collidingPairs(
        tokenize('"bg-slate-700 text-slate-300 cursor-not-allowed"'),
      ),
    ).toHaveLength(0);
  });

  it("no element pairs a background and text class that index.css paints the same colour in dark mode", () => {
    const files = [
      ...collectSourceFiles(FRONTEND_SRC),
      ...collectSourceFiles(UI_SRC),
    ];
    expect(files.length).toBeGreaterThan(100);
    const violations = files.flatMap(scanFile);
    if (violations.length) {
      throw new Error(
        `Text would be invisible in dark mode (same colour as its background). ` +
          `Use "bg-slate-700 text-slate-300" for a disabled look:\n  ` +
          violations.join("\n  "),
      );
    }
  });
});
