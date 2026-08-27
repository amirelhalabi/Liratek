/**
 * LIRA-143 — guard: the Phone Units ENTRY POINT and its ROUTE must ship
 * together.
 *
 * Why this file exists. The Inventory header's "Phone Units" button
 * (`navigate("/inventory/units")`) was committed to main inside an unrelated
 * commit while the `/inventory/units` route and the page itself were still
 * uncommitted. App.tsx ends with a catch-all
 * `<Route path="*" element={<Navigate to="/" replace />} />`, so on that main
 * an operator who clicked the new button was silently bounced to the
 * Dashboard — no error, no 404, just the wrong page. A grep-level guard is
 * the only thing that catches this class of half-shipped navigation, because
 * every layer involved compiles and type-checks perfectly on its own: a
 * `navigate()` call to a path no `<Route>` declares is valid TypeScript.
 *
 * The invariant, both directions:
 *   1. any module that navigates to a path in ROUTE_PAIRS ⇒ App.tsx declares
 *      that route, lazily importing a page module that exists on disk;
 *   2. the route is actually reachable from the UI (at least one navigator) —
 *      otherwise the page is orphaned and only URL-reachable.
 * Both are deliberate here, so a change to either side is a deliberate edit
 * of this test too. Same shape as core's `moduleDebtTypes.guard.test.ts`,
 * which greps source for the rule it enforces.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, resolve } from "path";

/** frontend/src — this file sits at features/inventory/pages/PhoneUnits/__tests__. */
const SRC = resolve(__dirname, "..", "..", "..", "..", "..");
/**
 * The routing table under test. Overridable so this guard can be PROVEN
 * against a known-bad routing table (rule 17: a guard that has never failed
 * proves nothing) without mutating the working tree — e.g.
 *   git show HEAD:frontend/src/app/App.tsx > /tmp/App.head.tsx
 *   PHONE_UNITS_GUARD_APP_TSX=/tmp/App.head.tsx yarn test <this file>
 * must go RED for any App.tsx that is missing a declared route.
 */
const APP_TSX =
  process.env.PHONE_UNITS_GUARD_APP_TSX ?? join(SRC, "app", "App.tsx");

interface RoutePair {
  /** The path passed to `navigate(...)` and declared as `<Route path=...>`. */
  path: string;
  /** The `@/`-aliased module App.tsx must lazily import for it. */
  pageModule: string;
  /** That module's entry file on disk. */
  pageFile: string;
}

const ROUTE_PAIRS: RoutePair[] = [
  {
    path: "/inventory/units",
    pageModule: "@/features/inventory/pages/PhoneUnits",
    pageFile: join(
      SRC,
      "features",
      "inventory",
      "pages",
      "PhoneUnits",
      "index.tsx",
    ),
  },
];

/** Every `.ts`/`.tsx` module under frontend/src except tests and App.tsx
 *  itself (App.tsx declares routes; it is not a navigator). */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      sourceFiles(full, out);
      continue;
    }
    if (!/\.tsx?$/.test(name)) continue;
    if (/\.test\.tsx?$/.test(name)) continue;
    if (full === join(SRC, "app", "App.tsx")) continue;
    out.push(full);
  }
  return out;
}

const APP_SRC = readFileSync(APP_TSX, "utf8");
const MODULES = sourceFiles(SRC).map((file) => ({
  file,
  text: readFileSync(file, "utf8"),
}));

describe.each(ROUTE_PAIRS)("route/entry pairing — $path", (pair) => {
  const navigators = MODULES.filter((m) =>
    m.text.includes(`navigate("${pair.path}")`),
  ).map((m) => m.file.slice(SRC.length + 1).replace(/\\/g, "/"));

  it("is reachable from the UI (at least one navigate() call)", () => {
    expect(navigators.length).toBeGreaterThan(0);
  });

  it("is declared as a <Route> in App.tsx", () => {
    // The failure mode this catches: navigators exist, the route does not, so
    // App.tsx's catch-all redirects the click to the Dashboard.
    expect(APP_SRC).toContain(`path="${pair.path}"`);
  });

  it("resolves to a page module that exists on disk", () => {
    expect(APP_SRC).toContain(`import("${pair.pageModule}")`);
    expect(existsSync(pair.pageFile)).toBe(true);
  });

  it("is declared BEFORE App.tsx's catch-all redirect", () => {
    const routeAt = APP_SRC.indexOf(`path="${pair.path}"`);
    const catchAllAt = APP_SRC.indexOf('path="*"');
    expect(routeAt).toBeGreaterThan(-1);
    expect(catchAllAt).toBeGreaterThan(-1);
    expect(routeAt).toBeLessThan(catchAllAt);
  });
});
