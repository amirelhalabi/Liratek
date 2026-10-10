/**
 * Customer-session REST writes — LIRA-297 item 3.
 *
 * start / update / cart add / link-transaction now validate against the SAME
 * core schemas as their IPC twins (packages/core/src/validators/session.ts).
 * Zod strips unknown keys silently (rule 23), so each case sends a body built
 * from the schema's own keys (rule 24) and asserts every one reaches the
 * service; a bad body must be refused with the IPC envelope before the
 * service runs. Actor fields always come from the JWT.
 *
 * Not proven failing-first (rule 17): the "forwards every field" cases guard
 * against the new schemas stripping a key and passed before the schemas were
 * wired; the "refused" cases describe new validation, not an old bug.
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

const startSession = jest.fn(async (..._a: unknown[]) => ({
  success: true,
  sessionId: 5,
}));
const updateSession = jest.fn(async (..._a: unknown[]) => ({ success: true }));
const linkTransactionToSession = jest.fn(async (..._a: unknown[]) => ({
  success: true,
  linked: true,
}));
const addCartItem = jest.fn((..._a: unknown[]) => 11);

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core") as Record<string, unknown>;
  class CustomerSessionService {
    startSession = startSession;
    updateSession = updateSession;
    linkTransactionToSession = linkTransactionToSession;
    linkTransactionToActiveSession = jest.fn();
  }
  return {
    ...actual,
    CustomerSessionService,
    getCustomerSessionRepository: () => ({ addCartItem }),
  };
});

import express, { type Express } from "express";
import request from "supertest";
import {
  startSessionSchema,
  updateSessionSchema,
  sessionCartAddSchema,
  type StartSessionInput,
  type UpdateSessionInput,
  type SessionCartAddInput,
} from "@liratek/core";
import sessionRoutes from "../sessions.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/sessions", sessionRoutes);
  return app;
}

const START: Required<StartSessionInput> = {
  customer_name: "Walk-in",
  customer_phone: "70123456",
  customer_notes: "VIP",
};
const UPDATE: Required<UpdateSessionInput> = {
  customer_name: "Ali",
  customer_phone: "71000000",
  customer_notes: "note",
};
const CART: Required<SessionCartAddInput> = {
  item_id: "uuid-1",
  module: "recharge",
  label: "Alfa $10",
  amount: 10,
  currency: "USD",
  form_data: "{}",
  ipc_channel: "recharge:process",
};

describe("Sessions REST writes — shared core schemas", () => {
  let app: Express;

  beforeEach(() => {
    app = buildApp();
    jest.clearAllMocks();
  });

  it("fixtures cover every schema key", () => {
    const k = (o: object) => Object.keys(o).sort();
    expect(k(START)).toEqual(k(startSessionSchema.shape));
    expect(k(UPDATE)).toEqual(k(updateSessionSchema.shape));
    expect(k(CART)).toEqual(k(sessionCartAddSchema.shape));
  });

  it("POST /start forwards every field; the operator comes from the JWT", async () => {
    const res = await request(app)
      .post("/api/sessions/start")
      .set("x-test-role", "staff")
      .send({ ...START, started_by: "spoofed", user_id: 999 });

    expect(res.body).toEqual({ success: true, sessionId: 5 });
    expect(startSession).toHaveBeenCalledWith({
      ...START,
      started_by: "tester",
      user_id: 42,
    });
  });

  it("POST /start refuses a non-string name before the service runs", async () => {
    const res = await request(app)
      .post("/api/sessions/start")
      .set("x-test-role", "staff")
      .send({ customer_name: 12 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(startSession).not.toHaveBeenCalled();
  });

  it("PUT /:id forwards every field", async () => {
    const res = await request(app)
      .put("/api/sessions/9")
      .set("x-test-role", "admin")
      .send(UPDATE);

    expect(res.body).toEqual({ success: true });
    expect(updateSession).toHaveBeenCalledWith(9, UPDATE, 42);
  });

  it("PUT /:id refuses a wrongly typed field", async () => {
    const res = await request(app)
      .put("/api/sessions/9")
      .set("x-test-role", "admin")
      .send({ customer_phone: 70123456 });

    expect(res.body.success).toBe(false);
    expect(updateSession).not.toHaveBeenCalled();
  });

  it("POST /:id/cart forwards every field; user_id comes from the JWT", async () => {
    const res = await request(app)
      .post("/api/sessions/9/cart")
      .set("x-test-role", "staff")
      .send({ ...CART, user_id: 999 });

    expect(res.body).toEqual({ success: true, id: 11 });
    expect(addCartItem).toHaveBeenCalledWith(9, { ...CART, user_id: 42 });
  });

  it("POST /:id/cart refuses a line with no amount", async () => {
    const { amount: _a, ...noAmount } = CART;
    const res = await request(app)
      .post("/api/sessions/9/cart")
      .set("x-test-role", "staff")
      .send(noAmount);

    expect(res.body.success).toBe(false);
    expect(addCartItem).not.toHaveBeenCalled();
  });

  it("POST /link-transaction refuses a missing transactionId", async () => {
    const res = await request(app)
      .post("/api/sessions/link-transaction")
      .set("x-test-role", "staff")
      .send({ transactionType: "sale", amountUsd: 5, amountLbp: 0 });

    expect(res.body.success).toBe(false);
    expect(linkTransactionToSession).not.toHaveBeenCalled();
  });
});
