/**
 * POST /api/sessions/link-transaction must forward `profitUsd`/`profitLbp`
 * to CustomerSessionService exactly like the IPC handler
 * (electron-app/handlers/sessionHandlers.ts, `session:linkTransaction`).
 *
 * Before the fix the REST route passed only 5 args, so on the web app a
 * session-linked transaction (e.g. an Exchange booked inside a session) was
 * saved with 0 profit on the link, while desktop kept the real profit.
 *
 * Proven failing-first (rule 17): run against the unfixed route before the
 * fix was written.
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

jest.mock("../../middleware/audit.js", () => ({ auditRest: jest.fn() }));

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
      sessionToken: "s",
    };
    next();
  };
  const requireRole = (roles: string[]) => (req: any, res: any, next: any) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ success: false, error: "Forbidden" });
      return;
    }
    next();
  };
  return { authenticateJWT, requireAuth: authenticateJWT, requireRole };
});

const linkTransactionToSession = jest.fn(async (..._a: unknown[]) => ({
  success: true,
  linked: true,
}));
const linkTransactionToActiveSession = jest.fn(async (..._a: unknown[]) => ({
  success: true,
  linked: true,
}));

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core") as Record<string, unknown>;
  class CustomerSessionService {
    linkTransactionToSession = linkTransactionToSession;
    linkTransactionToActiveSession = linkTransactionToActiveSession;
  }
  return { ...actual, CustomerSessionService };
});

import express, { type Express } from "express";
import request from "supertest";
import sessionRoutes from "../sessions.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/sessions", sessionRoutes);
  return app;
}

describe("Sessions REST — link-transaction forwards profit like IPC", () => {
  let app: Express;

  beforeEach(() => {
    app = buildApp();
    linkTransactionToSession.mockClear();
    linkTransactionToActiveSession.mockClear();
  });

  it("with a sessionId: forwards profitUsd/profitLbp to linkTransactionToSession", async () => {
    const res = await request(app)
      .post("/api/sessions/link-transaction")
      .set("x-test-role", "staff")
      .send({
        sessionId: 7,
        transactionType: "exchange",
        transactionId: 99,
        amountUsd: 100,
        amountLbp: 0,
        profitUsd: 1.5,
        profitLbp: 2500,
      });

    expect(res.body.success).toBe(true);
    expect(linkTransactionToSession).toHaveBeenCalledWith(
      7,
      "exchange",
      99,
      100,
      0,
      1.5,
      2500,
    );
  });

  it("without a sessionId: forwards profitUsd/profitLbp to linkTransactionToActiveSession", async () => {
    const res = await request(app)
      .post("/api/sessions/link-transaction")
      .set("x-test-role", "admin")
      .send({
        transactionType: "exchange",
        transactionId: 100,
        amountUsd: 0,
        amountLbp: 900_000,
        profitUsd: 0.25,
        profitLbp: 0,
      });

    expect(res.body.success).toBe(true);
    expect(linkTransactionToActiveSession).toHaveBeenCalledWith(
      "exchange",
      100,
      0,
      900_000,
      0.25,
      0,
    );
  });

  it("omitted profit defaults to 0 (same as IPC's `?? 0`)", async () => {
    await request(app)
      .post("/api/sessions/link-transaction")
      .set("x-test-role", "staff")
      .send({
        sessionId: 7,
        transactionType: "sale",
        transactionId: 1,
        amountUsd: 5,
        amountLbp: 0,
      });

    expect(linkTransactionToSession).toHaveBeenCalledWith(
      7,
      "sale",
      1,
      5,
      0,
      0,
      0,
    );
  });
});
