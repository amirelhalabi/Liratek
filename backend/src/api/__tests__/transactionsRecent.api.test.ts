/**
 * GET /api/transactions/recent REST route tests — transport-parity bug.
 *
 * THE BUG THIS FILE GUARDS: on desktop, `useTransactionRows.ts` builds a
 * filters object with `type`, `provider`, `service_type`, `has_item_key`,
 * `search` and `excludeTypes` and hands it whole to IPC
 * (`transactions:get-recent`), which forwards it unchanged to
 * `TransactionRepository.getRecent` — every field is honored.
 *
 * On web, `backendApi.ts`'s `getRecentTransactions` serializes the SAME
 * filters object into query-string params (`String(v)` per entry), but this
 * route used to read only `limit`, `type`, `status`, `user_id`, `client_id`,
 * `source_table`, `from`, `to` — `provider`, `service_type`, `has_item_key`,
 * `search` and `excludeTypes` were silently dropped on the floor before
 * reaching the service. Selecting the "Whish App Send" filter
 * (`type: FINANCIAL_SERVICE, provider: WHISH_APP, service_type: SEND,
 * has_item_key: false`) therefore fell back to matching on `type` alone on
 * web, surfacing every FINANCIAL_SERVICE row (Katsh, Whish App Recv, …) —
 * correct on desktop, wrong on web (CLAUDE.md rule 19c).
 *
 * Two sub-bugs the fix must get right, since query params are always
 * strings:
 *   - `has_item_key=false` must parse to the boolean `false`, not the
 *     JS-truthy `Boolean("false") === true` trap.
 *   - `excludeTypes` arrives as a single comma-joined string (`String(v)` on
 *     an array calls `Array.prototype.join(",")`) and must be split back
 *     into an array, not forwarded as one giant type name.
 *
 * Pattern mirrors partners.api.test.ts / suppliers.api.test.ts: the REAL
 * router (../transactions.js) with only ../../middleware/auth.js faked
 * (header-driven `x-test-role`); TransactionService is the REAL singleton
 * with `getRecent` stubbed via `jest.spyOn` so the test can assert on the
 * EXACT filters object the route builds, without needing a real DB.
 *
 * Rule 17 (CLAUDE.md): each `it` below was run against the pre-fix route
 * (the `filters: Record<string, unknown>` object populated with only the
 * original eight fields) and observed to FAIL — see the PR/task notes for
 * the exact failure output — before the fix was restored.
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
import { getTransactionService } from "@liratek/core";
import transactionsRouter from "../transactions.js";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/transactions", transactionsRouter);
  return app;
}

describe("GET /api/transactions/recent — filter forwarding parity", () => {
  let app: Express;
  const txnService = getTransactionService();

  beforeEach(() => {
    app = buildApp();
    jest.restoreAllMocks();
  });

  it("forwards provider and service_type through to the service, alongside type", async () => {
    const spy = jest.spyOn(txnService, "getRecent").mockReturnValue([]);

    const res = await request(app)
      .get("/api/transactions/recent")
      .query({
        limit: "50",
        type: "FINANCIAL_SERVICE",
        provider: "WHISH_APP",
        service_type: "SEND",
      })
      .set("x-test-role", "admin");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, transactions: [] });
    expect(spy).toHaveBeenCalledTimes(1);
    const [, filters] = spy.mock.calls[0] as [number, Record<string, unknown>];
    expect(filters.type).toBe("FINANCIAL_SERVICE");
    expect(filters.provider).toBe("WHISH_APP");
    expect(filters.service_type).toBe("SEND");
  });

  it("parses has_item_key=false to the boolean false, not a truthy string", async () => {
    const spy = jest.spyOn(txnService, "getRecent").mockReturnValue([]);

    const res = await request(app)
      .get("/api/transactions/recent")
      .query({
        type: "FINANCIAL_SERVICE",
        provider: "WHISH_APP",
        service_type: "SEND",
        has_item_key: "false",
      })
      .set("x-test-role", "admin");

    expect(res.status).toBe(200);
    const [, filters] = spy.mock.calls[0] as [number, Record<string, unknown>];
    expect(filters.has_item_key).toBe(false);
    expect(typeof filters.has_item_key).toBe("boolean");
  });

  it("parses has_item_key=true to the boolean true", async () => {
    const spy = jest.spyOn(txnService, "getRecent").mockReturnValue([]);

    await request(app)
      .get("/api/transactions/recent")
      .query({
        type: "FINANCIAL_SERVICE",
        provider: "WHISH_APP",
        has_item_key: "true",
      })
      .set("x-test-role", "admin");

    const [, filters] = spy.mock.calls[0] as [number, Record<string, unknown>];
    expect(filters.has_item_key).toBe(true);
  });

  it("leaves has_item_key unset when the client sends no such param", async () => {
    const spy = jest.spyOn(txnService, "getRecent").mockReturnValue([]);

    await request(app)
      .get("/api/transactions/recent")
      .query({ type: "SALE" })
      .set("x-test-role", "admin");

    const [, filters] = spy.mock.calls[0] as [number, Record<string, unknown>];
    expect(filters.has_item_key).toBeUndefined();
  });

  it("splits the comma-joined excludeTypes string back into an array", async () => {
    const spy = jest.spyOn(txnService, "getRecent").mockReturnValue([]);

    // Mirrors backendApi.ts: `String(["CLIENT_CREATED", "LOTO_CASH_PRIZE"])`
    // produces "CLIENT_CREATED,LOTO_CASH_PRIZE" via Array.prototype.join.
    await request(app)
      .get("/api/transactions/recent")
      .query({ excludeTypes: "CLIENT_CREATED,LOTO_CASH_PRIZE" })
      .set("x-test-role", "admin");

    const [, filters] = spy.mock.calls[0] as [number, Record<string, unknown>];
    expect(filters.excludeTypes).toEqual([
      "CLIENT_CREATED",
      "LOTO_CASH_PRIZE",
    ]);
  });

  it("forwards search unchanged", async () => {
    const spy = jest.spyOn(txnService, "getRecent").mockReturnValue([]);

    await request(app)
      .get("/api/transactions/recent")
      .query({ search: "some client" })
      .set("x-test-role", "admin");

    const [, filters] = spy.mock.calls[0] as [number, Record<string, unknown>];
    expect(filters.search).toBe("some client");
  });

  it("requires auth", async () => {
    const res = await request(app).get("/api/transactions/recent");
    expect(res.status).toBe(401);
  });

  // ---------------------------------------------------------------------
  // Multi-select Type filter (`typeFilters`) — the web adapter JSON-encodes
  // the array into one query param since `String(v)` on an array of
  // OBJECTS collapses to "[object Object]" (unlike excludeTypes' plain
  // strings, which survive a comma-join). This is the round-trip proof for
  // the encoding, plus the route's validate-before-trust guard (rule 23).
  // ---------------------------------------------------------------------

  it("decodes the JSON-encoded typeFilters param and forwards the tuple array untouched", async () => {
    const spy = jest.spyOn(txnService, "getRecent").mockReturnValue([]);
    const typeFilters = [
      {
        type: "FINANCIAL_SERVICE",
        provider: "WHISH_APP",
        service_type: "SEND",
        has_item_key: false,
      },
      { type: "FINANCIAL_SERVICE", provider: "Katsh", has_item_key: true },
    ];

    const res = await request(app)
      .get("/api/transactions/recent")
      .query({ typeFilters: JSON.stringify(typeFilters) })
      .set("x-test-role", "admin");

    expect(res.status).toBe(200);
    const [, filters] = spy.mock.calls[0] as [number, Record<string, unknown>];
    expect(filters.typeFilters).toEqual(typeFilters);
  });

  it("rejects malformed JSON in typeFilters with 400 instead of forwarding it", async () => {
    const spy = jest.spyOn(txnService, "getRecent").mockReturnValue([]);

    const res = await request(app)
      .get("/api/transactions/recent")
      .query({ typeFilters: "{not-json" })
      .set("x-test-role", "admin");

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects a typeFilters entry with an unknown transaction type with 400 instead of forwarding it", async () => {
    const spy = jest.spyOn(txnService, "getRecent").mockReturnValue([]);

    const res = await request(app)
      .get("/api/transactions/recent")
      .query({
        typeFilters: JSON.stringify([{ type: "NOT_A_REAL_TYPE" }]),
      })
      .set("x-test-role", "admin");

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("drops an empty typeFilters array instead of forwarding a no-op filter", async () => {
    const spy = jest.spyOn(txnService, "getRecent").mockReturnValue([]);

    await request(app)
      .get("/api/transactions/recent")
      .query({ typeFilters: JSON.stringify([]) })
      .set("x-test-role", "admin");

    const [, filters] = spy.mock.calls[0] as [number, Record<string, unknown>];
    expect(filters.typeFilters).toBeUndefined();
  });
});
