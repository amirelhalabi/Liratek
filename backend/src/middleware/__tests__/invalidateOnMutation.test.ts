/**
 * Push invalidation after successful writes (middleware/invalidateOnMutation.ts).
 *
 * Uses the REAL tenant context (`runWithTenant`, as authenticateJWT does in
 * production) and mocks only the socket transport, so these exercise the actual
 * interaction that matters: does a tenant-scoped emit happen, inside the
 * request's async context, exactly when a mutation committed.
 *
 * Rule 17 — proven to fail on the pre-fix code: with `app.use(invalidateOnMutation)`
 * removed from buildApp(), "emits after a successful mutation" fails with 0
 * calls instead of 1. That was the state of the whole backend before this: one
 * emit site in api/sales.ts and nothing anywhere else.
 */

import { jest } from "@jest/globals";

const emitEvent = jest.fn();
jest.mock("../../websocket/io.js", () => ({
  emitEvent,
  // setIO/tenantRoom are unused here but keep the module shape intact.
  setIO: jest.fn(),
  tenantRoom: (id: number) => `tenant:${id}`,
}));

import express, { type Express } from "express";
import request from "supertest";
import { runWithTenant, runWithoutTenant } from "@liratek/core";
import {
  invalidateOnMutation,
  INVALIDATE_EVENT,
} from "../invalidateOnMutation.js";

const TENANT_ID = 1;

/**
 * `tenant: false` reproduces a super_admin/control-plane route, which runs with
 * NO tenant context — `getCurrentTenantId()` throws there by design.
 */
function buildApp(tenant: boolean = true): Express {
  const app = express();
  app.use(express.json());

  app.use((_req, _res, next) => {
    if (tenant) runWithTenant(TENANT_ID, () => next());
    else runWithoutTenant(() => next());
  });

  app.use(invalidateOnMutation);

  app.post("/api/sessions/start", (_req, res) => {
    res.json({ success: true, sessionId: 3 });
  });
  app.patch("/api/drawer-topup/7", (_req, res) => {
    res.json({ success: true });
  });
  app.post("/api/sessions/rejected", (_req, res) => {
    res.json({ success: false, error: "nope" });
  });
  app.get("/api/sessions/active-list", (_req, res) => {
    res.json({ success: true, sessions: [] });
  });
  app.post("/api/auth/login", (_req, res) => {
    res.json({ success: true });
  });

  return app;
}

describe("invalidateOnMutation middleware", () => {
  beforeEach(() => {
    emitEvent.mockClear();
  });

  it("emits after a successful mutation", async () => {
    await request(buildApp())
      .post("/api/sessions/start")
      .send({ customer_name: "Amir" })
      .expect(200);

    expect(emitEvent).toHaveBeenCalledTimes(1);
    const [tenantId, event, payload] = emitEvent.mock.calls[0] as [
      number,
      string,
      { entity: string; action: string; at: string },
    ];
    expect(tenantId).toBe(TENANT_ID);
    expect(event).toBe(INVALIDATE_EVENT);
    expect(payload.entity).toBe("sessions");
    expect(payload.action).toBe("create");
    expect(typeof payload.at).toBe("string");
  });

  it("carries NO business data — only an entity name, action and timestamp", async () => {
    await request(buildApp())
      .post("/api/sessions/start")
      .send({ customer_name: "Amir", secret_balance: 9999 });

    const payload = (emitEvent.mock.calls[0] as unknown[])[2] as Record<
      string,
      unknown
    >;
    // A duplicated or out-of-order event must not be able to show a stale
    // figure: clients refetch through their own authorised read path.
    expect(Object.keys(payload).sort()).toEqual(["action", "at", "entity"]);
    expect(JSON.stringify(payload)).not.toContain("9999");
    expect(JSON.stringify(payload)).not.toContain("Amir");
  });

  it("maps the verb and normalises the entity name", async () => {
    await request(buildApp()).patch("/api/drawer-topup/7").send({ amount: 5 });

    const [, , payload] = emitEvent.mock.calls[0] as [
      number,
      string,
      { entity: string; action: string },
    ];
    expect(payload.entity).toBe("drawer_topup");
    expect(payload.action).toBe("update");
  });

  it("does not emit for a mutation the server rejected", async () => {
    await request(buildApp()).post("/api/sessions/rejected").send({});
    expect(emitEvent).not.toHaveBeenCalled();
  });

  it("does not emit for a read", async () => {
    await request(buildApp()).get("/api/sessions/active-list").expect(200);
    expect(emitEvent).not.toHaveBeenCalled();
  });

  it("skips /api/auth/* so a login does not storm every client", async () => {
    await request(buildApp()).post("/api/auth/login").send({ username: "x" });
    expect(emitEvent).not.toHaveBeenCalled();
  });

  it("stays silent, and does not break the response, with no tenant context", async () => {
    // A control-plane route has no tenant room to notify. This must degrade
    // quietly rather than 500 the mutation that already committed.
    const res = await request(buildApp(false))
      .post("/api/sessions/start")
      .send({ customer_name: "Amir" })
      .expect(200);

    expect(res.body).toEqual({ success: true, sessionId: 3 });
    expect(emitEvent).not.toHaveBeenCalled();
  });

  it("does not break the response when the socket layer throws", async () => {
    emitEvent.mockImplementation(() => {
      throw new Error("socket server is down");
    });

    const res = await request(buildApp())
      .post("/api/sessions/start")
      .send({ customer_name: "Amir" })
      .expect(200);
    expect(res.body).toEqual({ success: true, sessionId: 3 });

    emitEvent.mockReset();
  });
});
