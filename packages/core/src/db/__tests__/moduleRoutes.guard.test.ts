/**
 * Module→route static guard (LIRA-116).
 *
 * Background: the `omt_whish` module (UI label "OMT/Whish") used to be
 * seeded with route `/services`, which collided with the UNRELATED
 * `custom_services` module (UI label "Services", route `/custom-services`).
 * The identical route string on two different module keys misled three
 * consecutive investigations into thinking the two modules were the same
 * page. LIRA-116 repointed `omt_whish` to `/omt-whish`.
 *
 * The recurrence risk is structural, not a one-off typo: the same
 * module→route fact is duplicated across SIX independent sites with
 * nothing tying them together —
 *   1. electron-app/create_db.sql            (fresh-install seed)
 *   2. packages/core/.../TenantRepository.ts (per-tenant seed)
 *   3. packages/core/.../migrations/index.ts (upgrade path for existing installs)
 *   4. packages/core/.../VoiceBotService.ts   (spoken-phrase routing)
 *   5. frontend/.../ActiveModuleContext.tsx   (route -> module key, for sidebar highlight)
 *   6. frontend/src/app/App.tsx               (the actual <Route>)
 *
 * If any one of these drifts from the others, the module does NOT 404 —
 * it silently VANISHES from the sidebar instead. The sidebar builds its
 * links from the DB `modules.route` column, and App.tsx's `path="*"`
 * catch-all redirects any unknown path to Home, so a stale route just
 * looks like "the module disappeared", which is a far more confusing
 * failure than a broken link. Nothing guarded this before LIRA-116.
 *
 * This test statically scans the six sites (plus HomeGrid's derived accent
 * key, and the transitional `/services` redirect) and fails loudly — never
 * silently — if any of them drifts, or if custom_services is ever swapped
 * onto `/services` (a "tidy-up" the owner explicitly rejected, because a
 * redirect cannot fix a route that silently opens a DIFFERENT module).
 *
 * Design rule: a guard must never pass vacuously. A regex that stops
 * matching because the source was reformatted would otherwise report
 * "success" while guarding nothing — that is the exact failure class this
 * ticket exists to eliminate. So every site is checked in two steps: (a)
 * did the pattern match AT ALL (if not, the guard has gone blind — fail
 * loudly with a message saying so), and only then (b) does the captured
 * value equal what LIRA-116 requires.
 *
 * Rule 17 (failing-first proof): jest cannot run in the isolated worktree
 * this test was authored in (no node_modules), so the "this test fails on
 * the pre-rename code" proof was done out-of-band with a standalone node
 * script that copies these exact regexes/comparison logic and runs them
 * against `git show HEAD:<path>` (pre-rename) vs the working tree
 * (post-rename). See the task handover for the script's path and output;
 * it is NOT part of this repo. Running this file under jest itself is
 * still owed separately.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.join(__dirname, "..", "..", "..", "..", "..");

/** Landmark files that only exist at the true repo root — used to fail
 *  loudly (not silently) if the __dirname-relative depth above is wrong. */
const REPO_ROOT_LANDMARKS = ["electron-app/create_db.sql", "package.json"];

function readSource(relPath: string): string {
  const full = path.join(REPO_ROOT, relPath);
  try {
    return fs.readFileSync(full, "utf8");
  } catch (error) {
    throw new Error(
      `moduleRoutes guard could not read "${relPath}" (resolved to "${full}"). ` +
        `Either the file moved or REPO_ROOT is miscalculated — see the ` +
        `"REPO_ROOT resolves" test. Original error: ${String(error)}`,
    );
  }
}

/** Assert a pattern matched AT ALL before trusting any captured group.
 *  This is the anti-vacuous-pass guard: a null match must never silently
 *  flow into a passing assertion. */
function mustMatch(
  source: string,
  pattern: RegExp,
  file: string,
  expectedDescription: string,
): RegExpMatchArray {
  const match = source.match(pattern);
  if (!match) {
    throw new Error(
      `pattern no longer matches ${file} — the guard has gone blind, fix the pattern.\n` +
        `Looking for: ${expectedDescription}\n` +
        `Pattern used: ${pattern}`,
    );
  }
  return match;
}

/** Assert a pattern does NOT match — used for the anti-regression checks
 *  (e.g. custom_services must never be paired with /services anywhere). */
function mustNotMatch(
  source: string,
  pattern: RegExp,
  file: string,
  forbiddenDescription: string,
): void {
  const match = source.match(pattern);
  if (match) {
    throw new Error(
      `${file} contains a forbidden pattern: ${forbiddenDescription}\n` +
        `Matched text: "${match[0]}"\n` +
        `Pattern used: ${pattern}`,
    );
  }
}

/** Assert a captured route value equals what LIRA-116 requires, with a
 *  diagnostic naming the file, the site, and both values on mismatch. */
function expectRoute(
  actual: string,
  expected: string,
  file: string,
  site: string,
): void {
  if (actual !== expected) {
    throw new Error(
      `${file} — ${site}: expected route "${expected}" but found "${actual}". ` +
        `This is exactly the drift LIRA-116 guards against: the module will ` +
        `silently vanish from the sidebar rather than 404.`,
    );
  }
}

describe("LIRA-116 module→route static guard", () => {
  it("REPO_ROOT resolves to the actual repository root (landmark check)", () => {
    for (const landmark of REPO_ROOT_LANDMARKS) {
      const full = path.join(REPO_ROOT, landmark);
      if (!fs.existsSync(full)) {
        throw new Error(
          `REPO_ROOT resolved to "${REPO_ROOT}" but landmark "${landmark}" does not ` +
            `exist there (looked at "${full}"). The __dirname-relative "../../../../.." ` +
            `depth in this test is wrong — every other assertion in this file reads ` +
            `from a bogus path until this is fixed.`,
        );
      }
    }
  });

  // --------------------------------------------------------------------
  // Site 1 — electron-app/create_db.sql (fresh-install seed)
  // --------------------------------------------------------------------
  it("create_db.sql seeds omt_whish with route /omt-whish", () => {
    const file = "electron-app/create_db.sql";
    const source = readSource(file);
    // Anchored on the 'omt_whish' key literal, then key,label,icon,route in
    // that tuple order — cannot accidentally capture a neighbouring module's
    // route, and tolerant of the hand-aligned column whitespace in this file.
    const pattern =
      /'omt_whish'\s*,\s*'[^']*'\s*,\s*'[^']*'\s*,\s*'([^']*)'/;
    const match = mustMatch(
      source,
      pattern,
      file,
      "the modules seed tuple for key 'omt_whish' (key, label, icon, route)",
    );
    expectRoute(match[1], "/omt-whish", file, "modules seed row for omt_whish");
  });

  // --------------------------------------------------------------------
  // Site 2 — packages/core/src/repositories/TenantRepository.ts
  // --------------------------------------------------------------------
  it("TenantRepository per-tenant seed declares omt_whish with route /omt-whish", () => {
    const file = "packages/core/src/repositories/TenantRepository.ts";
    const source = readSource(file);
    // Anchored on "omt_whish" being the FIRST element of its array tuple
    // (immediately after '['), so it can't match the bare "omt_whish"
    // entries inside the unrelated currency_modules seed arrays further
    // down in the same file.
    const pattern =
      /\[\s*"omt_whish"\s*,\s*"[^"]*"\s*,\s*"[^"]*"\s*,\s*"([^"]*)"/;
    const match = mustMatch(
      source,
      pattern,
      file,
      "the per-tenant module seed tuple starting with \"omt_whish\" (key, label, icon, route)",
    );
    expectRoute(
      match[1],
      "/omt-whish",
      file,
      "per-tenant module seed tuple for omt_whish",
    );
  });

  // --------------------------------------------------------------------
  // Site 3 — packages/core/src/db/migrations/index.ts (upgrade path)
  // --------------------------------------------------------------------
  it("a migration sets modules.route to /omt-whish for key omt_whish (upgrade path for existing installs)", () => {
    const file = "packages/core/src/db/migrations/index.ts";
    const source = readSource(file);
    // Anchored on the literal `UPDATE modules SET route = ? WHERE key = ?`
    // prepared statement text (so this can't accidentally match some other
    // module's parameterized UPDATE), AND on "omt_whish" as the second
    // .run() argument (the bound `key` param). Sites 1 and 2 only cover
    // fresh installs; this is what repoints an EXISTING tenant's row.
    const pattern =
      /UPDATE modules SET route = \?\s*WHERE key = \?`\)\s*\.run\(\s*"([^"]*)"\s*,\s*"omt_whish"\s*\)/g;
    const matches = [...source.matchAll(pattern)];
    if (matches.length === 0) {
      throw new Error(
        `pattern no longer matches ${file} — the guard has gone blind, fix the pattern.\n` +
          `Looking for: a migration's UPDATE modules SET route = ? WHERE key = ? .run(route, "omt_whish") call\n` +
          `Pattern used: ${pattern}`,
      );
    }
    const routes = matches.map((m) => m[1]);
    const setsCorrectRoute = routes.includes("/omt-whish");
    if (!setsCorrectRoute) {
      throw new Error(
        `${file} — no migration's UPDATE modules SET route = ? WHERE key = ? call sets ` +
          `omt_whish to "/omt-whish" (found route value(s): ${JSON.stringify(routes)}). ` +
          `Existing installs would be left on a stale route.`,
      );
    }
  });

  // --------------------------------------------------------------------
  // Site 4 — packages/core/src/services/VoiceBotService.ts
  // --------------------------------------------------------------------
  it("VoiceBotService ROUTE_MAPPING sends the 'omt whish' spoken phrase to /omt-whish", () => {
    const file = "packages/core/src/services/VoiceBotService.ts";
    const source = readSource(file);
    // Anchored on the literal spoken-phrase key "omt whish" (space, not
    // underscore — this is the ROUTE_MAPPING lookup key, not the module key).
    const pattern = /"omt whish"\s*:\s*"([^"]*)"/;
    const match = mustMatch(
      source,
      pattern,
      file,
      'the ROUTE_MAPPING entry for the "omt whish" spoken phrase',
    );
    expectRoute(
      match[1],
      "/omt-whish",
      file,
      'ROUTE_MAPPING["omt whish"]',
    );
  });

  // --------------------------------------------------------------------
  // Site 5 — frontend/src/contexts/ActiveModuleContext.tsx
  // --------------------------------------------------------------------
  it("ActiveModuleContext routeToModule maps /omt-whish to omt_whish and does not map /services to it", () => {
    const file = "frontend/src/contexts/ActiveModuleContext.tsx";
    const source = readSource(file);
    const blockPattern =
      /const routeToModule:\s*Record<string,\s*string>\s*=\s*\{([\s\S]*?)\n\};/;
    const blockMatch = mustMatch(
      source,
      blockPattern,
      file,
      "the routeToModule object literal",
    );
    const block = blockMatch[1];

    const omtWhishPattern = /"\/omt-whish"\s*:\s*"([^"]*)"/;
    const omtWhishMatch = mustMatch(
      block,
      omtWhishPattern,
      file,
      'routeToModule["/omt-whish"] entry',
    );
    expectRoute(
      omtWhishMatch[1],
      "omt_whish",
      file,
      'routeToModule["/omt-whish"]',
    );

    // The old route must not still resolve to a module — if it did, the
    // sidebar-highlight logic would treat visiting the transitional
    // /services redirect as if it were a real, still-live route.
    mustNotMatch(
      block,
      /"\/services"\s*:/,
      file,
      'routeToModule still has a "/services" key (it should only exist as the ' +
        "transitional <Navigate> redirect in App.tsx, not as a live module mapping)",
    );
  });

  // --------------------------------------------------------------------
  // Site 6 — frontend/src/app/App.tsx
  // --------------------------------------------------------------------
  it("App.tsx declares a <Route path=\"/omt-whish\">", () => {
    const file = "frontend/src/app/App.tsx";
    const source = readSource(file);
    const pattern = /<Route\s+path="\/omt-whish"/;
    mustMatch(source, pattern, file, '<Route path="/omt-whish"> declaration');
  });

  // --------------------------------------------------------------------
  // Anti-regression 1 — the transitional /services redirect must survive.
  // --------------------------------------------------------------------
  it("App.tsx still redirects the old /services path to /omt-whish (transitional bookmark/deep-link support)", () => {
    // Deleting this redirect breaks every old bookmark and deep link that
    // still points at /services. Its removal is a deliberate FUTURE
    // decision (once nothing is observed hitting it any more), not routine
    // cleanup — do not delete it just because it looks unused in a diff.
    const file = "frontend/src/app/App.tsx";
    const source = readSource(file);
    const pattern =
      /<Route[\s\S]{0,80}?path="\/services"[\s\S]{0,120}?element=\{<Navigate\s+to="([^"]*)"/;
    const match = mustMatch(
      source,
      pattern,
      file,
      'a <Route path="/services"> whose element is <Navigate to="..."> (the transitional redirect)',
    );
    expectRoute(
      match[1],
      "/omt-whish",
      file,
      '<Route path="/services"> redirect target',
    );
  });

  // --------------------------------------------------------------------
  // Anti-regression 2 — custom_services must NOT be swapped onto /services.
  // --------------------------------------------------------------------
  it("custom_services still declares /custom-services everywhere, and is never paired with /services", () => {
    // The owner explicitly rejected moving custom_services onto /services:
    // a redirect (anti-regression 1, above) can paper over omt_whish's old
    // route, but it cannot fix a route that silently opens a DIFFERENT
    // module — that is precisely the confusion three investigations hit
    // before LIRA-116. This assertion is what stops a future "tidy-up"
    // from reintroducing it.

    // -- create_db.sql --
    const sqlFile = "electron-app/create_db.sql";
    const sqlSource = readSource(sqlFile);
    const sqlPattern =
      /'custom_services'\s*,\s*'[^']*'\s*,\s*'[^']*'\s*,\s*'([^']*)'/;
    const sqlMatch = mustMatch(
      sqlSource,
      sqlPattern,
      sqlFile,
      "the modules seed tuple for key 'custom_services' (key, label, icon, route)",
    );
    expectRoute(
      sqlMatch[1],
      "/custom-services",
      sqlFile,
      "modules seed row for custom_services",
    );
    mustNotMatch(
      sqlSource,
      /'custom_services'\s*,\s*'[^']*'\s*,\s*'[^']*'\s*,\s*'\/services'/,
      sqlFile,
      "custom_services seeded with route '/services'",
    );

    // -- TenantRepository.ts --
    const trFile = "packages/core/src/repositories/TenantRepository.ts";
    const trSource = readSource(trFile);
    const trPattern =
      /\[\s*"custom_services"\s*,\s*"[^"]*"\s*,\s*"[^"]*"\s*,\s*"([^"]*)"/;
    const trMatch = mustMatch(
      trSource,
      trPattern,
      trFile,
      'the per-tenant module seed tuple starting with "custom_services" (key, label, icon, route)',
    );
    expectRoute(
      trMatch[1],
      "/custom-services",
      trFile,
      "per-tenant module seed tuple for custom_services",
    );
    mustNotMatch(
      trSource,
      /\[\s*"custom_services"\s*,\s*"[^"]*"\s*,\s*"[^"]*"\s*,\s*"\/services"/,
      trFile,
      'custom_services seed tuple with route "/services"',
    );

    // -- ActiveModuleContext.tsx --
    const amcFile = "frontend/src/contexts/ActiveModuleContext.tsx";
    const amcSource = readSource(amcFile);
    const blockPattern =
      /const routeToModule:\s*Record<string,\s*string>\s*=\s*\{([\s\S]*?)\n\};/;
    const blockMatch = mustMatch(
      amcSource,
      blockPattern,
      amcFile,
      "the routeToModule object literal",
    );
    const block = blockMatch[1];
    const customServicesPattern = /"\/custom-services"\s*:\s*"([^"]*)"/;
    const customServicesMatch = mustMatch(
      block,
      customServicesPattern,
      amcFile,
      'routeToModule["/custom-services"] entry',
    );
    expectRoute(
      customServicesMatch[1],
      "custom_services",
      amcFile,
      'routeToModule["/custom-services"]',
    );
    mustNotMatch(
      block,
      /"\/services"\s*:\s*"custom_services"/,
      amcFile,
      'routeToModule mapping "/services" to "custom_services"',
    );
  });

  // --------------------------------------------------------------------
  // Anti-regression 3 — HomeGrid's accent-map key must track the route.
  // --------------------------------------------------------------------
  it("HomeGrid accentMap has an omt_whish key (tracks routeToKey('/omt-whish'))", () => {
    // HomeGrid derives its accent-map lookup key from the route via
    // routeToKey(): route.replace(/^\//, "").replace(/-/g, "_"), so
    // "/omt-whish" -> "omt_whish". A mismatch here fails SILENTLY — the
    // tile just falls back to defaultAccent (plain violet) and its
    // data-testid changes — so it needs a static guard, not a visual one.
    const file = "frontend/src/shared/components/layouts/HomeGrid.tsx";
    const source = readSource(file);
    const accentMapBlockPattern =
      /const accentMap:\s*Record<[\s\S]*?>\s*=\s*\{([\s\S]*?)\n\};/;
    const blockMatch = mustMatch(
      source,
      accentMapBlockPattern,
      file,
      "the accentMap object literal",
    );
    const block = blockMatch[1];
    const omtWhishKeyPattern = /(^|\n)\s*omt_whish:\s*\{/;
    mustMatch(
      block,
      omtWhishKeyPattern,
      file,
      "an omt_whish key in the accentMap object literal",
    );
  });
});
