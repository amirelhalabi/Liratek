/**
 * LIRA-306 T110 — for every recordable channel (offline + checkpoint), the
 * desktop IPC handler and the core offline binding call the SAME core service
 * method(s) with EQUAL arguments for the same named payload. A drift between
 * the two (a field one forwards and the other drops, a different method, an
 * actor taken from the payload) fails here.
 *
 * How: every `handlers/*.ts` module registers against a fake `ipcMain`; every
 * prototype method of every `*Service` class `@liratek/core` exports is
 * spied and stubbed (so nothing is booked, and an inner call of one service
 * method to another is not recorded twice); the channel's fixture payload
 * (`offline/testHelpers/fixtures/*`, the T077 fixtures) is sent to the
 * handler as its positional IPC arguments (the inverse of `namedPayload`)
 * and to the binding as the recorded schema's parse — then the two recorded
 * call lists are compared. The handler's session user and the binding's
 * event actor are the same admin (user 1).
 *
 * The only write a handler does outside its service is the audit row
 * (`auditHelper.audit`) — the audit log is in MAP_EXCLUDED_TABLES, which the
 * last case asserts.
 *
 * Written AFTER the bindings it checks — not a failing-first guard for them;
 * it guards future drift. Channels with no binding yet are reported by T077
 * (`bindings.complete.test.ts`), not here.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const handlers = new Map<string, (...a: unknown[]) => unknown>();

jest.mock("electron", () => {
  const ipcMain = {
    handle: jest.fn((name: string, fn: (...a: unknown[]) => unknown) => {
      handlers.set(name, fn);
    }),
    on: jest.fn(),
    removeHandler: jest.fn(),
  };
  return {
    ipcMain,
    app: {
      getPath: jest.fn(() => "/tmp"),
      getVersion: jest.fn(() => "0.0.0"),
      isPackaged: false,
      on: jest.fn(),
      relaunch: jest.fn(),
      exit: jest.fn(),
    },
    BrowserWindow: {
      getAllWindows: jest.fn(() => []),
      fromWebContents: jest.fn(),
    },
    dialog: { showOpenDialog: jest.fn(), showSaveDialog: jest.fn() },
    shell: { openExternal: jest.fn() },
    net: { request: jest.fn() },
    safeStorage: { isEncryptionAvailable: jest.fn(() => false) },
  };
});
jest.mock("../../main.js", () => ({ getDb: jest.fn() }));
jest.mock("../../services/ReportService.js", () => ({
  ReportService: jest.fn(),
}));
jest.mock("../../session", () => ({
  requireRole: jest.fn(() => ({ ok: true, userId: 1, role: "admin" })),
  requireAdminRole: jest.fn(() => ({ ok: true, userId: 1, role: "admin" })),
  hasProfitsUnlock: jest.fn(() => true),
  getSession: jest.fn(() => ({ userId: 1, role: "admin", username: "admin" })),
}));
jest.mock("../../handlers/auditHelper", () => ({ audit: jest.fn() }));

import * as core from "@liratek/core";
import {
  CHANNEL_POLICY,
  MAP_EXCLUDED_TABLES,
  getOfflineBinding,
  initFixedTenantContext,
  recordedSchema,
  runWithTenant,
  type OfflineBinding,
} from "@liratek/core";
import { loadAllFixtures } from "../../../packages/core/src/offline/testHelpers/bindingFixtures";
// Agent B family bindings — imported directly until they are registered in
// the registry (bindings/index.ts); afterwards the registry returns the same
// objects and these imports are redundant, not wrong.
import { SALES_REST_BINDINGS } from "../../../packages/core/src/offline/bindings/salesRest";
import { SESSIONS_BINDINGS } from "../../../packages/core/src/offline/bindings/sessions";
import { FINANCIAL_BINDINGS } from "../../../packages/core/src/offline/bindings/financial";
import { RECHARGE_BINDINGS } from "../../../packages/core/src/offline/bindings/recharge";
import { DEBTS_REST_BINDINGS } from "../../../packages/core/src/offline/bindings/debtsRest";
import { EXPENSES_REST_BINDINGS } from "../../../packages/core/src/offline/bindings/expensesRest";

const EXTRA = new Map<string, OfflineBinding>(
  [
    SALES_REST_BINDINGS,
    SESSIONS_BINDINGS,
    FINANCIAL_BINDINGS,
    RECHARGE_BINDINGS,
    DEBTS_REST_BINDINGS,
    EXPENSES_REST_BINDINGS,
  ]
    .flat()
    .map((b) => [b.channel, b]),
);
const bindingFor = (ch: string): OfflineBinding | undefined =>
  getOfflineBinding(ch) ?? EXTRA.get(ch);

const HANDLERS_DIR = path.join(__dirname, "../../handlers");
const UNPARSEABLE = new Set(["setupHandlers.ts", "updaterHandlers.ts"]);
type G = typeof globalThis & { __LIRATEK_TEST_DB__?: Database.Database };

interface Call {
  method: string;
  args: unknown[];
}
let calls: Call[] = [];

/** Spy + stub every prototype method of every exported `*Service` class. */
function spyServices(): void {
  for (const [name, value] of Object.entries(core)) {
    if (
      typeof value !== "function" ||
      !/Service$/.test(name) ||
      !value.prototype
    )
      continue;
    const proto = value.prototype as Record<string, unknown>;
    for (const m of Object.getOwnPropertyNames(proto)) {
      if (m === "constructor") continue;
      const desc = Object.getOwnPropertyDescriptor(proto, m);
      if (!desc || typeof desc.value !== "function") continue;
      jest.spyOn(proto as never, m as never).mockImplementation(((
        ...args: unknown[]
      ) => {
        calls.push({
          method: `${name}.${m}`,
          args: JSON.parse(JSON.stringify(args)) as unknown[],
        });
        return {
          success: true,
          id: 1,
          sessionId: 1,
          entity: { id: 1 },
          data: { id: 1, claim: { id: 1, action: "repair" } },
          oldValues: {},
          itemCount: 0,
        };
      }) as never);
    }
  }
}

/** The handler's positional IPC arguments for a named payload (inverse of namedPayload). */
function positional(
  channel: string,
  payload: Record<string, unknown>,
): unknown[] {
  const e = CHANNEL_POLICY.find((p) => p.channel === channel)!;
  if (!e.argNames) return [payload];
  const args: unknown[] = e.argNames.map((n) => payload[n]);
  if (e.body === "spread") {
    const rest: Record<string, unknown> = { ...payload };
    for (const n of e.argNames) delete rest[n];
    args.push(rest);
  }
  return args;
}

let db: Database.Database;

beforeAll(() => {
  db = new Database(":memory:");
  db.exec(fs.readFileSync(path.join(__dirname, "../../create_db.sql"), "utf8"));
  (globalThis as G).__LIRATEK_TEST_DB__ = db;
  initFixedTenantContext(1);
  for (const f of fs
    .readdirSync(HANDLERS_DIR)
    .filter((x) => x.endsWith(".ts") && !UNPARSEABLE.has(x))
    .sort()) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(path.join(HANDLERS_DIR, f)) as Record<string, unknown>;
    for (const [n, fn] of Object.entries(mod))
      if (/^register\w*Handlers$/.test(n) && typeof fn === "function")
        (fn as () => unknown)();
  }
  spyServices();
});

afterAll(() => {
  delete (globalThis as G).__LIRATEK_TEST_DB__;
  db.close();
});

const fixtures = Object.values(loadAllFixtures()).flat();
const RECORDABLE = CHANNEL_POLICY.filter(
  (e) => e.cls === "offline" || e.cls === "checkpoint",
)
  .map((e) => e.channel)
  .sort();
const firstFixture = (ch: string) => fixtures.find((f) => f.channel === ch);
/**
 * Channels whose binding deliberately differs from the IPC handler — only the
 * booking method (the last service call) must match. Each entry names why.
 */
const INTENTIONAL: Record<string, string> = {
  "closing:create-checkpoint":
    "FR-032 / N8: Apply recomputes the expected amounts on the server at the event's time (ClosingService.getDrawerBalancesAsOf) instead of booking the PC's figures",
};

const CASES = RECORDABLE.filter((ch) => bindingFor(ch) && firstFixture(ch)).map(
  (ch) => [ch] as [string],
);

describe("IPC handler ↔ offline binding parity (T110)", () => {
  it("covers the bound channels (never vacuous)", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(36);
  });

  it.each(CASES)(
    "%s — same service call(s), equal arguments",
    async (channel) => {
      const payload = firstFixture(channel)!.payload;
      const handler = handlers.get(channel);
      expect(handler).toBeDefined();

      calls = [];
      await handler!({ sender: { id: 1 } }, ...positional(channel, payload));
      const viaIpc = calls;

      calls = [];
      const parsed = recordedSchema(channel)!.parse(payload) as Record<
        string,
        unknown
      >;
      await runWithTenant(1, () =>
        bindingFor(channel)!.run(parsed, {
          tenantId: 1,
          actorUserId: 1,
          eventId: "parity",
          deviceId: 1,
        }),
      );
      const viaBinding = calls;

      expect(viaBinding.length).toBeGreaterThan(0);
      if (INTENTIONAL[channel]) {
        expect(viaBinding[viaBinding.length - 1].method).toBe(
          viaIpc[viaIpc.length - 1]?.method,
        );
        return;
      }
      expect(viaBinding).toEqual(viaIpc);
    },
  );

  it("control: the comparison sees a drift (a different actor changes the recorded call)", async () => {
    const payload = firstFixture("sales:update-metadata")!.payload;
    calls = [];
    await handlers.get("sales:update-metadata")!(
      { sender: { id: 1 } },
      payload,
    );
    const viaIpc = calls;
    calls = [];
    const parsed = recordedSchema("sales:update-metadata")!.parse(
      payload,
    ) as Record<string, unknown>;
    db.exec(
      `INSERT OR IGNORE INTO users (id, tenant_id, username, password_hash, role, is_active) VALUES (2, 1, 'cashier', '', 'staff', 1)`,
    );
    await runWithTenant(1, () =>
      bindingFor("sales:update-metadata")!.run(parsed, {
        tenantId: 1,
        actorUserId: 2,
        eventId: "control",
        deviceId: 1,
      }),
    );
    expect(calls).not.toEqual(viaIpc);
    expect(calls[0].method).toBe(viaIpc[0].method);
  });

  it("the handler-side audit row lands in a table the replay never maps", () => {
    expect(MAP_EXCLUDED_TABLES).toContain("audit_log");
  });
});
