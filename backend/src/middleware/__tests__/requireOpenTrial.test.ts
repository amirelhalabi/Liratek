/**
 * requireOpenTrial (LIRA-332 US2) — once a free trial has ended, every write
 * from the shop's own users is refused with the trial wording, except the
 * allowlist of writes that create no business record (view, export,
 * sign-out, own password/email, access-removing). Reads always pass.
 *
 * Not proven failing-first (new contract): before the middleware existed this
 * file only failed to resolve the import, so the ORDERING case (an ended
 * shop's POST /api/users gets TRIAL_ENDED, never SUBSCRIPTION_READ_ONLY) never
 * ran without the gate. Related evidence: the T031 case in
 * requireWritableSubscription.test.ts was seen failing with the 402 lapsed
 * text for trial_ended before that gate learned the trial wording.
 *
 * Mounted here exactly as server.ts mounts it: app-wide, BEFORE the
 * read-only gate and before every router's own authenticateJWT, so the
 * tenant must come from the bearer token.
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

type Standing = "trial" | "trial_ended" | "active" | "grace" | "read_only";
const statusFor =
  jest.fn<
    (tenantId: number) => { standing: Standing; canWrite: boolean } | null
  >();
const canWrite = jest.fn<(tenantId: number) => boolean>();

jest.mock("@liratek/core", () => {
  const actual =
    jest.requireActual<typeof import("@liratek/core")>("@liratek/core");
  return {
    ...actual,
    getSubscriptionService: () => ({ statusFor, canWrite }),
  };
});

const verifyJwt = jest.fn<(token: string) => unknown>();
jest.mock("../auth.js", () => ({ verifyJwt }));

import express, { type Express } from "express";
import request from "supertest";
import {
  requireOpenTrial,
  TRIAL_ENDED_ALLOWED_WRITES,
  TRIAL_ENDED_MESSAGE,
} from "../requireOpenTrial.js";
import { requireWritableSubscription } from "../requireWritableSubscription.js";

const TOKEN = "Bearer fake.jwt.token";
const reached = jest.fn();

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(requireOpenTrial);
  app.use(requireWritableSubscription);
  app.all(/.*/, (req, res) => {
    reached(req.method, req.originalUrl);
    res.json({ success: true, reached: true });
  });
  return app;
}

function view(standing: Standing) {
  return {
    standing,
    canWrite: standing !== "read_only" && standing !== "trial_ended",
  };
}

function send(
  method: "post" | "put" | "patch" | "delete" | "get",
  path: string,
) {
  const agent = request(buildApp());
  return agent[method](path).set("Authorization", TOKEN);
}

beforeEach(() => {
  reached.mockReset();
  statusFor.mockReset();
  canWrite.mockReset();
  verifyJwt.mockReset();
  verifyJwt.mockReturnValue({ tenantId: 7, userId: 1, role: "admin" });
  statusFor.mockReturnValue(view("trial_ended"));
  canWrite.mockReturnValue(false);
});

const REFUSAL = {
  success: false,
  code: "TRIAL_ENDED",
  error: "Your free trial has ended. Contact LiraTek on WhatsApp to activate.",
};

describe("an ended trial: record-creating writes are refused", () => {
  it.each([
    ["post", "/api/sales/process"],
    ["post", "/api/clients"],
    ["post", "/api/expenses"],
    ["put", "/api/settings/shop_name"],
    ["post", "/api/debts/repayments"],
    ["post", "/api/inventory/products"],
    ["patch", "/api/modules/loto/enabled"],
    ["delete", "/api/clients/5"],
    ["post", "/api/offline/review/3/apply"],
    ["post", "/api/whatsapp/send-message"],
    ["post", "/api/auth/google/link/start"],
    ["post", "/api/mobile-service-items/seed"],
  ] as const)(
    "%s %s → HTTP 200 TRIAL_ENDED, handler never runs",
    async (method, path) => {
      const res = await send(method, path).expect(200);
      expect(res.body).toEqual(REFUSAL);
      expect(reached).not.toHaveBeenCalled();
    },
  );

  it("the exported message is the one every refusal uses", () => {
    expect(TRIAL_ENDED_MESSAGE).toBe(REFUSAL.error);
  });

  it("a path in another case or with a query string is still refused", async () => {
    const res = await send("post", "/api/SALES/process?x=1").expect(200);
    expect(res.body.code).toBe("TRIAL_ENDED");
    expect(reached).not.toHaveBeenCalled();
  });

  it("ordering: POST /api/users gets TRIAL_ENDED, never the lapsed 402", async () => {
    const res = await send("post", "/api/users").expect(200);
    expect(res.body.code).toBe("TRIAL_ENDED");
  });
});

describe("an ended trial: the allowlist and reads pass", () => {
  it.each([
    ["post", "/api/auth/logout"],
    ["post", "/api/auth/sessions/revoke-others"],
    ["delete", "/api/auth/sessions/12"],
    ["delete", "/api/auth/google/link"],
    ["post", "/api/password-reset/change"],
    ["post", "/api/password-reset/set-initial"],
    ["post", "/api/user-email/me/change"],
    ["post", "/api/user-email/verify"],
    ["delete", "/api/user-email/4/google"],
    ["post", "/api/user-invitations/9/revoke"],
    ["post", "/api/offline/devices/2/revoke"],
    ["post", "/api/profits/unlock"],
    ["post", "/api/profits/lock"],
    ["post", "/api/audit/search"],
    ["post", "/api/reports/pdf"],
    ["post", "/api/reports/backup/verify"],
    ["post", "/api/vouchers/validate"],
    ["post", "/api/exchange-lots/preview"],
    ["post", "/api/product-units/list"],
    ["post", "/api/product-units/summary"],
    ["post", "/api/product-units/for-sale-items"],
    ["post", "/api/auth/login"],
    ["post", "/api/offline/pair"],
  ] as const)("%s %s passes", async (method, path) => {
    const res = await send(method, path).expect(200);
    expect(res.body.reached).toBe(true);
  });

  it("every allowlist entry carries a reason", () => {
    for (const entry of TRIAL_ENDED_ALLOWED_WRITES) {
      expect(entry.reason.length).toBeGreaterThan(3);
    }
  });

  it("GET passes and is not even looked up", async () => {
    const res = await send("get", "/api/transactions").expect(200);
    expect(res.body.reached).toBe(true);
    expect(statusFor).not.toHaveBeenCalled();
  });
});

describe("owner decision 2026-10-17: backup and off-boarding staff still work", () => {
  it("POST /api/reports/backup passes", async () => {
    const res = await send("post", "/api/reports/backup").expect(200);
    expect(res.body.reached).toBe(true);
  });

  it("deactivating a staff member (is_active 0) passes", async () => {
    const res = await send("put", "/api/users/5/active")
      .send({ is_active: 0 })
      .expect(200);
    expect(res.body.reached).toBe(true);
  });

  it("re-activating a staff member (is_active 1) is still refused", async () => {
    const res = await send("put", "/api/users/5/active")
      .send({ is_active: 1 })
      .expect(200);
    expect(res.body).toEqual(REFUSAL);
    expect(reached).not.toHaveBeenCalled();
  });
});

describe("every other standing passes this gate", () => {
  it.each(["trial", "active", "grace"] as const)(
    "%s → POST /api/sales/process passes",
    async (standing) => {
      statusFor.mockReturnValue(view(standing));
      canWrite.mockReturnValue(true);
      const res = await send("post", "/api/sales/process").expect(200);
      expect(res.body.reached).toBe(true);
    },
  );

  it("read_only passes THIS gate (the older gate keeps its own rules)", async () => {
    statusFor.mockReturnValue(view("read_only"));
    canWrite.mockReturnValue(false);
    const res = await send("post", "/api/sales/process").expect(200);
    expect(res.body.reached).toBe(true);
    const users = await send("post", "/api/users").expect(402);
    expect(users.body.code).toBe("SUBSCRIPTION_READ_ONLY");
  });
});

describe("no tenant, or an unknown standing, fails open", () => {
  it("no bearer token", async () => {
    const agent = request(buildApp());
    const res = await agent.post("/api/sales/process").expect(200);
    expect(res.body.reached).toBe(true);
    expect(statusFor).not.toHaveBeenCalled();
  });

  it("a platform user (tenantId null)", async () => {
    verifyJwt.mockReturnValue({
      tenantId: null,
      userId: 1,
      role: "super_admin",
    });
    const res = await send(
      "post",
      "/api/admin/subscriptions/7/activate",
    ).expect(200);
    expect(res.body.reached).toBe(true);
  });

  it("a bearer that is not a JWT (e.g. a device key) resolves to no tenant", async () => {
    verifyJwt.mockReturnValue(null);
    const res = await send("post", "/api/offline/events").expect(200);
    expect(res.body.reached).toBe(true);
  });

  it("no subscription row", async () => {
    statusFor.mockReturnValue(null);
    canWrite.mockReturnValue(true);
    const res = await send("post", "/api/sales/process").expect(200);
    expect(res.body.reached).toBe(true);
  });

  it("a thrown lookup", async () => {
    statusFor.mockImplementation(() => {
      throw new Error("db down");
    });
    canWrite.mockReturnValue(true);
    const res = await send("post", "/api/sales/process").expect(200);
    expect(res.body.reached).toBe(true);
  });
});

describe("wording (FR-011)", () => {
  it("never says overdue, lapsed or read-only", async () => {
    for (const path of [
      "/api/users",
      "/api/settings/x",
      "/api/sales/process",
    ]) {
      const res = await send("post", path);
      expect(JSON.stringify(res.body)).not.toMatch(/overdue|lapsed|read-only/i);
    }
  });
});
