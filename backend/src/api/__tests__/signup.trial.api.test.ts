/**
 * LIRA-332 US1 — POST /api/auth/signup (emailed invite link) starts the new
 * shop on a free trial, whether the invite was asked for by the shop
 * (`source='self'`) or sent by the LiraTek owner (FR-001). No payment field
 * exists or is required (FR-003).
 *
 * Same harness as signup.api.test.ts: the REAL router and schema, with
 * provisionTenant stubbed. The trial row itself is proven in core
 * (TenantProvisioning.trial.test.ts) and per-tenant mode
 * (perTenantStorageProvisioner.test.ts); owner-created shops staying paying
 * (FR-004) is proven over a real DB in admin.trial.api.test.ts.
 *
 * Failing-first: both "starts a trial" cases were run before auth.ts passed
 * `trial` and failed (`trial` was undefined).
 */

import { jest } from "@jest/globals";

jest.mock("../../server.js", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const provisionTenant = jest.fn<(input: Record<string, unknown>) => unknown>();
const inviteConsume = jest.fn();

jest.mock("../../email/createTransport.js", () => ({
  isEmailConfigured: () => false,
}));

jest.mock("@liratek/core", () => {
  const actual =
    jest.requireActual<typeof import("@liratek/core")>("@liratek/core");
  return {
    ...actual,
    getTenantProvisioningService: () => ({ provisionTenant }),
    getSignupInvitationService: () => ({
      check: jest.fn(),
      consume: inviteConsume,
    }),
    getAuthService: () => ({ login: jest.fn(), logout: jest.fn() }),
    getAuditService: () => ({ log: jest.fn() }),
    getUserRepository: () => ({
      findById: () => null,
      findByUsernameInRealm: () => ({ id: 99, username: "amir" }),
    }),
    getTenantRepository: () => ({ getBySlug: () => null }),
    runWithoutTenant: (fn: () => unknown) => fn(),
    runWithTenant: (_id: number, fn: () => unknown) => fn(),
    JWT_SECRET: "test-secret-at-least-32-characters-long!",
    JWT_EXPIRES_IN: "7d",
    APP_BASE_DOMAIN: undefined,
  };
});

jest.mock("../../middleware/rateLimit.js", () => {
  const pass = (_req: unknown, _res: unknown, next: () => void) => next();
  return {
    signupLimiter: pass,
    signupCheckLimiter: pass,
    signupRequestLimiter: pass,
    authLimiter: pass,
    apiLimiter: pass,
  };
});

import express from "express";
import request from "supertest";
import authRoutes from "../auth.js";
import { signupSchema } from "@liratek/core";

const TENANT = { id: 7, name: "Corner Tech", slug: "cornertech" };
const VALID_TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde";
const BODY = {
  name: "Corner Tech",
  slug: "cornertech",
  adminUsername: "amir",
  adminPassword: "Str0ng-Password!",
  inviteToken: VALID_TOKEN,
};

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/auth", authRoutes);
  return a;
}

function useInvite(source: "self" | "owner") {
  const invite = { id: 12, email: "owner@example.com", source };
  inviteConsume.mockImplementation(
    (_token: unknown, _now: unknown, provision: unknown) => ({
      ok: true,
      invite,
      result: (provision as (i: typeof invite) => unknown)(invite),
    }),
  );
}

beforeEach(() => {
  provisionTenant.mockReset();
  provisionTenant.mockReturnValue(TENANT);
  inviteConsume.mockReset();
});

describe("POST /api/auth/signup — free trial", () => {
  it("the body is valid per signupSchema (rule 24)", () => {
    expect(signupSchema.safeParse(BODY).success).toBe(true);
  });

  it.each(["self", "owner"] as const)(
    "an invite with source=%s starts the shop on a trial",
    async (source) => {
      useInvite(source);
      const res = await request(app()).post("/api/auth/signup").send(BODY);
      expect(res.status).toBe(201);
      expect(provisionTenant).toHaveBeenCalledTimes(1);
      expect(provisionTenant.mock.calls[0]![0].trial).toEqual({
        source: "invite_link",
      });
    },
  );

  it("needs no payment field and lets none through (FR-003)", async () => {
    useInvite("self");
    const res = await request(app())
      .post("/api/auth/signup")
      .send({ ...BODY, cardNumber: "4111111111111111", plan: "paid" });
    expect(res.status).toBe(201);
    const input = provisionTenant.mock.calls[0]![0];
    expect(input).not.toHaveProperty("cardNumber");
    expect(input).not.toHaveProperty("plan");
  });
});
