/**
 * LIRA-306 T081 — PINS TODAY'S BEHAVIOUR of `session:cart:add`,
 * `session:cart:remove` and `session:cart:clear` over IPC (written before the
 * handlers' direct `CustomerSessionRepository` calls moved behind
 * `CustomerSessionService`, rule 13). Not a failing-first guard: it must pass
 * before AND after the move — same envelopes, same rows, same refusal text.
 * Its REST twin is backend/src/api/__tests__/sessionsCart.pin.api.test.ts.
 *
 * Real schema in memory; `@liratek/core` is the TS source; only Electron,
 * the session gate and the audit helper are stubbed.
 */
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { ipcMain } from "electron";
import { initFixedTenantContext, resetTenantContext } from "@liratek/core";
import { registerSessionHandlers } from "../sessionHandlers";
import { requireRole } from "../../session";

jest.mock("electron", () => ({ ipcMain: { handle: jest.fn(), on: jest.fn(), removeHandler: jest.fn() } }));
jest.mock("../../session", () => ({ requireRole: jest.fn() }));
jest.mock("../auditHelper", () => ({ audit: jest.fn() }));

const SCHEMA = fs.readFileSync(path.join(__dirname, "../../create_db.sql"), "utf8");
type G = typeof globalThis & { __LIRATEK_TEST_DB__?: Database.Database };

let db: Database.Database;
let handlers: Map<string, (...a: unknown[]) => Promise<unknown>>;

const LINE = {
  item_id: "line-1",
  module: "custom_service",
  label: "Screen protector",
  amount: 20,
  currency: "USD",
  form_data: JSON.stringify({ description: "Screen protector", price_usd: 20, cost_usd: 5 }),
  ipc_channel: "custom-services:add",
};

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(SCHEMA);
  db.exec(`INSERT INTO customer_sessions (id, tenant_id, customer_name, started_by) VALUES (1, 1, 'Walk-in', 'admin')`);
  (globalThis as G).__LIRATEK_TEST_DB__ = db;
  initFixedTenantContext(1);
  handlers = new Map();
  (ipcMain.handle as jest.Mock).mockImplementation((ch: string, h: (...a: unknown[]) => Promise<unknown>) => handlers.set(ch, h));
  (requireRole as jest.Mock).mockReturnValue({ ok: true, userId: 1 });
  registerSessionHandlers();
});

afterEach(() => {
  resetTenantContext();
  delete (globalThis as G).__LIRATEK_TEST_DB__;
  db.close();
});

const call = (ch: string, ...args: unknown[]) => handlers.get(ch)!({ sender: { id: 1 } }, ...args);
const lines = () => db.prepare(`SELECT session_id, item_id, module, amount, currency, user_id FROM session_cart_items ORDER BY id`).all();

describe("session cart over IPC — today's results (pin)", () => {
  it("add → { success: true, id }; remove → { success: true }; clear → { success: true }", async () => {
    expect(await call("session:cart:add", 1, LINE)).toEqual({ success: true, id: 1 });
    expect(await call("session:cart:add", 1, { ...LINE, item_id: "line-2" })).toEqual({ success: true, id: 2 });
    expect(lines()).toEqual([
      { session_id: 1, item_id: "line-1", module: "custom_service", amount: 20, currency: "USD", user_id: 1 },
      { session_id: 1, item_id: "line-2", module: "custom_service", amount: 20, currency: "USD", user_id: 1 },
    ]);
    expect(await call("session:cart:remove", 1, "line-1")).toEqual({ success: true });
    expect(lines()).toHaveLength(1);
    expect(await call("session:cart:clear", 1)).toEqual({ success: true });
    expect(lines()).toEqual([]);
  });

  it("a custom-service line with no selling price is refused with the repository's message", async () => {
    const res = (await call("session:cart:add", 1, { ...LINE, form_data: JSON.stringify({ description: "x" }) })) as { success: boolean; error: string };
    expect(res.success).toBe(false);
    expect(res.error.length).toBeGreaterThan(0);
    expect(lines()).toEqual([]);
  });

  it("removing a line that does not exist still answers { success: true }", async () => {
    expect(await call("session:cart:remove", 1, "nope")).toEqual({ success: true });
  });
});
