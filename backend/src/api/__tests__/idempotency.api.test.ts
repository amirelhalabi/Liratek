/**
 * Duplicate-submission guard on the two money write routes the phone app
 * uses (LIRA-289 FR-017, T008): POST /api/services/transactions and
 * POST /api/debts/repayments.
 *
 * Real routers, real Zod schemas, and a REAL in-memory SQLite database built
 * from create_db.sql, so the idempotency table and its unique index are real.
 * Only authentication is faked (header-driven, tenant 1). The two services
 * are spied on so the test counts how often a sale or repayment is actually
 * booked.
 *
 * Written FIRST and run against the code without the guard (rule 17).
 */

import { jest } from "@jest/globals";
import type DatabaseCtor from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

jest.mock("../../server.js", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock("../../middleware/auth.js", () => {
  const authenticateJWT = (req: any, _res: any, next: any) => {
    req.user = { userId: 7, username: "owner", role: "admin", tenantId: 1, sessionToken: "s" };
    next();
  };
  const requireRole = () => (_req: any, _res: any, next: any) => next();
  return { authenticateJWT, requireAuth: authenticateJWT, requireRole };
});

jest.mock("../../middleware/audit.js", () => ({ auditRest: jest.fn() }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const RealDatabase = require("better-sqlite3/lib/index.js") as typeof DatabaseCtor;

import express, { type Express } from "express";
import request from "supertest";

let app: Express;
let db: InstanceType<typeof DatabaseCtor>;
let core: typeof import("@liratek/core");

const SALE = {
  provider: "WHISH_APP",
  serviceType: "SEND",
  amount: 50,
  currency: "USD",
  paidByMethod: "CUSTOMER_ACCOUNT",
  clientId: 3,
};
const REPAYMENT = { clientId: 3, amountUSD: 20, amountLBP: 0, paidByMethod: "WHISH" };

beforeAll(async () => {
  process.env.JWT_SECRET = "idempotency-test-secret-0123456789-0123456789";
  db = new RealDatabase(":memory:");
  db.pragma("foreign_keys = ON");
  (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  core = await import("@liratek/core");
  db.exec(fs.readFileSync(path.join(__dirname, "../../../../electron-app/create_db.sql"), "utf8"));

  const services = (await import("../services.js")).default;
  const debts = (await import("../debts.js")).default;
  app = express();
  app.use(express.json());
  // Production gets tenant context from authenticateJWT; here it is fixed.
  app.use((_req, _res, next) => core.runWithTenant(1, () => next()));
  app.use("/api/services", services);
  app.use("/api/debts", debts);
});

afterAll(() => db.close());

beforeEach(() => {
  jest.restoreAllMocks();
  core.resetTenantContext();
});

function postSale(key?: string) {
  const r = request(app).post("/api/services/transactions");
  if (key) r.set("Idempotency-Key", key);
  return r.send(SALE);
}

function postRepayment(key?: string) {
  const r = request(app).post("/api/debts/repayments");
  if (key) r.set("Idempotency-Key", key);
  return r.send(REPAYMENT);
}

describe("Idempotency-Key on POST /api/services/transactions", () => {
  it("books a sale ONCE when the same key is sent twice, and replays the first reply", async () => {
    const spy = jest
      .spyOn(core.getFinancialService(), "addTransaction")
      .mockReturnValueOnce({ success: true, id: 101 } as never)
      .mockReturnValueOnce({ success: true, id: 102 } as never);

    const first = await postSale("phone-tap-0001");
    const second = await postSale("phone-tap-0001");

    expect(spy).toHaveBeenCalledTimes(1);
    expect(first.body).toEqual({ success: true, id: 101 });
    expect(second.status).toBe(first.status);
    expect(second.body).toEqual(first.body);
  });

  it("books two sales for two different keys", async () => {
    const spy = jest
      .spyOn(core.getFinancialService(), "addTransaction")
      .mockReturnValue({ success: true, id: 7 } as never);
    await postSale("phone-tap-0002");
    await postSale("phone-tap-0003");
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("does not remember a refusal: a retry with the same key runs again", async () => {
    const spy = jest
      .spyOn(core.getFinancialService(), "addTransaction")
      .mockReturnValueOnce({ success: false, error: "Insufficient balance" } as never)
      .mockReturnValueOnce({ success: true, id: 103 } as never);

    const refused = await postSale("phone-tap-0004");
    const retried = await postSale("phone-tap-0004");

    expect(refused.body.success).toBe(false);
    expect(retried.body).toEqual({ success: true, id: 103 });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("without the header behaves exactly as before (every request is booked)", async () => {
    const spy = jest
      .spyOn(core.getFinancialService(), "addTransaction")
      .mockReturnValue({ success: true, id: 9 } as never);
    await postSale();
    await postSale();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("refuses a malformed key instead of silently ignoring it", async () => {
    const spy = jest.spyOn(core.getFinancialService(), "addTransaction");
    const res = await postSale("bad key!");
    expect(res.body).toEqual({ success: false, error: "INVALID_IDEMPOTENCY_KEY" });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("Idempotency-Key on POST /api/debts/repayments", () => {
  it("books a repayment ONCE when the same key is sent twice", async () => {
    const spy = jest
      .spyOn(core.getDebtService(), "addRepayment")
      .mockReturnValueOnce({ success: true, id: 201 } as never)
      .mockReturnValueOnce({ success: true, id: 202 } as never);

    const first = await postRepayment("phone-tap-0101");
    const second = await postRepayment("phone-tap-0101");

    expect(spy).toHaveBeenCalledTimes(1);
    expect(second.body).toEqual(first.body);
  });

  it("the same key on the two different routes is two different submissions", async () => {
    const sale = jest
      .spyOn(core.getFinancialService(), "addTransaction")
      .mockReturnValue({ success: true, id: 1 } as never);
    const repay = jest
      .spyOn(core.getDebtService(), "addRepayment")
      .mockReturnValue({ success: true, id: 2 } as never);
    await postSale("phone-tap-0202");
    await postRepayment("phone-tap-0202");
    expect(sale).toHaveBeenCalledTimes(1);
    expect(repay).toHaveBeenCalledTimes(1);
  });
});
