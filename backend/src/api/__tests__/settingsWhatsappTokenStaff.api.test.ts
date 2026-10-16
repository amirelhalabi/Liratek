/**
 * The shop's WhatsApp Cloud API access token must not be readable by staff.
 *
 * `whatsapp_api_key` is a live Meta bearer token (WhatsAppService sends it as
 * `Authorization: Bearer` to graph.facebook.com). Only an admin can set it,
 * from the admin-only Settings page. But `GET /api/settings` and
 * `GET /api/settings/:key` are open to every signed-in role, and the only
 * redaction list (SENSITIVE_SETTING_KEYS) holds just the profits password. A
 * staff member could copy the token and send WhatsApp messages as the shop
 * from outside LiraTek, and keep doing so after their account is switched off.
 *
 * The admin must still be able to read it back: the Integrations settings form
 * loads the saved token to show and edit it.
 *
 * Security audit run-1, fingerprint
 * settings/whatsapp_api_key-unclassified-secret-staff-readable.
 *
 * Harness follows settingsRoleGate.api.test.ts: REAL router and REAL
 * SettingsService; only the repository underneath is stubbed, so the
 * service's own filtering runs.
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

jest.mock("../../middleware/audit.js", () => ({
  auditRest: jest.fn(),
}));

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
      sessionToken: "test-session",
    };
    next();
  };
  const requireRole = (roles: string[]) => (req: any, res: any, next: any) => {
    if (!req.user) {
      res.status(401).json({ success: false, error: "Not authenticated" });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ success: false, error: "Forbidden" });
      return;
    }
    next();
  };
  return { authenticateJWT, requireAuth: authenticateJWT, requireRole };
});

import express, { type Express } from "express";
import request from "supertest";
import { getSettingsService } from "@liratek/core";
import settingsRouter from "../settings.js";

const TOKEN_KEY = "whatsapp_api_key";
const TOKEN_VALUE = "DUMMY_META_TOKEN_123";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/settings", settingsRouter);
  return app;
}

const rows = [
  { id: 1, key_name: "shop_name", value: "Test Shop" },
  { id: 2, key_name: TOKEN_KEY, value: TOKEN_VALUE },
];

describe("WhatsApp access token is hidden from staff", () => {
  const service = getSettingsService();
  // Stub only the repository, so SettingsService's own filtering runs.
  const repo = (service as unknown as { repo: Record<string, unknown> }).repo;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest
      .spyOn(repo as any, "getAllSettings")
      .mockReturnValue(rows as never);
    jest
      .spyOn(repo as any, "getSetting")
      .mockImplementation(((key: string) =>
        rows.find((r) => r.key_name === key)) as never);
    jest
      .spyOn(repo as any, "getSettingValue")
      .mockImplementation(((key: string) =>
        rows.find((r) => r.key_name === key)?.value) as never);
  });

  it("GET /api/settings as staff does not contain the token", async () => {
    const res = await request(buildApp())
      .get("/api/settings")
      .set("x-test-role", "staff");

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(TOKEN_VALUE);
    // Over-broad redaction guard: ordinary settings still come back.
    expect(JSON.stringify(res.body)).toContain("Test Shop");
  });

  it("GET /api/settings/whatsapp_api_key as staff does not return the token", async () => {
    const res = await request(buildApp())
      .get(`/api/settings/${TOKEN_KEY}`)
      .set("x-test-role", "staff");

    expect(JSON.stringify(res.body)).not.toContain(TOKEN_VALUE);
  });

  it("admin can still read the token back for the Integrations form", async () => {
    const res = await request(buildApp())
      .get("/api/settings")
      .set("x-test-role", "admin");

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toContain(TOKEN_VALUE);
  });
});
