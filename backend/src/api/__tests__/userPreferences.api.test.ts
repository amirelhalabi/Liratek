/**
 * LIRA-331 T010 — GET /api/user-preferences/me and
 * PUT /api/user-preferences/me/language (contracts/user-preferences-api.md).
 *
 * Supertest over a REAL in-memory SQLite database built from create_db.sql
 * (users.language arrives with it). Stubbed: `authenticateJWT` (the caller
 * comes from test headers; the shop scope is entered like the real
 * middleware). Request bodies are parsed through setMyLanguageSchema first
 * (rule 24).
 */

import { jest } from "@jest/globals";
import type { Express, NextFunction, Request, Response } from "express";
import type DatabaseCtor from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

jest.mock("../../server.js", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock("../../middleware/auth.js", () => {
  const authenticateJWT = (req: Request, res: Response, next: NextFunction) => {
    const role = req.headers["x-test-role"];
    if (typeof role !== "string") {
      res.status(401).json({ success: false, error: "No token provided" });
      return;
    }
    const tenantId = Number(req.headers["x-test-tenant"] ?? 2);
    (req as Request & { user?: unknown }).user = {
      userId: Number(req.headers["x-test-user"]),
      username: "someone",
      role,
      tenantId,
      sessionToken: "tok",
      ...(req.headers["x-test-impersonator"]
        ? { impersonatorId: Number(req.headers["x-test-impersonator"]) }
        : {}),
    };
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { runWithTenant } = require("@liratek/core");
    runWithTenant(tenantId, () => next());
  };
  const requireRole =
    (roles: string[]) => (req: Request, res: Response, next: NextFunction) => {
      const user = (req as Request & { user?: { role: string } }).user;
      if (!user) {
        res.status(401).json({ success: false, error: "Not authenticated" });
        return;
      }
      if (!roles.includes(user.role)) {
        res.status(403).json({ success: false, error: "Forbidden" });
        return;
      }
      next();
    };
  return { authenticateJWT, requireAuth: authenticateJWT, requireRole };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const RealDatabase =
  require("better-sqlite3/lib/index.js") as typeof DatabaseCtor;

import express from "express";
import request from "supertest";

const BASE = "/api/user-preferences";
let app: Express;
let db: InstanceType<typeof DatabaseCtor>;
let core: typeof import("@liratek/core");
const ids: Record<string, number> = {};

const languageOf = (id: number) =>
  (db.prepare(`SELECT language FROM users WHERE id = ?`).get(id) as {
    language: string | null;
  }).language;

function setLanguage(
  userId: number,
  body: Record<string, unknown>,
  extra: Record<string, string> = {},
  role = "staff",
) {
  return request(app)
    .put(`${BASE}/me/language`)
    .set("x-test-role", role)
    .set("x-test-user", String(userId))
    .set(extra)
    .send(body);
}

beforeAll(async () => {
  db = new RealDatabase(":memory:");
  db.pragma("foreign_keys = ON");
  (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  core = await import("@liratek/core");
  db.exec(
    fs.readFileSync(
      path.join(__dirname, "../../../../electron-app/create_db.sql"),
      "utf8",
    ),
  );
  db.prepare(
    `INSERT INTO tenants (id, name, slug, status) VALUES (2, 'Cell City', 'cellcity', 'active')`,
  ).run();
  const insert = db.prepare(
    `INSERT INTO users (tenant_id, username, password_hash, role, is_active) VALUES (2, ?, 'x', ?, 1)`,
  );
  ids.admin = Number(insert.run("boss", "admin").lastInsertRowid);
  ids.staff = Number(insert.run("cashier", "staff").lastInsertRowid);
  ids.other = Number(insert.run("other", "staff").lastInsertRowid);

  const { default: router } = await import("../userPreferences.js");
  app = express();
  app.use(express.json());
  app.use(BASE, router);
});

afterAll(() => {
  delete (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
});

describe("GET /me", () => {
  it.each(["admin", "staff"])("answers the envelope for %s", async (role) => {
    const res = await request(app)
      .get(`${BASE}/me`)
      .set("x-test-role", role)
      .set("x-test-user", String(role === "admin" ? ids.admin : ids.staff));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: {
        language: null,
        effectiveLanguage: "en",
        shopDefaultLanguage: "en",
        receiptLanguage: "en",
      },
    });
  });

  it("is allowed for an impersonated session (read-only)", async () => {
    const res = await request(app)
      .get(`${BASE}/me`)
      .set("x-test-role", "admin")
      .set("x-test-user", String(ids.admin))
      .set("x-test-impersonator", "999");
    expect(res.body.success).toBe(true);
  });
});

describe("PUT /me/language", () => {
  it("persists the caller's own language", async () => {
    const body = core.setMyLanguageSchema.parse({ language: "ar" });
    const res = await setLanguage(ids.staff, body);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.language).toBe("ar");
    expect(res.body.data.effectiveLanguage).toBe("ar");
    expect(languageOf(ids.staff)).toBe("ar");
  });

  it("refuses an unknown language with VALIDATION_ERROR, HTTP 200", async () => {
    const res = await setLanguage(ids.staff, { language: "fr" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("takes the user from the JWT; a body userId is refused, never obeyed", async () => {
    const res = await setLanguage(ids.staff, {
      language: "en",
      userId: ids.other,
    });
    expect(res.body.success).toBe(false);
    expect(languageOf(ids.other)).toBeNull();
  });

  it("refuses an impersonated session with FORBIDDEN", async () => {
    const res = await setLanguage(
      ids.admin,
      { language: "ar" },
      { "x-test-impersonator": "999" },
      "admin",
    );
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe("FORBIDDEN");
    expect(languageOf(ids.admin)).toBeNull();
  });
});
