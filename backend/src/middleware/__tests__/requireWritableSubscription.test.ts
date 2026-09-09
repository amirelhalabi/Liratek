/**
 * requireWritableSubscription — the whole enforcement model, one middleware.
 *
 * Three properties, each of which is a real outage if it breaks:
 *
 *   1. READS ARE NEVER BLOCKED. A lapsed shop must still see its own
 *      `debt_ledger` — money its customers owe IT.
 *   2. LOGIN SURVIVES read_only. The allowlist is the entire difference
 *      between "read-only" and "locked out": refuse `POST /api/auth/login`
 *      and a lapsed shop cannot reach the data it is promised.
 *   3. IT FAILS OPEN. No tenant, no subscription row, or a thrown lookup all
 *      let the write through, because the failure that costs a customer money
 *      is worse than the one that costs a licence fee.
 *
 * The mount position is also asserted indirectly: the middleware resolves the
 * tenant from the BEARER TOKEN, not only from `req.user`, because it is
 * mounted app-wide before every router's own `authenticateJWT`. A version
 * reading only `req.user` would see undefined on every real request, fail open
 * every time, and enforce nothing — silently.
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

/** A tiny app that echoes success, so any refusal must come from the guard. */
function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(requireWritableSubscription);
  const ok = (_req: express.Request, res: express.Response) =>
    res.json({ success: true, reached: true });
  app.get("/api/anything", ok);
  app.post("/api/anything", ok);
  app.put("/api/anything", ok);
  app.patch("/api/anything", ok);
  app.delete("/api/anything", ok);
  app.post("/api/auth/login", ok);
  app.post("/api/auth/logout", ok);
  app.post("/api/auth/signup", ok);
  app.post("/api/subscription/anything", ok);
  app.post("/api/admin/subscriptions/7", ok);
  return app;
}

const TOKEN = "Bearer fake.jwt.token";

beforeEach(() => {
  canWrite.mockReset();
  verifyJwt.mockReset();
  // Default: an authenticated tenant whose subscription has lapsed.
  verifyJwt.mockReturnValue({ tenantId: 7, userId: 1, role: "admin" });
  canWrite.mockReturnValue(false);
});

describe("reads are never blocked", () => {
  it("a GET goes through even when the subscription is read_only", async () => {
    const res = await request(buildApp())
      .get("/api/anything")
      .set("Authorization", TOKEN)
      .expect(200);

    expect(res.body.reached).toBe(true);
    // Not even consulted — a read cannot be refused, so there is nothing to ask.
    expect(canWrite).not.toHaveBeenCalled();
  });
});

describe("writes are blocked when read_only", () => {
  it.each(["post", "put", "patch", "delete"] as const)(
    "%s is refused with 402 and the IPC envelope",
    async (method) => {
      // The agent is held in a local rather than chained: `request(app)`
      // followed by a bracket access on the next line parses as an index into
      // the call's result, which lints as an unexpected multiline.
      const agent = request(buildApp());
      const res = await agent[method]("/api/anything")
        .set("Authorization", TOKEN)
        .expect(402);

      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe("SUBSCRIPTION_READ_ONLY");
      // The message has to explain that reading still works, or a shop will
      // read it as "the app is broken".
      expect(res.body.error).toMatch(/read-only/i);
      expect(res.body.error).toMatch(/view and export/i);
    },
  );
});

describe("the always-writable allowlist", () => {
  it.each([
    "/api/auth/login",
    "/api/auth/logout",
    "/api/auth/signup",
    "/api/subscription/anything",
    "/api/admin/subscriptions/7",
  ])("%s stays writable in read_only", async (path) => {
    const res = await request(buildApp())
      .post(path)
      .set("Authorization", TOKEN)
      .expect(200);
    expect(res.body.reached).toBe(true);
  });

  it("LOGIN in particular — otherwise read-only IS a lockout", async () => {
    // The single most consequential entry in the list.
    await request(buildApp())
      .post("/api/auth/login")
      .set("Authorization", TOKEN)
      .expect(200);
  });

  it("the fix path stays open — a shop can always be restored", async () => {
    // Blocking /api/admin or /api/subscription would make read_only
    // permanent: the owner could not mark it paid and the shop could not
    // enter a licence key.
    await request(buildApp())
      .post("/api/admin/subscriptions/7")
      .set("Authorization", TOKEN)
      .expect(200);
  });

  it("a query string neither smuggles nor prevents a match", async () => {
    await request(buildApp())
      .post("/api/auth/login?next=/pos")
      .set("Authorization", TOKEN)
      .expect(200);
  });

  it("does NOT allowlist by mere prefix collision", async () => {
    // "/api/authorised-thing" must not inherit "/api/auth"'s exemption.
    const app = express();
    app.use(express.json());
    app.use(requireWritableSubscription);
    app.post("/api/authorised-thing", (_q, r) => r.json({ reached: true }));

    await request(app)
      .post("/api/authorised-thing")
      .set("Authorization", TOKEN)
      .expect(402);
  });
});

describe("fails OPEN", () => {
  it("no Authorization header at all -> the write goes through", async () => {
    const res = await request(buildApp()).post("/api/anything").expect(200);
    expect(res.body.reached).toBe(true);
    expect(canWrite).not.toHaveBeenCalled();
  });

  it("an unverifiable token -> the write goes through", async () => {
    verifyJwt.mockReturnValue(null);
    await request(buildApp())
      .post("/api/anything")
      .set("Authorization", TOKEN)
      .expect(200);
  });

  it("a PLATFORM token (tenantId null) -> the write goes through", async () => {
    // A super_admin has no subscription of its own to lapse.
    verifyJwt.mockReturnValue({
      tenantId: null,
      userId: 1,
      role: "super_admin",
    });
    await request(buildApp())
      .post("/api/anything")
      .set("Authorization", TOKEN)
      .expect(200);
    expect(canWrite).not.toHaveBeenCalled();
  });

  it("a THROWN subscription lookup -> the write goes through", async () => {
    // A database hiccup must not stop a shop trading.
    canWrite.mockImplementation(() => {
      throw new Error("db is gone");
    });
    const res = await request(buildApp())
      .post("/api/anything")
      .set("Authorization", TOKEN)
      .expect(200);
    expect(res.body.reached).toBe(true);
  });

  it("canWrite true -> the write goes through, obviously", async () => {
    canWrite.mockReturnValue(true);
    await request(buildApp())
      .post("/api/anything")
      .set("Authorization", TOKEN)
      .expect(200);
  });
});

describe("tenant resolution", () => {
  it("asks about the tenant in the TOKEN, not a body or header field", async () => {
    verifyJwt.mockReturnValue({ tenantId: 42, userId: 1, role: "admin" });
    canWrite.mockReturnValue(true);

    await request(buildApp())
      .post("/api/anything")
      .set("Authorization", TOKEN)
      .send({ tenantId: 999 })
      .expect(200);

    // A client-supplied tenantId must never be what gets checked.
    expect(canWrite).toHaveBeenCalledWith(42);
  });
});
