/**
 * LIRA-377 T044 — a paired PC that knocks while its shop's file is being
 * swapped must hear SHOP_RESTORING (plain retry), never INVALID_DEVICE_KEY:
 * the PC treats an invalid key as "pair this PC again".
 *
 * The REAL authenticateDevice + OfflineDeviceService.verifyKey; only the
 * device lookup is made to throw the pool's ShopRestoringError, the way
 * `TenantDatabasePool.get` does for a blocked shop.
 */
import { jest } from "@jest/globals";

jest.mock("../../server.js", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import express from "express";
import request from "supertest";
import { OfflineDeviceRepository, ShopRestoringError } from "@liratek/core";
import { authenticateDevice } from "../deviceAuth.js";

const KEY = `ltd_1_aaaaaaaaaaa1_${"b".repeat(64)}`;

function app() {
  const a = express();
  a.get("/probe", authenticateDevice, (_req, res) => {
    res.json({ success: true });
  });
  return a;
}

afterEach(() => jest.restoreAllMocks());

describe("authenticateDevice — shop being restored", () => {
  it("answers SHOP_RESTORING with the retry message (HTTP 200 envelope)", async () => {
    jest.spyOn(OfflineDeviceRepository.prototype, "findByKeyId").mockImplementation(() => {
      throw new ShopRestoringError(1);
    });
    const res = await request(app()).get("/probe").set("X-LiraTek-Device-Key", KEY);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: false,
      code: "SHOP_RESTORING",
      error: "The shop is being restored, try again in a moment",
    });
  });

  it("control: any other lookup failure stays INVALID_DEVICE_KEY", async () => {
    jest.spyOn(OfflineDeviceRepository.prototype, "findByKeyId").mockImplementation(() => {
      throw new Error("disk");
    });
    const res = await request(app()).get("/probe").set("X-LiraTek-Device-Key", KEY);
    expect(res.body).toMatchObject({ success: false, code: "INVALID_DEVICE_KEY" });
  });
});
