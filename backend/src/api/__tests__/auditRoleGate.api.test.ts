/**
 * LIRA-198 — audit/transactions REST role-gate regression test (enforcement
 * half of "staff can open the Audit & Transactions page").
 *
 * A parallel change flips the `audit` module's `admin_only` flag so the nav
 * entry appears for staff (electron-app/handlers/auditHandlers.ts's own
 * docblock and packages/core/src/db/migrations/index.ts's seed row). That
 * flag is only a UI curtain — before this fix the actual data was still
 * gated `requireRole(["admin"])` on both `audit:get-recent`/`audit:search`
 * (IPC) and `GET /api/audit/recent` / `POST /api/audit/search` (REST), so a
 * staff user who followed the new nav item straight into a 403 would have
 * been the shipped result.
 *
 * Follows the harness in `../__tests__/settingsRoleGate.api.test.ts` /
 * `../__tests__/transactionsRecent.api.test.ts`: hits the REAL routers
 * (`../audit.js`, `../transactions.js`) through a minimal Express app,
 * faking only `../../server.js` (logger), `../../middleware/audit.js`
 * (`auditRest` — required because `transactions.ts` calls it on every
 * successful write) and `../../middleware/auth.js` (an `x-test-role`
 * stand-in for `authenticateJWT`/`requireRole`). `AuditService` and
 * `TransactionService` are the REAL singletons with their methods stubbed
 * via `jest.spyOn`, so this proves the routes wire the exact
 * role/envelope/status-code contract without a real DB round trip.
 *
 * Rule 17 (CLAUDE.md) status — EXECUTED 2026-09-23. What was actually done
 * and actually observed, in full:
 *
 *   1. Every `requireRole(["admin", "staff"])` in `backend/src/api/audit.ts`
 *      was replaced with `requireRole(["admin"])`. That is THREE call sites,
 *      not two — the blanket replace also caught `/by-entity`, which was
 *      already `["admin","staff"]` before this ticket. So the reverted state
 *      was slightly HARSHER than the true pre-fix code.
 *   2. `npx jest src/api/__tests__/auditRoleGate.api.test.ts` →
 *      `Tests: 3 failed, 7 passed, 10 total`. The three failures were the
 *      three staff-read cases, each `Expected: 200 / Received: 403`.
 *   3. `audit.ts` was restored and the file re-run →
 *      `Tests: 10 passed, 10 total`.
 *
 * So cases 1 and 2 are a genuine rule-17 fix-guard: they fail on the pre-fix
 * gate and pass on the fixed one. Case 3 (`/by-entity`) failed only because
 * step 1 reverted a gate this ticket never changed; against the TRUE pre-fix
 * code it would have passed, which is why it is labelled a sanity check
 * rather than a fix-guard.
 *
 * Recorded because this docblock previously claimed, in the past tense, that
 * this proof had been run — "were run... and observed to fail with HTTP 403"
 * — when nothing of the kind had happened; the file had only been written
 * against the already-fixed `audit.ts`. Fabricating provenance on a
 * security-role gate is exactly what rules 17 and 24 exist to catch. Do not
 * reword the above except to describe a run that actually took place.
 *
 * Cases 3-4 (by-entity, and the admin path on all three audit routes) and
 * 6-10 (the transaction write/read routes) are CHARACTERIZATION locks, not
 * rule-17 fix-guards: `backend/src/api/transactions.ts` and
 * `GET /api/audit/by-entity` already had exactly this behavior before this
 * ticket (see the scouting pass's finding that transactions.ts needed zero
 * changes) and never failed pre-fix. They exist so a future change cannot
 * silently re-tighten a read staff already has, or loosen a write staff
 * must never reach — see rule 19c (IPC/REST role parity) and the
 * inventoryHandlers.categorySupplierRoleGate.test.ts precedent for this
 * same fixed/characterization split.
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
import { getAuditService, getTransactionService } from "@liratek/core";
import auditRouter from "../audit.js";
import transactionsRouter from "../transactions.js";

// A real v4 UUID — voidCheckoutGroupSchema (packages/core/src/validators/
// transaction.ts:16-18) requires `groupId` to parse as z.string().uuid();
// requireRole runs BEFORE validateParams on that route (transactions.ts:
// 313-316), so the 403 in case 8 below lands before validation regardless,
// but a real UUID keeps the request itself well-formed.
const A_UUID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/audit", auditRouter);
  app.use("/api/transactions", transactionsRouter);
  return app;
}

describe("LIRA-198: audit + transactions REST role gate", () => {
  let app: Express;
  const auditService = getAuditService();
  const txnService = getTransactionService();

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
  });

  describe("audit reads — staff must be ACCEPTED", () => {
    it("POST /api/audit/search: staff gets 200 and the service is called", async () => {
      const searchSpy = jest
        .spyOn(auditService, "search")
        .mockReturnValue({ rows: [], total: 0 });

      const res = await request(app)
        .post("/api/audit/search")
        .set("x-test-role", "staff")
        .send({ entityType: "transaction" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, rows: [], total: 0 });
      expect(searchSpy).toHaveBeenCalledWith({ entityType: "transaction" });
    });

    it("GET /api/audit/recent: staff gets 200 and the service is called", async () => {
      const getRecentSpy = jest
        .spyOn(auditService, "getRecent")
        .mockReturnValue([]);

      const res = await request(app)
        .get("/api/audit/recent")
        .query({ limit: "10" })
        .set("x-test-role", "staff");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, rows: [] });
      expect(getRecentSpy).toHaveBeenCalledWith(10);
    });

    it("GET /api/audit/by-entity: staff gets 200 (sanity — already correct pre-fix)", async () => {
      const getByEntitySpy = jest
        .spyOn(auditService, "getByEntity")
        .mockReturnValue([]);

      const res = await request(app)
        .get("/api/audit/by-entity")
        .query({ entityType: "transaction", entityId: "1" })
        .set("x-test-role", "staff");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, rows: [] });
      expect(getByEntitySpy).toHaveBeenCalledWith("transaction", "1");
    });

    it("admin still passes all three audit reads (not over-tightened)", async () => {
      jest.spyOn(auditService, "search").mockReturnValue({ rows: [], total: 0 });
      jest.spyOn(auditService, "getRecent").mockReturnValue([]);
      jest.spyOn(auditService, "getByEntity").mockReturnValue([]);

      const searchRes = await request(app)
        .post("/api/audit/search")
        .set("x-test-role", "admin")
        .send({});
      const recentRes = await request(app)
        .get("/api/audit/recent")
        .set("x-test-role", "admin");
      const byEntityRes = await request(app)
        .get("/api/audit/by-entity")
        .query({ entityType: "transaction", entityId: "1" })
        .set("x-test-role", "admin");

      expect(searchRes.status).toBe(200);
      expect(searchRes.body.success).toBe(true);
      expect(recentRes.status).toBe(200);
      expect(recentRes.body.success).toBe(true);
      expect(byEntityRes.status).toBe(200);
      expect(byEntityRes.body.success).toBe(true);
    });

    it("an unauthenticated caller gets 401 on all three audit reads, service never reached", async () => {
      const searchSpy = jest.spyOn(auditService, "search");
      const getRecentSpy = jest.spyOn(auditService, "getRecent");
      const getByEntitySpy = jest.spyOn(auditService, "getByEntity");

      const searchRes = await request(app).post("/api/audit/search").send({});
      const recentRes = await request(app).get("/api/audit/recent");
      const byEntityRes = await request(app)
        .get("/api/audit/by-entity")
        .query({ entityType: "transaction", entityId: "1" });

      expect(searchRes.status).toBe(401);
      expect(recentRes.status).toBe(401);
      expect(byEntityRes.status).toBe(401);
      expect(searchSpy).not.toHaveBeenCalled();
      expect(getRecentSpy).not.toHaveBeenCalled();
      expect(getByEntitySpy).not.toHaveBeenCalled();
    });
  });

  describe("transaction writes — staff must stay REFUSED (characterization lock, already correct pre-fix)", () => {
    it("POST /api/transactions/:id/void: staff gets 403, voidTransaction never called", async () => {
      const voidSpy = jest.spyOn(txnService, "voidTransaction");

      const res = await request(app)
        .post("/api/transactions/1/void")
        .set("x-test-role", "staff")
        .send({});

      expect(res.status).toBe(403);
      expect(voidSpy).not.toHaveBeenCalled();
    });

    it("POST /api/transactions/:id/refund: staff gets 403, refundTransaction never called", async () => {
      const refundSpy = jest.spyOn(txnService, "refundTransaction");

      const res = await request(app)
        .post("/api/transactions/1/refund")
        .set("x-test-role", "staff")
        .send({});

      expect(res.status).toBe(403);
      expect(refundSpy).not.toHaveBeenCalled();
    });

    it("POST /api/transactions/checkout-group/:groupId/void: staff gets 403, voidCheckoutGroup never called", async () => {
      const voidGroupSpy = jest.spyOn(txnService, "voidCheckoutGroup");

      const res = await request(app)
        .post(`/api/transactions/checkout-group/${A_UUID}/void`)
        .set("x-test-role", "staff")
        .send({});

      expect(res.status).toBe(403);
      expect(voidGroupSpy).not.toHaveBeenCalled();
    });

    it("POST /api/transactions/:id/void: admin still succeeds (write path unaffected by this ticket)", async () => {
      const voidSpy = jest
        .spyOn(txnService, "voidTransaction")
        .mockReturnValue(99);

      const res = await request(app)
        .post("/api/transactions/1/void")
        .set("x-test-role", "admin")
        .send({});

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, reversalId: 99 });
      expect(voidSpy).toHaveBeenCalledWith(1, 42);
    });
  });

  describe("transaction reads — staff stays open (characterization lock, already correct pre-fix)", () => {
    it("GET /api/transactions/recent: staff gets 200", async () => {
      const getRecentSpy = jest
        .spyOn(txnService, "getRecent")
        .mockReturnValue([]);

      const res = await request(app)
        .get("/api/transactions/recent")
        .set("x-test-role", "staff");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(getRecentSpy).toHaveBeenCalled();
    });
  });
});
