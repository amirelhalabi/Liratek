/**
 * /api/voucher-images writes — LIRA-297 item 3.
 *
 * 1. Role parity: the IPC handlers (`voucher-images:set` / `:delete`,
 *    electron-app/handlers/voucherImageHandlers.ts) are admin-only; the REST
 *    routes had only `authenticateJWT`, so on the web app a staff user could
 *    replace or delete item pictures.
 * 2. One contract: POST validates against the shared core
 *    `setVoucherImageSchema` and answers a refusal with the IPC-identical
 *    envelope (HTTP 200, `{ success: false, error }`). Field names come from
 *    the schema (rule 24).
 *
 * Failing-first (rule 17): the two "staff is refused" cases and the
 * "missing field is a 200 envelope" case were run against the unfixed routes
 * and failed. "forwards every field" already passed — it guards the schema
 * against stripping a key (rule 23).
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

jest.mock("../../middleware/audit.js", () => ({ auditRest: jest.fn() }));

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
      sessionToken: "s",
    };
    next();
  };
  const requireRole = (roles: string[]) => (req: any, res: any, next: any) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(200).json({ success: false, error: "Forbidden" });
      return;
    }
    next();
  };
  return { authenticateJWT, requireAuth: authenticateJWT, requireRole };
});

const setImage = jest.fn();
const deleteImage = jest.fn();

jest.mock("@liratek/core", () => {
  const actual = jest.requireActual("@liratek/core") as Record<string, unknown>;
  return {
    ...actual,
    getVoucherImageService: () => ({
      getAllImages: () => [],
      setImage,
      deleteImage,
    }),
  };
});

import express, { type Express } from "express";
import request from "supertest";
import {
  setVoucherImageSchema,
  type SetVoucherImageInput,
} from "@liratek/core";
import voucherImageRoutes from "../voucher-images.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/voucher-images", voucherImageRoutes);
  return app;
}

const BODY: SetVoucherImageInput = {
  provider: "alfa",
  category: "cards",
  itemKey: "alfa-10",
  imageData: "data:image/png;base64,AAAA",
};

describe("Voucher images REST writes", () => {
  let app: Express;

  beforeEach(() => {
    app = buildApp();
    setImage.mockClear();
    deleteImage.mockClear();
  });

  it("admin: POST forwards every schema field to the service", async () => {
    expect(Object.keys(BODY).sort()).toEqual(
      Object.keys(setVoucherImageSchema.shape).sort(),
    );

    const res = await request(app)
      .post("/api/voucher-images")
      .set("x-test-role", "admin")
      .send(BODY);

    expect(res.body).toEqual({ success: true });
    expect(setImage).toHaveBeenCalledWith(
      BODY.provider,
      BODY.category,
      BODY.itemKey,
      BODY.imageData,
    );
  });

  it("staff: POST is refused and never reaches the service", async () => {
    const res = await request(app)
      .post("/api/voucher-images")
      .set("x-test-role", "staff")
      .send(BODY);

    expect(res.body.success).toBe(false);
    expect(setImage).not.toHaveBeenCalled();
  });

  it("staff: DELETE is refused and never reaches the service", async () => {
    const res = await request(app)
      .delete("/api/voucher-images/3")
      .set("x-test-role", "staff");

    expect(res.body.success).toBe(false);
    expect(deleteImage).not.toHaveBeenCalled();
  });

  it("a missing field is refused with a 200 envelope", async () => {
    const { imageData: _omit, ...partial } = BODY;
    const res = await request(app)
      .post("/api/voucher-images")
      .set("x-test-role", "admin")
      .send(partial);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(setImage).not.toHaveBeenCalled();
  });
});
