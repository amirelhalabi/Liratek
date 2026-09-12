/**
 * requireWritableSubscription — the whole enforcement model, one middleware.
 *
 * Four properties, each of which is a real outage if it breaks:
 *
 *   1. TRADING IS NEVER BLOCKED. This is the property the middleware used to
 *      get backwards: under the old ALLOWLIST shape, `/api/sales` was never
 *      listed, so a lapsed tenant could not ring up a sale at all. The
 *      DENYLIST shape (`SUBSCRIPTION_GATED_PREFIXES`) makes that the default
 *      outcome for any route NOT explicitly named as administrative — so a
 *      sell-path route is proven writable here precisely because it is
 *      absent from the list, not because it is present on one.
 *   2. ADMINISTRATIVE ROUTES ARE GATED. The handful of prefixes that ARE
 *      unambiguous back-office administration (settings, users, modules,
 *      currencies, catalogue admin, database reset) still come back 402.
 *   3. READS ARE NEVER BLOCKED. A lapsed shop must still see its own
 *      `debt_ledger` — money its customers owe IT.
 *   4. IT FAILS OPEN. No tenant, no subscription row, or a thrown lookup all
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
  // "/api/anything" is a stand-in for the vast majority of routes: NOT on
  // the gated list, so it must stay writable purely by being absent from
  // SUBSCRIPTION_GATED_PREFIXES -- the whole point of the denylist rewrite.
  app.get("/api/anything", ok);
  app.post("/api/anything", ok);
  app.put("/api/anything", ok);
  app.patch("/api/anything", ok);
  app.delete("/api/anything", ok);
  // Real sell-path routes -- also not gated, but named explicitly so a
  // regression here reads as "a sale was blocked", not "some route was
  // blocked", if this test ever fails.
  app.post("/api/sales", ok);
  app.post("/api/sessions/close", ok);
  app.post("/api/drawer-topup", ok);
  app.post("/api/auth/login", ok);
  app.post("/api/auth/logout", ok);
  app.post("/api/auth/signup", ok);
  app.post("/api/subscription/anything", ok);
  app.post("/api/admin/subscriptions/7", ok);
  // Real administrative routes -- ON the gated list, so these must be
  // refused with 402 once the subscription is read_only.
  app.post("/api/settings/anything", ok);
  app.put("/api/settings/shop_name", ok);
  app.post("/api/users", ok);
  app.patch("/api/modules/loto/enabled", ok);
  app.post("/api/currencies", ok);
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

describe("administrative writes are blocked when read_only", () => {
  it.each(["post", "put", "patch", "delete"] as const)(
    "%s to an administrative route is refused with 402 and the IPC envelope",
    async (method) => {
      // The agent is held in a local rather than chained: `request(app)`
      // followed by a bracket access on the next line parses as an index into
      // the call's result, which lints as an unexpected multiline.
      const app = express();
      app.use(express.json());
      app.use(requireWritableSubscription);
      const ok = (_q: express.Request, r: express.Response) =>
        r.json({ success: true, reached: true });
      app[method]("/api/settings/anything", ok);

      const agent = request(app);
      const res = await agent[method]("/api/settings/anything")
        .set("Authorization", TOKEN)
        .expect(402);

      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe("SUBSCRIPTION_READ_ONLY");
      // The message must not claim the whole app is read-only (it isn't —
      // trading still works), and it must say administrative changes
      // specifically are what's unavailable, or a shop will read it as
      // "the app is broken" rather than "go pay the invoice".
      expect(res.body.error).not.toMatch(/app is read-only/i);
      expect(res.body.error).toMatch(/administrative/i);
      expect(res.body.error).toMatch(/trading/i);
    },
  );

  it.each([
    "/api/settings/shop_name",
    "/api/users",
    "/api/modules/loto/enabled",
    "/api/currencies",
    "/api/service-providers",
    "/api/service-presets",
    "/api/mobile-service-items",
    "/api/database/reset",
    "/api/reports/backup",
  ])("%s is refused with 402 in read_only", async (path) => {
    const app = express();
    app.use(express.json());
    app.use(requireWritableSubscription);
    app.post(path, (_q, r) => r.json({ reached: true }));

    await request(app).post(path).set("Authorization", TOKEN).expect(402);
  });
});

describe("the sell path always stays writable — this is the fix", () => {
  // These are exactly the routes the pre-fix ALLOWLIST left un-sellable:
  // none of them appear on SUBSCRIPTION_GATED_PREFIXES, so they must go
  // through purely by being absent from the gated list.
  it.each([
    "/api/sales",
    "/api/sessions/close",
    "/api/drawer-topup",
    "/api/recharge",
    "/api/debts",
    "/api/closing",
  ])(
    "POST %s succeeds even when the subscription is read_only",
    async (path) => {
      const app = express();
      app.use(express.json());
      app.use(requireWritableSubscription);
      app.post(path, (_q, r) => r.json({ success: true, reached: true }));

      const res = await request(app)
        .post(path)
        .set("Authorization", TOKEN)
        .expect(200);
      expect(res.body.reached).toBe(true);
    },
  );

  it("a POST /api/sales is NOT the 402 the pre-fix allowlist produced", async () => {
    // Regression guard for the exact production incident (DESKTOP_LICENSING_
    // PLAN.md §1): a lapsed tenant could not ring up a sale at all.
    const res = await request(buildApp())
      .post("/api/sales")
      .set("Authorization", TOKEN)
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(canWrite).not.toHaveBeenCalled();
  });
});

describe("the always-writable auth/subscription/admin routes", () => {
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

  it("LOGIN in particular — a lapsed shop must still be able to sign in", async () => {
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
});

describe("query-string smuggling", () => {
  it("a query string cannot smuggle a match onto a non-gated route", async () => {
    await request(buildApp())
      .post("/api/sales?settings=1")
      .set("Authorization", TOKEN)
      .expect(200);
  });

  it("a query string cannot dodge a match on a gated route", async () => {
    await request(buildApp())
      .post("/api/settings/anything?foo=bar")
      .set("Authorization", TOKEN)
      .expect(402);
  });

  it("a query string on an always-writable route still passes", async () => {
    await request(buildApp())
      .post("/api/auth/login?next=/pos")
      .set("Authorization", TOKEN)
      .expect(200);
  });

  it("does NOT gate by mere prefix collision", async () => {
    // "/api/settingsy" must not inherit "/api/settings"'s gate, and
    // "/api/usersomething" must not inherit "/api/users"'s.
    const app = express();
    app.use(express.json());
    app.use(requireWritableSubscription);
    app.post("/api/settingsy", (_q, r) => r.json({ reached: true }));

    await request(app)
      .post("/api/settingsy")
      .set("Authorization", TOKEN)
      .expect(200);
  });
});

describe("fails OPEN", () => {
  // Every case here targets "/api/settings/anything" (a GATED route)
  // deliberately, not "/api/anything" -- on a non-gated route the middleware
  // returns next() before ever calling resolveTenantId/canWrite, which would
  // make these assertions pass without exercising the fail-open branches at
  // all (see the "non-gated routes never even ask" test below for that
  // short-circuit, tested on its own terms).

  it("no Authorization header at all -> the write goes through", async () => {
    const res = await request(buildApp())
      .post("/api/settings/anything")
      .expect(200);
    expect(res.body.reached).toBe(true);
    expect(canWrite).not.toHaveBeenCalled();
  });

  it("an unverifiable token -> the write goes through", async () => {
    verifyJwt.mockReturnValue(null);
    await request(buildApp())
      .post("/api/settings/anything")
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
      .post("/api/settings/anything")
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
      .post("/api/settings/anything")
      .set("Authorization", TOKEN)
      .expect(200);
    expect(res.body.reached).toBe(true);
  });

  it("canWrite true -> the write goes through, obviously", async () => {
    canWrite.mockReturnValue(true);
    await request(buildApp())
      .post("/api/settings/anything")
      .set("Authorization", TOKEN)
      .expect(200);
  });

  it("non-gated routes never even ask canWrite -- true fail-open by construction", async () => {
    // The defining property of the denylist rewrite: a route absent from
    // SUBSCRIPTION_GATED_PREFIXES doesn't merely happen to pass the
    // subscription check, it never reaches it.
    canWrite.mockReturnValue(false);
    const res = await request(buildApp())
      .post("/api/anything")
      .set("Authorization", TOKEN)
      .expect(200);
    expect(res.body.reached).toBe(true);
    expect(canWrite).not.toHaveBeenCalled();
  });
});

describe("tenant resolution", () => {
  it("asks about the tenant in the TOKEN, not a body or header field", async () => {
    verifyJwt.mockReturnValue({ tenantId: 42, userId: 1, role: "admin" });
    canWrite.mockReturnValue(true);

    await request(buildApp())
      .post("/api/settings/anything")
      .set("Authorization", TOKEN)
      .send({ tenantId: 999 })
      .expect(200);

    // A client-supplied tenantId must never be what gets checked.
    expect(canWrite).toHaveBeenCalledWith(42);
  });
});
