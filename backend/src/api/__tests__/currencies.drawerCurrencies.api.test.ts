/**
 * GET / PUT /api/currencies/drawers/:drawerName/currencies — the web twins
 * of IPC `currencies:forDrawer` and `currencies:setDrawerCurrencies`.
 *
 * `backendApi.ts` has always called these paths on web, but the router never
 * defined them: every call answered 404, which `requestJson` throws on. Seen
 * 2026-10-12 as the Initial Drawer Amounts window hanging on "Saving…".
 *
 * Same roles as IPC: reading is open to any signed-in user, setting is
 * admin only. A service refusal answers HTTP 200 + the envelope (rule 19c).
 *
 * Rule 17: written before the routes existed and run against the router.
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
import { getCurrencyService } from "@liratek/core";
import currenciesRouter from "../currencies.js";
import { auditRest } from "../../middleware/audit.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/currencies", currenciesRouter);
  return app;
}

describe("drawer currency list — REST twins of currencies:forDrawer / setDrawerCurrencies", () => {
  const app = buildApp();
  const path = "/api/currencies/drawers/OMT_App/currencies";

  beforeEach(() => {
    jest.restoreAllMocks();
    (auditRest as jest.Mock).mockClear();
  });

  it("GET: any signed-in user reads the drawer's currency list", async () => {
    const spy = jest
      .spyOn(getCurrencyService(), "getCurrenciesForDrawer")
      .mockReturnValue(["USD", "LBP"]);

    const res = await request(app).get(path).set("x-test-role", "staff");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, currencies: ["USD", "LBP"] });
    expect(spy).toHaveBeenCalledWith("OMT_App");
  });

  it("PUT: admin sets the list, gets the service envelope, and it is audited", async () => {
    const spy = jest
      .spyOn(getCurrencyService(), "setCurrenciesForDrawer")
      .mockReturnValue({ success: true });

    const res = await request(app)
      .put(path)
      .set("x-test-role", "admin")
      .send({ currencies: ["USD", "LBP"] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(spy).toHaveBeenCalledWith("OMT_App", ["USD", "LBP"]);
    expect(auditRest).toHaveBeenCalledTimes(1);
  });

  it("PUT: staff is refused and nothing is written", async () => {
    const spy = jest.spyOn(getCurrencyService(), "setCurrenciesForDrawer");

    const res = await request(app)
      .put(path)
      .set("x-test-role", "staff")
      .send({ currencies: ["USD"] });

    expect(res.status).toBe(403);
    expect(spy).not.toHaveBeenCalled();
  });

  it("PUT: a service refusal answers HTTP 200 + the service envelope, not audited", async () => {
    const refusal = {
      success: false,
      error:
        "The General drawer accepts every currency — its currency list is not configurable.",
    };
    jest
      .spyOn(getCurrencyService(), "setCurrenciesForDrawer")
      .mockReturnValue(refusal);

    const res = await request(app)
      .put("/api/currencies/drawers/General/currencies")
      .set("x-test-role", "admin")
      .send({ currencies: ["USD", "LBP", "USDT"] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(refusal);
    expect(auditRest).not.toHaveBeenCalled();
  });

  it("PUT: a body without a currencies list is rejected before the service", async () => {
    const spy = jest.spyOn(getCurrencyService(), "setCurrenciesForDrawer");

    const res = await request(app)
      .put(path)
      .set("x-test-role", "admin")
      .send({ currencies: "USD" });

    expect(res.body.success).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});
