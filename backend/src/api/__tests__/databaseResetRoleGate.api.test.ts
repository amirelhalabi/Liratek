/**
 * Database Reset (Settings › Reset Data) REST role-gate regression test.
 *
 * `backend/src/api/databaseReset.ts` mounts `router.use(authenticateJWT,
 * requireRole(["admin"]))` over BOTH `GET /reset/preview` and
 * `POST /reset` (databaseReset.ts:52) — a destructive, irreversible wipe of
 * all operational data must never be reachable by "staff". This mirrors the
 * desktop IPC gate exactly (`electron-app/handlers/databaseResetHandlers.ts`
 * :43 and :60, `requireRole(event.sender.id, ["admin"])`), guarded by the
 * sibling test `electron-app/handlers/__tests__/
 * databaseResetHandlers.roleGate.test.ts`.
 *
 * Nothing anywhere previously asserted the staff-refusal side of this gate —
 * `frontend/tests/e2e-web/lira-web-031-database-reset-guard.spec.ts` case 4
 * is `test.skip` (no staff login fixture in that suite) and its header
 * claimed the gate was "covered at the backend/core level instead" while no
 * such test existed. This file (plus the electron sibling above) is that
 * coverage; the e2e header has been corrected to name both.
 *
 * Follows the harness in `../__tests__/auditRoleGate.api.test.ts`: hits the
 * REAL router (`../databaseReset.js`) through a minimal Express app, faking
 * only `../../server.js` (logger), `../../middleware/audit.js` (`auditRest`
 * — the POST route calls it on every successful reset) and
 * `../../middleware/auth.js` (an `x-test-role` stand-in for
 * `authenticateJWT`/`requireRole`). `DatabaseResetService` is the REAL
 * singleton with `preview`/`reset` stubbed via `jest.spyOn`, so NO real
 * reset or DB work ever runs — this proves the route wires the exact
 * role/envelope/status-code contract, not the wipe itself (that is core
 * jest's job: `packages/core/src/repositories/__tests__/
 * DatabaseResetRepository.test.ts`).
 *
 * The POST body is asserted against `databaseResetSchema`
 * (`packages/core/src/validators/databaseReset.ts`) — `{ confirmation }`,
 * camelCase-free single field — rather than a hand-typed object literal
 * (rule 24): the fixture below is parsed through the real schema before
 * being sent, so a future rename of that field breaks this test instead of
 * silently drifting.
 *
 * Rule 17 (CLAUDE.md) status — EXECUTED 2026-09-26. What was actually done
 * and actually observed, in full:
 *
 *   1. `backend/src/api/databaseReset.ts:52`'s
 *      `requireRole(["admin"])` was temporarily changed to
 *      `requireRole(["admin", "staff"])`.
 *   2. `npx jest src/api/__tests__/databaseResetRoleGate.api.test.ts
 *      --maxWorkers=1` was run against that change. Real output:
 *      `Tests: 2 failed, 4 passed, 6 total`. Both failures were the
 *      staff-refusal cases, each `Expected: 403 / Received: 200`:
 *        "GET /api/database/reset/preview: staff gets 403, preview() never
 *        called" and "POST /api/database/reset: staff gets 403, reset()
 *        never called". With the gate loosened, `preview()`/`reset()` ran
 *        for real against the globally-mocked `better-sqlite3`
 *        (`backend/src/__mocks__/better-sqlite3.ts` — every statement is an
 *        in-memory `jest.fn()` stub, so no real database was ever touched);
 *        `reset()`'s real `DatabaseResetService` logged "Database reset
 *        failed" for the mocked repo call, which the route's own catch
 *        turned into a 200 `{ success: false, ... }` envelope rather than a
 *        crash — that 200 is what the test's `toBe(403)` caught. The admin
 *        and unauthenticated cases were unaffected and stayed green.
 *   3. `databaseReset.ts` was restored byte-identically (`git diff --stat --
 *      backend/src/api/databaseReset.ts` printed nothing but a line-ending
 *      warning afterward) and the file re-run — `Tests: 6 passed, 6 total`
 *      again.
 *
 * So the two staff-refusal cases are a genuine rule-17 fix-guard: they fail
 * on the loosened gate and pass on the real one. The admin and
 * unauthenticated cases are characterization locks (same status quo before
 * and after step 1) that stop a future change from silently re-tightening
 * the admin path or loosening the unauthenticated path.
 */

import { jest } from "@jest/globals";

jest.mock("../../server.js", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock("../../middleware/audit.js", () => ({
  auditRest: jest.fn(),
}));

jest.mock("../../middleware/auth.js", () => {
  const authenticateJWT = (req: any, res: any, next: any) => {
    const role = req.headers["x-test-role"];
    if (!role) {
      res.status(401).json({ success: false, error: "No token provided" });
      return;
    }
    req.user = {
      userId: 42,
      username: "tester",
      role,
      tenantId: 1,
      sessionToken: "test-session",
    };
    next();
  };
  const requireRole = (roles: string[]) => (req: any, res: any, next: any) => {
    if (!req.user) {
      res.status(401).json({ success: false, error: "Not authenticated" });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ success: false, error: "Forbidden" });
      return;
    }
    next();
  };
  return { authenticateJWT, requireAuth: authenticateJWT, requireRole };
});

import express, { type Express } from "express";
import request from "supertest";
import {
  getDatabaseResetService,
  databaseResetSchema,
  type DatabaseResetPreview,
  type DatabaseResetOutcome,
} from "@liratek/core";
import databaseResetRouter from "../databaseReset.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/database", databaseResetRouter);
  return app;
}

// Rule 24 — the POST body is derived from the real schema, not hand-typed.
// A non-empty string is all `databaseResetSchema` requires; the exact
// confirmation-phrase comparison lives in `DatabaseResetService.reset()`
// (out of scope here) and is irrelevant anyway since `reset` is spied and
// never runs its real body.
const VALID_RESET_BODY = databaseResetSchema.parse({
  confirmation: "RESET ALL DATA",
});

const FAKE_PREVIEW: DatabaseResetPreview = {
  counts: { product_categories: 3, transactions: 10 },
  totalRows: 13,
};

const FAKE_OUTCOME: DatabaseResetOutcome = {
  success: true,
  data: {
    deletedRows: { transactions: 10 },
    totalDeleted: 10,
  },
};

describe("Database Reset REST role gate", () => {
  let app: Express;
  const resetService = getDatabaseResetService();

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
  });

  describe("staff must be REFUSED", () => {
    it("GET /api/database/reset/preview: staff gets 403, preview() never called", async () => {
      const previewSpy = jest.spyOn(resetService, "preview");

      const res = await request(app)
        .get("/api/database/reset/preview")
        .set("x-test-role", "staff");

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ success: false, error: "Forbidden" });
      expect(previewSpy).not.toHaveBeenCalled();
    });

    it("POST /api/database/reset: staff gets 403, reset() never called", async () => {
      const resetSpy = jest.spyOn(resetService, "reset");

      const res = await request(app)
        .post("/api/database/reset")
        .set("x-test-role", "staff")
        .send(VALID_RESET_BODY);

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ success: false, error: "Forbidden" });
      expect(resetSpy).not.toHaveBeenCalled();
    });
  });

  describe("admin is ALLOWED, IPC-identical envelope", () => {
    it("GET /api/database/reset/preview: admin gets 200 with { success, data }, preview() called", async () => {
      const previewSpy = jest
        .spyOn(resetService, "preview")
        .mockReturnValue(FAKE_PREVIEW);

      const res = await request(app)
        .get("/api/database/reset/preview")
        .set("x-test-role", "admin");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: FAKE_PREVIEW });
      expect(previewSpy).toHaveBeenCalledTimes(1);
    });

    it("POST /api/database/reset: admin gets 200 with { success, data }, reset() called with the schema-shaped body", async () => {
      const resetSpy = jest
        .spyOn(resetService, "reset")
        .mockReturnValue(FAKE_OUTCOME);

      const res = await request(app)
        .post("/api/database/reset")
        .set("x-test-role", "admin")
        .send(VALID_RESET_BODY);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: FAKE_OUTCOME.data });
      // The route passes ONLY `confirmation` through (backupPath is
      // desktop-only, resolved by the IPC handler, never by REST) — assert
      // against the schema-derived fixture, not a re-typed literal.
      expect(resetSpy).toHaveBeenCalledWith({
        confirmation: VALID_RESET_BODY.confirmation,
      });
    });
  });

  describe("unauthenticated caller gets 401, service never reached", () => {
    it("GET /api/database/reset/preview: 401, preview() never called", async () => {
      const previewSpy = jest.spyOn(resetService, "preview");

      const res = await request(app).get("/api/database/reset/preview");

      expect(res.status).toBe(401);
      expect(previewSpy).not.toHaveBeenCalled();
    });

    it("POST /api/database/reset: 401, reset() never called", async () => {
      const resetSpy = jest.spyOn(resetService, "reset");

      const res = await request(app)
        .post("/api/database/reset")
        .send(VALID_RESET_BODY);

      expect(res.status).toBe(401);
      expect(resetSpy).not.toHaveBeenCalled();
    });
  });
});
