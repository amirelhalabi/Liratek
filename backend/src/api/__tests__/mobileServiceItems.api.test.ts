/**
 * Mobile Service Items REST route tests — the delete + toggle-active slice,
 * plus regression coverage for a rule-19c envelope-status fix on this same
 * router (create + update).
 *
 * Settings > Mobile Services failed on web with "Failed to load mobile
 * service items" because `MobileServicesManager.tsx` called
 * `window.api.mobileServiceItems.count/seed/delete/toggleActive` directly —
 * `undefined` in a browser, so the `count()` call (the first thing `load()`
 * awaits) threw synchronously on every web page load. GET /, GET /admin,
 * POST /, GET /count, POST /seed and PUT /:id already had REST mirrors
 * (mounted, dual-mode-adapted). DELETE /:id and PUT /:id/toggle-active did
 * not — this suite guards those two new routes specifically: auth is
 * required, the envelope matches the IPC handler's shape, and the REST route
 * calls the SAME `MobileServiceItemService` method the IPC handler calls
 * (rule 19), never touching SQL itself (rule 13).
 *
 * A follow-up review caught that BOTH new routes answered HTTP 400 on a
 * HANDLED service failure ({success:false}) instead of 200 — rule 19c is
 * explicit that a handled failure must stay 2xx, because
 * `frontend/src/api/httpClient.ts`'s `requestJson()` rejects on ANY non-2xx
 * status, turning the adapter's caller's `if (result.success)` branch into an
 * uncaught/mis-caught exception on the web transport only. The same review
 * pass found the identical mistake already present on this file's POST /
 * (create) and PUT /:id (update) routes — fixed alongside, and covered below.
 *
 * Pattern mirrors serviceProviders.api.test.ts / partners.api.test.ts: the
 * REAL router (../mobileServiceItems.js) with only ../../server.js (logger)
 * and ../../middleware/auth.js (header-driven `x-test-role`) faked;
 * MobileServiceItemService is the REAL singleton with the method under test
 * stubbed via `jest.spyOn`, so no DB is ever actually queried (better-sqlite3
 * is also auto-mocked for the whole backend suite —
 * backend/src/__mocks__/better-sqlite3.ts).
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
import { getMobileServiceItemService } from "@liratek/core";
import mobileServiceItemsRouter from "../mobileServiceItems.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/mobile-service-items", mobileServiceItemsRouter);
  return app;
}

const ITEM = {
  id: 7,
  provider: "iPick",
  category: "mtc",
  subcategory: "Prepaid",
  label: "3.79",
  cost_lbp: 379000,
  sell_lbp: 430000,
  sort_order: 0,
  is_active: 0,
  validity_days: 10,
  credits: null,
  days_cost_lbp: null,
  sell_days_lbp: null,
  sell_credit_lbp: null,
  max_returned_credits_usd: null,
  created_at: "2026-07-01 00:00:00",
  updated_at: "2026-07-01 00:00:00",
};

describe("Mobile Service Items REST routes — delete + toggle-active", () => {
  let app: Express;
  const service = getMobileServiceItemService();

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
  });

  describe("PUT /api/mobile-service-items/:id/toggle-active (admin)", () => {
    it("calls MobileServiceItemService.toggleActive and returns the IPC-identical envelope", async () => {
      const spy = jest
        .spyOn(service, "toggleActive")
        .mockReturnValue({ success: true, data: ITEM as any });

      const res = await request(app)
        .put("/api/mobile-service-items/7/toggle-active")
        .set("x-test-role", "admin");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: ITEM });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(7);
    });

    it("rejects with 401 when no auth is provided, before the service is ever called", async () => {
      const spy = jest.spyOn(service, "toggleActive");

      const res = await request(app).put(
        "/api/mobile-service-items/7/toggle-active",
      );

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    });

    it("rejects a non-admin (staff) with 403 before the service is ever called", async () => {
      const spy = jest.spyOn(service, "toggleActive");

      const res = await request(app)
        .put("/api/mobile-service-items/7/toggle-active")
        .set("x-test-role", "staff");

      expect(res.status).toBe(403);
      expect(spy).not.toHaveBeenCalled();
    });

    it("returns HTTP 200 with the {success:false} envelope when the item is not found (rule 19c: a handled failure is not a thrown-exception status)", async () => {
      jest
        .spyOn(service, "toggleActive")
        .mockReturnValue({ success: false, error: "Item not found" });

      const res = await request(app)
        .put("/api/mobile-service-items/9999/toggle-active")
        .set("x-test-role", "admin");

      // Must be 200, not 400: requestJson() (frontend/src/api/httpClient.ts)
      // rejects on ANY non-2xx status, so a 400 here would make the adapter's
      // caller catch a thrown ApiError instead of branching on
      // `result.success` the way the IPC transport's identical envelope lets
      // it. See CLAUDE.md rule 19(c).
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: false, error: "Item not found" });
    });

    it("returns 400 for a non-numeric id before the service is ever called", async () => {
      const spy = jest.spyOn(service, "toggleActive");

      const res = await request(app)
        .put("/api/mobile-service-items/not-a-number/toggle-active")
        .set("x-test-role", "admin");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("DELETE /api/mobile-service-items/:id (admin)", () => {
    it("calls MobileServiceItemService.deleteItem and returns the IPC-identical envelope", async () => {
      const spy = jest
        .spyOn(service, "deleteItem")
        .mockReturnValue({ success: true });

      const res = await request(app)
        .delete("/api/mobile-service-items/7")
        .set("x-test-role", "admin");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(7);
    });

    it("rejects with 401 when no auth is provided, before the service is ever called", async () => {
      const spy = jest.spyOn(service, "deleteItem");

      const res = await request(app).delete("/api/mobile-service-items/7");

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    });

    it("rejects a non-admin (staff) with 403 before the service is ever called", async () => {
      const spy = jest.spyOn(service, "deleteItem");

      const res = await request(app)
        .delete("/api/mobile-service-items/7")
        .set("x-test-role", "staff");

      expect(res.status).toBe(403);
      expect(spy).not.toHaveBeenCalled();
    });

    it("returns HTTP 200 with the {success:false} envelope when the delete fails (rule 19c: a handled failure is not a thrown-exception status)", async () => {
      jest
        .spyOn(service, "deleteItem")
        .mockReturnValue({ success: false, error: "Item not found" });

      const res = await request(app)
        .delete("/api/mobile-service-items/9999")
        .set("x-test-role", "admin");

      // Must be 200, not 400: requestJson() (frontend/src/api/httpClient.ts)
      // rejects on ANY non-2xx status, so a 400 here would make the adapter's
      // caller catch a thrown ApiError instead of branching on
      // `result.success` the way the IPC transport's identical envelope lets
      // it. See CLAUDE.md rule 19(c).
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: false, error: "Item not found" });
    });

    it("returns 400 for a non-numeric id before the service is ever called", async () => {
      const spy = jest.spyOn(service, "deleteItem");

      const res = await request(app)
        .delete("/api/mobile-service-items/not-a-number")
        .set("x-test-role", "admin");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  // Same rule-19c envelope-status bug as toggle-active/delete above, found on
  // this router's other two write routes during the same review pass and
  // fixed alongside. See the file header for the full explanation.
  describe("POST /api/mobile-service-items (admin)", () => {
    const CREATE_BODY = {
      provider: "iPick",
      category: "mtc",
      subcategory: "Prepaid",
      label: "3.79",
      cost_lbp: 379000,
      sell_lbp: 430000,
    };

    it("returns HTTP 200 with the {success:false} envelope when the service rejects the create (rule 19c)", async () => {
      jest
        .spyOn(service, "create")
        .mockReturnValue({ success: false, error: "Item already exists" });

      const res = await request(app)
        .post("/api/mobile-service-items")
        .set("x-test-role", "admin")
        .send(CREATE_BODY);

      // Must be 200, not 400 — see the file header comment.
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: false,
        error: "Item already exists",
      });
    });

    it("returns HTTP 201 with the {success:true} envelope when the create succeeds", async () => {
      jest
        .spyOn(service, "create")
        .mockReturnValue({ success: true, data: ITEM as any });

      const res = await request(app)
        .post("/api/mobile-service-items")
        .set("x-test-role", "admin")
        .send(CREATE_BODY);

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ success: true, data: ITEM });
    });
  });

  describe("PUT /api/mobile-service-items/:id (admin)", () => {
    it("returns HTTP 200 with the {success:false} envelope when the service rejects the update (rule 19c)", async () => {
      jest
        .spyOn(service, "update")
        .mockReturnValue({ success: false, error: "Item not found" });

      const res = await request(app)
        .put("/api/mobile-service-items/9999")
        .set("x-test-role", "admin")
        .send({ label: "New label" });

      // Must be 200, not 400 — see the file header comment.
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: false, error: "Item not found" });
    });
  });
});
