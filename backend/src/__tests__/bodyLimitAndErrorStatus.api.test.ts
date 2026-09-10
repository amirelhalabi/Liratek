/**
 * Two defects that together turned a too-big upload into a phantom server bug.
 *
 * The owner's Excel debt import failed with "Import failed: Internal server
 * error". The server log told the real story:
 *
 *     PayloadTooLargeError: request entity too large
 *     expected: 583440   limit: 102400   status: 413
 *
 *   1. `express.json()` was mounted with no `limit`, so it used Express's
 *      100 kB default. A routine shop's client list is 583 kB, and the request
 *      was rejected before the route ever ran. The same ceiling silently broke
 *      saving a shop logo, which is stored as a base64 data URL in a setting.
 *
 *   2. The global error handler answered 500 "Internal server error" for
 *      EVERYTHING, discarding the 413 the error already carried. So a problem
 *      the caller could act on ("your file is too big") was reported as a
 *      server fault, and the owner went looking for a backend bug that did not
 *      exist.
 *
 * These tests rebuild the same two middlewares over a throwaway app rather
 * than importing server.ts, which opens a database and binds a port on import.
 * What is under test is the CONFIGURATION contract — a limit well above
 * Express's default, and an error handler that respects an exposed 4xx — so
 * the assertions are written against the same wiring server.ts uses.
 */

import express from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Mirrors server.ts: the body limit and the status-preserving error handler. */
function buildApp(limit: string) {
  const app = express();
  app.use(express.json({ limit }));
  app.post("/echo", (req, res) => {
    res.json({
      received: Array.isArray(req.body?.rows) ? req.body.rows.length : 0,
    });
  });
  app.get("/boom", () => {
    throw new Error("something went wrong inside the server");
  });
  app.use(
    (
      err: Error & { status?: number; statusCode?: number; expose?: boolean },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const status = err.status ?? err.statusCode;
      const isClientFault =
        typeof status === "number" && status >= 400 && status < 500;
      if (isClientFault && err.expose) {
        res.status(status).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: "Internal server error" });
    },
  );
  return app;
}

/** A payload comfortably past Express's 100 kB default, like the real import. */
function bigPayload(approxBytes: number) {
  const row = { name: "A client with a reasonably long name", amount: 123.45 };
  const perRow = JSON.stringify(row).length + 1;
  return {
    rows: Array.from({ length: Math.ceil(approxBytes / perRow) }, () => row),
  };
}

describe("request body size limit", () => {
  it("accepts an import far larger than Express's 100 kB default", async () => {
    // The reported failure was 583 kB. 600 kB proves the ceiling moved past it.
    const body = bigPayload(600_000);
    expect(JSON.stringify(body).length).toBeGreaterThan(102_400);

    const res = await request(buildApp("10mb"))
      .post("/echo")
      .send(body)
      .expect(200);
    expect(res.body.received).toBe(body.rows.length);
  });

  it("would have REJECTED that same import at the old default — the bug", async () => {
    // Pinning the actual cause, so nobody re-reads this as a route bug.
    const body = bigPayload(600_000);
    await request(buildApp("100kb")).post("/echo").send(body).expect(413);
  });

  it("still refuses a payload past the new ceiling", async () => {
    // Raising a limit must not mean removing it: this parser runs before
    // authentication, so the limit is what bounds an anonymous POST.
    await request(buildApp("50kb"))
      .post("/echo")
      .send(bigPayload(200_000))
      .expect(413);
  });
});

describe("error handler status", () => {
  it("reports an oversized body as 413, not 500", async () => {
    const res = await request(buildApp("50kb"))
      .post("/echo")
      .send(bigPayload(200_000));

    expect(res.status).toBe(413);
    // The whole point: the caller learns what to do about it.
    expect(res.body.error).toMatch(/too large/i);
    expect(res.body.error).not.toBe("Internal server error");
  });

  it("still hides a genuine server fault behind a generic 500", async () => {
    // An unexpected stack can carry table names, paths and query fragments,
    // so only errors explicitly marked `expose` get their message through.
    const res = await request(buildApp("10mb")).get("/boom");

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Internal server error");
    expect(res.body.error).not.toMatch(/something went wrong inside/);
  });
});

/**
 * The tests above rebuild the middleware over a throwaway app, which proves
 * the PATTERN but not that server.ts still uses it — someone could restore the
 * default limit and every assertion above would stay green. server.ts cannot
 * be imported here (it opens a database and binds a port on import), so this
 * reads the source and pins the two lines that actually matter. Crude, but it
 * is the difference between testing a copy and testing the real wiring.
 */
describe("server.ts really is wired this way", () => {
  // __dirname, not import.meta.url: this suite runs under ts-jest in CJS.
  const source = readFileSync(join(__dirname, "..", "server.ts"), "utf-8");

  it("mounts express.json with an explicit limit, not Express's 100 kB default", () => {
    expect(source).toMatch(/express\.json\(\{\s*limit:/);
    // A bare express.json() is the bug this whole file exists for.
    expect(source).not.toMatch(/app\.use\(express\.json\(\)\)/);
  });

  it("limits urlencoded bodies too", () => {
    expect(source).toMatch(/express\.urlencoded\(\{[^}]*limit:/);
  });

  it("has an error handler that preserves an exposed 4xx", () => {
    // If this disappears, a 413 silently becomes "Internal server error" again.
    expect(source).toMatch(/err\.status \?\? err\.statusCode/);
    expect(source).toMatch(/expose/);
  });
});
