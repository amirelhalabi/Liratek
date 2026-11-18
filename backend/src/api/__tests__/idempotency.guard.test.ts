/**
 * LIRA-401 guard — every money POST in IDEMPOTENT_MONEY_ROUTES is registered
 * in its route file AND its handler goes through the Idempotency-Key guard
 * (`sendIdempotent` / `sendIdempotentAsync` / `guardIdempotent` /
 * `guardIdempotentAsync`). Reads the route files' source, the same grep-style
 * approach as packages/core's moduleDebtTypes.guard.test.ts.
 *
 * Fails when: a listed route was renamed or removed (so the list cannot rot
 * silently), or a listed route's handler books without the guard (the
 * Corner Tech double repayment, 2026-11-18, was exactly an unguarded route).
 *
 * The handler block is the text from `router.post("<path>"` to the next
 * top-level `router.` call. A handler built by a local factory (closing's
 * `differenceWriteRoute("close")`) is followed into that factory's body.
 */
import fs from "node:fs";
import path from "node:path";
import {
  IDEMPOTENT_MONEY_ROUTES,
  IDEMPOTENT_ROUTE_FILES,
  splitMoneyRoute,
} from "../idempotentMoneyRoutes.js";

const API_DIR = path.join(__dirname, "..");
const GUARD_CALL =
  /\b(sendIdempotent|sendIdempotentAsync|guardIdempotent|guardIdempotentAsync)\(/;

function source(file: string): string {
  return fs.readFileSync(path.join(API_DIR, `${file}.ts`), "utf8");
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The handler text of `router.post("<routePath>", …)`, or null when absent. */
function handlerBlock(src: string, routePath: string): string | null {
  const start = new RegExp(
    `router\\.post\\(\\s*"${escapeRe(routePath)}"\\s*,`,
  ).exec(src);
  if (!start) return null;
  const rest = src.slice(start.index + start[0].length);
  const next = /\nrouter\.|\nexport default/.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

/** Bodies of local factories the block calls, e.g. `differenceWriteRoute(`. */
function factoryBodies(src: string, block: string): string[] {
  const bodies: string[] = [];
  for (const m of block.matchAll(/\b([a-z][A-Za-z0-9]*Route)\(/g)) {
    const def = new RegExp(`function ${m[1]}\\(`).exec(src);
    if (!def) continue;
    const rest = src.slice(def.index);
    const end = /\n}\n/.exec(rest);
    bodies.push(end ? rest.slice(0, end.index) : rest);
  }
  return bodies;
}

describe("LIRA-401 guard: money POST routes go through the Idempotency-Key guard", () => {
  it("lists the 78 routes of the spec, each mapped to a route file", () => {
    expect(IDEMPOTENT_MONEY_ROUTES).toHaveLength(78);
    expect(new Set(IDEMPOTENT_MONEY_ROUTES).size).toBe(78);
    for (const name of IDEMPOTENT_MONEY_ROUTES) {
      const { mount } = splitMoneyRoute(name);
      expect(
        fs.existsSync(
          path.join(API_DIR, `${IDEMPOTENT_ROUTE_FILES[mount]}.ts`),
        ),
      ).toBe(true);
    }
  });

  it.each(IDEMPOTENT_MONEY_ROUTES.map((n) => [n]))(
    "%s is registered and guarded",
    (name) => {
      const { mount, path: routePath } = splitMoneyRoute(name);
      const src = source(IDEMPOTENT_ROUTE_FILES[mount]);
      const block = handlerBlock(src, routePath);
      if (block === null) {
        throw new Error(
          `${name}: no router.post("${routePath}", …) in ${IDEMPOTENT_ROUTE_FILES[mount]}.ts — renamed or removed? Update idempotentMoneyRoutes.ts.`,
        );
      }
      const guarded = [block, ...factoryBodies(src, block)].some((text) =>
        GUARD_CALL.test(text),
      );
      if (!guarded) {
        throw new Error(
          `${name}: handler books without the Idempotency-Key guard (sendIdempotent / guardIdempotent).`,
        );
      }
    },
  );
});
