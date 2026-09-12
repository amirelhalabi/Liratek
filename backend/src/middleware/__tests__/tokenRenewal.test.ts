/**
 * Sliding JWT re-issue (middleware/auth.ts).
 *
 * The DB session already slides — `touchActivity` pushes `expires_at` forward
 * on every request — but a JWT's `exp` is fixed at mint time, so an active user
 * was signed out on day 7 despite a perfectly healthy session. `authenticateJWT`
 * now mints a replacement when the current token is close to expiring and
 * returns it in a response header for the client to store.
 *
 * Deliberately NOT a refresh-token subsystem: revocation is already instant
 * because every request validates the session row, which is the main thing
 * refresh tokens normally buy.
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

const validateSession = jest.fn();

const SECRET = "test-secret-at-least-32-characters-long!";

jest.mock("@liratek/core", () => {
  const actual =
    jest.requireActual<typeof import("@liratek/core")>("@liratek/core");
  return {
    ...actual,
    getAuthService: () => ({ validateSession }),
    JWT_SECRET: SECRET,
    JWT_EXPIRES_IN: "7d",
  };
});

import express, { type Express } from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { authenticateJWT, RENEWED_TOKEN_HEADER } from "../auth.js";

const USER = {
  id: 42,
  username: "amir",
  role: "admin" as const,
  tenant_id: 7,
  is_active: 1,
};

/** Mint a token that expires in `seconds`. */
function tokenExpiringIn(seconds: number): string {
  return jwt.sign(
    {
      userId: USER.id,
      role: USER.role,
      sessionToken: "session-token",
      tenantId: USER.tenant_id,
    },
    SECRET,
    { expiresIn: seconds },
  );
}

function buildApp(): Express {
  const app = express();
  app.get("/api/thing", authenticateJWT, (_req, res) => {
    res.json({ success: true });
  });
  return app;
}

const DAY = 24 * 60 * 60;

describe("sliding JWT re-issue", () => {
  beforeEach(() => {
    validateSession.mockReset();
    validateSession.mockResolvedValue(USER);
  });

  it("re-issues a token that is close to expiring", async () => {
    const res = await request(buildApp())
      .get("/api/thing")
      .set("Authorization", `Bearer ${tokenExpiringIn(DAY)}`)
      .expect(200);

    const renewed = res.headers[RENEWED_TOKEN_HEADER.toLowerCase()];
    expect(renewed).toBeTruthy();

    // Same identity, longer life.
    const decoded = jwt.verify(renewed, SECRET) as Record<string, unknown>;
    expect(decoded.userId).toBe(USER.id);
    expect(decoded.tenantId).toBe(USER.tenant_id);
    expect(decoded.sessionToken).toBe("session-token");
    expect(decoded.exp as number).toBeGreaterThan(
      Math.floor(Date.now() / 1000) + 6 * DAY,
    );
  });

  it("does NOT re-issue a token with plenty of life left", async () => {
    const res = await request(buildApp())
      .get("/api/thing")
      .set("Authorization", `Bearer ${tokenExpiringIn(6 * DAY)}`)
      .expect(200);

    // Otherwise every request would mint a token, for no benefit.
    expect(res.headers[RENEWED_TOKEN_HEADER.toLowerCase()]).toBeUndefined();
  });

  it("exposes the header so a browser can actually read it cross-origin", async () => {
    const res = await request(buildApp())
      .get("/api/thing")
      .set("Authorization", `Bearer ${tokenExpiringIn(DAY)}`)
      .expect(200);

    expect(res.headers["access-control-expose-headers"]).toContain(
      RENEWED_TOKEN_HEADER,
    );
  });

  it("keeps the session token unchanged, so revocation still works", async () => {
    const res = await request(buildApp())
      .get("/api/thing")
      .set("Authorization", `Bearer ${tokenExpiringIn(DAY)}`)
      .expect(200);

    const decoded = jwt.verify(
      res.headers[RENEWED_TOKEN_HEADER.toLowerCase()],
      SECRET,
    ) as Record<string, unknown>;
    // A new sessionToken would orphan the DB row and make the old session
    // unrevokable — the whole reason this is not a refresh-token scheme.
    expect(decoded.sessionToken).toBe("session-token");
  });

  it("does not re-issue when the session is rejected", async () => {
    validateSession.mockResolvedValue(null);

    const res = await request(buildApp())
      .get("/api/thing")
      .set("Authorization", `Bearer ${tokenExpiringIn(DAY)}`)
      .expect(401);

    // Renewal must never outlive the session it represents.
    expect(res.headers[RENEWED_TOKEN_HEADER.toLowerCase()]).toBeUndefined();
  });

  it("does NOT re-issue an impersonation token — they are short-lived by design", async () => {
    // Minted with the 2h impersonation TTL, so it is always inside the 2-day
    // renewal window: without an explicit exclusion it was re-signed on every
    // single request with the ordinary 7-day lifetime. The previous version of
    // this test asserted that the impersonator claim SURVIVED renewal — true
    // as far as it went, but the right answer is that there is no renewal to
    // survive. A token that must die within hours cannot also be one that
    // slides for a week.
    const token = jwt.sign(
      {
        userId: USER.id,
        role: USER.role,
        sessionToken: "session-token",
        tenantId: USER.tenant_id,
        impersonatorId: 1,
      },
      SECRET,
      { expiresIn: "2h" },
    );

    const res = await request(buildApp())
      .get("/api/thing")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(res.headers[RENEWED_TOKEN_HEADER.toLowerCase()]).toBeUndefined();
  });
});
