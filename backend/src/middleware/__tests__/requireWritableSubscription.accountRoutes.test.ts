/**
 * Settings -> Users email/invite routes, the admin "send reset link" button
 * and "Connect Google" are shop ADMINISTRATION: a lapsed (read_only) shop
 * must not create invites, change emails or send links — the same rule that
 * already gates `/api/users`.
 *
 * The PUBLIC token routes stay reachable even when the visitor happens to
 * carry a lapsed shop's bearer token (an invitee opening /#/join in a
 * browser that is signed in, say), and so do the actions that only REMOVE
 * access (revoke an invite, disconnect Google).
 */

import { jest } from "@jest/globals";

jest.mock("../../server.js", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const canWrite = jest.fn();
jest.mock("@liratek/core", () => {
  const actual = jest.requireActual<typeof import("@liratek/core")>("@liratek/core");
  return { ...actual, getSubscriptionService: () => ({ canWrite }) };
});

const verifyJwt = jest.fn();
jest.mock("../auth.js", () => ({ verifyJwt }));

import express from "express";
import request from "supertest";
import { requireWritableSubscription } from "../requireWritableSubscription.js";

const TOKEN = "Bearer fake.jwt.token";

beforeEach(() => {
  canWrite.mockReset();
  verifyJwt.mockReset();
  verifyJwt.mockReturnValue({ tenantId: 7, userId: 1, role: "admin" });
  canWrite.mockReturnValue(false); // lapsed
});

function call(method: "post" | "put" | "delete", path: string) {
  const app = express();
  app.use(express.json());
  app.use(requireWritableSubscription);
  app[method](path, (_q, r) => r.json({ success: true, reached: true }));
  return request(app)[method](path).set("Authorization", TOKEN);
}

describe("gated in read_only (402)", () => {
  it.each([
    ["post", "/api/user-invitations"],
    ["post", "/api/user-invitations/12/resend"],
    ["put", "/api/user-email/5"],
    ["post", "/api/user-email/5/send-verification"],
    ["post", "/api/password-reset/send/5"],
    ["post", "/api/auth/google/link/start"],
  ] as const)("%s %s", async (method, path) => {
    const res = await call(method, path).expect(402);
    expect(res.body.code).toBe("SUBSCRIPTION_READ_ONLY");
  });
});

describe("stays writable in read_only", () => {
  it.each([
    // public token routes
    ["post", "/api/user-invitations/check"],
    ["post", "/api/user-invitations/accept"],
    // LIRA-288: "Join with Google" start, on the public invite page
    ["post", "/api/user-invitations/google/start"],
    ["post", "/api/user-email/verify"],
    ["post", "/api/password-reset/forgot"],
    ["post", "/api/password-reset/check"],
    ["post", "/api/password-reset/reset"],
    ["post", "/api/auth/google/sso-exchange"],
    ["post", "/api/auth/google/choose"],
    // removing access is never blocked
    ["post", "/api/user-invitations/12/revoke"],
    ["delete", "/api/auth/google/link"],
    // LIRA-288: an admin disconnecting a member's Google (offboarding)
    ["delete", "/api/user-email/5/google"],
    // LIRA-291: a user with no password adding one is account safety
    ["post", "/api/password-reset/set-initial"],
  ] as const)("%s %s", async (method, path) => {
    const res = await call(method, path).expect(200);
    expect(res.body.reached).toBe(true);
  });
});
