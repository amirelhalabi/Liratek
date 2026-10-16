/**
 * requireWritableSubscription — the gate must match the path the way Express
 * routes it, not the way the client spelled it.
 *
 * Express 4 mounts routers case-insensitively by default, and server.ts never
 * turns on "case sensitive routing". So `PUT /api/Settings/shop_name` reaches
 * the real settings router. If the gate compares the raw URL case-sensitively
 * against its lowercase prefixes, that request is waved through as "not
 * administrative" and a lapsed (read_only) shop's admin keeps changing
 * settings, users and modules by changing the case of one letter.
 *
 * Security audit run-1, fingerprint
 * subscription-gate/case-sensitive-prefix-vs-case-insensitive-express-mount.
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

const canWrite = jest.fn();

jest.mock("@liratek/core", () => {
  const actual =
    jest.requireActual<typeof import("@liratek/core")>("@liratek/core");
  return {
    ...actual,
    getSubscriptionService: () => ({ canWrite }),
  };
});

const verifyJwt = jest.fn();
jest.mock("../auth.js", () => ({ verifyJwt }));

import express, { type Express } from "express";
import request from "supertest";
import { requireWritableSubscription } from "../requireWritableSubscription.js";

/** Mounted exactly like server.ts: a router under a lowercase prefix. */
function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(requireWritableSubscription);
  const ok = (_req: express.Request, res: express.Response) =>
    res.json({ success: true, reached: true });

  const settings = express.Router();
  settings.put("/:key", ok);
  app.use("/api/settings", settings);

  const users = express.Router();
  users.post("/", ok);
  app.use("/api/users", users);

  return app;
}

const TOKEN = "Bearer fake.jwt.token";

beforeEach(() => {
  canWrite.mockReset();
  verifyJwt.mockReset();
  verifyJwt.mockReturnValue({ tenantId: 7, userId: 1, role: "admin" });
  canWrite.mockReturnValue(false);
});

describe("path case cannot dodge the read_only gate", () => {
  it("control: the lowercase path is refused", async () => {
    await request(buildApp())
      .put("/api/settings/shop_name")
      .set("Authorization", TOKEN)
      .expect(402);
  });

  it.each(["/api/Settings/shop_name", "/api/SETTINGS/shop_name"])(
    "%s reaches the settings router, so it must be refused too",
    async (path) => {
      const res = await request(buildApp())
        .put(path)
        .set("Authorization", TOKEN);

      expect(res.status).toBe(402);
      expect(res.body.reached).toBeUndefined();
    },
  );

  it("POST /api/Users is refused like POST /api/users", async () => {
    const res = await request(buildApp())
      .post("/api/Users")
      .set("Authorization", TOKEN);

    expect(res.status).toBe(402);
    expect(res.body.reached).toBeUndefined();
  });
});
