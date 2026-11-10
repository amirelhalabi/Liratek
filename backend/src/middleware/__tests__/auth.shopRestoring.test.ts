/**
 * LIRA-377 shop restore (research.md §R5): while one shop's file is swapped,
 * its pool entry is blocked and `get()` throws `ShopRestoringError`. A request
 * for that shop must get 503 "please retry", never 401 (which signs the user
 * out) and never a silent answer from the PLATFORM file. Other shops keep
 * answering 200.
 *
 * Uses the REAL `TenantDatabasePool` and the REAL `buildTenantDbResolver`
 * routing. Only `validateSession` is replaced, by one that reads through the
 * resolver the way the real session lookup does through `getDatabase()`.
 * Backend jest maps `better-sqlite3` to a stub, so each connection is a small
 * fake that answers which file it is. The platform connection answers too, so
 * a request wrongly routed there would validate and answer 200, and the test
 * would catch it.
 */

import { jest } from "@jest/globals";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";

jest.mock("../../server.js", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

const validateSession = jest.fn<(token: string) => Promise<unknown>>();

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
import { TenantDatabasePool, getCurrentTenantId } from "@liratek/core";
import { authenticateJWT } from "../auth.js";
import { buildTenantDbResolver } from "../../database/tenantDbResolver.js";

const BLOCKED_SHOP = 7;
const OTHER_SHOP = 8;

/** The only part of a connection this test reads: which file it is. */
interface FakeConnection {
  label: string;
  inTransaction: boolean;
  pragma: () => void;
  close: () => void;
}

function fakeConnection(label: string): Database.Database {
  const conn: FakeConnection = {
    label,
    inTransaction: false,
    pragma: () => undefined,
    close: () => undefined,
  };
  return conn as unknown as Database.Database;
}

function labelOf(db: Database.Database): string {
  return (db as unknown as FakeConnection).label;
}

function buildApp(): Express {
  const app = express();
  app.get("/api/thing", authenticateJWT, (_req, res) => {
    res.json({ success: true });
  });
  return app;
}

function tokenFor(tenantId: number): string {
  return jwt.sign(
    { userId: 42, role: "admin", sessionToken: "session-token", tenantId },
    SECRET,
    { expiresIn: "7d" },
  );
}

describe("authenticateJWT — a shop paused for restore", () => {
  let dir: string;
  let pool: TenantDatabasePool;
  let servedFrom: string[];

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "liratek-auth-restoring-"));
    // The pool only checks the file exists before calling openDatabase.
    fs.writeFileSync(path.join(dir, `${BLOCKED_SHOP}.db`), "");
    fs.writeFileSync(path.join(dir, `${OTHER_SHOP}.db`), "");
    pool = new TenantDatabasePool({
      dir,
      openDatabase: (fp) => fakeConnection(path.basename(fp)),
      migrate: () => undefined,
    });
    const platformDb = fakeConnection("platform");
    const resolve = buildTenantDbResolver(pool, () => platformDb);

    servedFrom = [];
    validateSession.mockReset();
    validateSession.mockImplementation(async () => {
      servedFrom.push(labelOf(resolve()));
      return {
        id: 42,
        username: "owner",
        role: "admin",
        tenant_id: getCurrentTenantId(),
      };
    });
  });

  afterEach(() => {
    pool.closeAll();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("answers 503 'please retry' for the blocked shop, keeping the session (not 401)", async () => {
    pool.block(BLOCKED_SHOP);

    const res = await request(buildApp())
      .get("/api/thing")
      .set("Authorization", `Bearer ${tokenFor(BLOCKED_SHOP)}`);

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      error: "Could not validate session, please retry",
    });
    expect(validateSession).toHaveBeenCalledTimes(1);
    // Never fell through to the platform file.
    expect(servedFrom).toEqual([]);
  });

  it("another shop's request still answers 200 while one shop is blocked", async () => {
    pool.block(BLOCKED_SHOP);

    const res = await request(buildApp())
      .get("/api/thing")
      .set("Authorization", `Bearer ${tokenFor(OTHER_SHOP)}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(servedFrom).toEqual([`${OTHER_SHOP}.db`]);
  });

  it("the blocked shop answers 200 again once unblocked", async () => {
    pool.block(BLOCKED_SHOP);
    pool.unblock(BLOCKED_SHOP);

    const res = await request(buildApp())
      .get("/api/thing")
      .set("Authorization", `Bearer ${tokenFor(BLOCKED_SHOP)}`);

    expect(res.status).toBe(200);
    expect(servedFrom).toEqual([`${BLOCKED_SHOP}.db`]);
  });
});
