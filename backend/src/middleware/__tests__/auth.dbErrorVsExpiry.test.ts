/**
 * A thrown error out of `validateSession` is a different fact than a `null`
 * return, and `authenticateJWT` must answer them differently (Part 1,
 * SESSION_RESILIENCE_AND_DEVICES_PLAN.md).
 *
 * `null` means "this session is genuinely invalid" — 401 is correct, and the
 * client acts on it by signing the user out. A THROWN error means the
 * database could not be checked at all (SQLITE_BUSY, a disk fault, any
 * DatabaseError) — that is not an expiry, so it must never produce the same
 * 401 that tells the client to end the session. It must produce 503, and
 * leave the session alone.
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
import { authenticateJWT } from "../auth.js";

function buildApp(): Express {
  const app = express();
  app.get("/api/thing", authenticateJWT, (_req, res) => {
    res.json({ success: true });
  });
  return app;
}

function validToken(): string {
  return jwt.sign(
    { userId: 42, role: "admin", sessionToken: "session-token", tenantId: 7 },
    SECRET,
    { expiresIn: "7d" },
  );
}

describe("authenticateJWT — database error vs. genuine session expiry", () => {
  beforeEach(() => {
    validateSession.mockReset();
  });

  it("answers 503, NOT 401, when validateSession throws", async () => {
    validateSession.mockRejectedValue(
      new Error("SQLITE_BUSY: database is locked"),
    );

    const res = await request(buildApp())
      .get("/api/thing")
      .set("Authorization", `Bearer ${validToken()}`);

    expect(res.status).toBe(503);
    // A 503 that a client's 401-handling code could mistake for expiry
    // defeats the whole point — the body must read as "try again", not
    // "signed out", and must not collide with the 401 branch's own body.
    expect(res.body).not.toEqual({ error: "Session expired" });
    expect(res.body.error).toBeTruthy();
  });

  it("still answers 401 when validateSession resolves null (unchanged)", async () => {
    validateSession.mockResolvedValue(null);

    const res = await request(buildApp())
      .get("/api/thing")
      .set("Authorization", `Bearer ${validToken()}`);

    // The guard against "fixing" this by failing open: a genuinely invalid
    // session must keep producing 401 — only a THROW becomes 503.
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Session expired" });
  });
});
