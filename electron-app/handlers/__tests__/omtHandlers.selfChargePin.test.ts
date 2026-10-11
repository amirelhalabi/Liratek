/**
 * LIRA-306 T083 — PINS TODAY'S BEHAVIOUR of `financial:self-charge-telecom-item`
 * (written before moving the handler's direct repository call behind
 * `FinancialService.selfChargeTelecomItem`, rule 13). Not a failing-first
 * guard: it must pass before AND after the move, proving the move changed
 * nothing the renderer sees — the envelope, the booked money and the error
 * text on a refusal.
 *
 * Real schema (create_db.sql) in memory; `@liratek/core` is the TS source
 * (jest moduleNameMapper); only Electron, the session gate and the audit
 * helper are stubbed.
 */
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { ipcMain } from "electron";
import { initFixedTenantContext, resetTenantContext } from "@liratek/core";
import { registerOMTHandlers } from "../omtHandlers";
import { requireRole } from "../../session";

jest.mock("electron", () => ({ ipcMain: { handle: jest.fn() } }));
jest.mock("../../session", () => ({ requireRole: jest.fn() }));
jest.mock("../auditHelper", () => ({ audit: jest.fn() }));

const SCHEMA = fs.readFileSync(path.join(__dirname, "../../create_db.sql"), "utf8");
type G = typeof globalThis & { __LIRATEK_TEST_DB__?: Database.Database };

let db: Database.Database;
let handlers: Map<string, (...a: unknown[]) => unknown>;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(SCHEMA);
  db.exec(`
    INSERT OR REPLACE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES
      (1, 'MTC', 'USD', 500), (1, 'iPick', 'LBP', 50000000);
    INSERT INTO carrier_lines (id, tenant_id, carrier, phone_number, label, credits, validity_expires_at, is_active, is_primary)
      VALUES (1, 1, 'mtc', '03123456', 'Shop MTC', 500, '2099-01-01', 1, 1);
    INSERT INTO mobile_service_items (id, tenant_id, provider, category, subcategory, label, cost_lbp, sell_lbp, credits, validity_days)
      VALUES (11, 1, 'iPick', 'mtc', 'Prepaid', 'MTC $4.5 card', 400000, 450000, 4.5, 30);
  `);
  (globalThis as G).__LIRATEK_TEST_DB__ = db;
  initFixedTenantContext(1);
  handlers = new Map();
  (ipcMain.handle as jest.Mock).mockImplementation((ch: string, h: (...a: unknown[]) => unknown) => handlers.set(ch, h));
  (requireRole as jest.Mock).mockReturnValue({ ok: true, userId: 1 });
  registerOMTHandlers();
});

afterEach(() => {
  resetTenantContext();
  delete (globalThis as G).__LIRATEK_TEST_DB__;
  db.close();
});

const call = (data: unknown) => handlers.get("financial:self-charge-telecom-item")!({ sender: { id: 1 } }, data);

describe("financial:self-charge-telecom-item — today's result (pin)", () => {
  it("returns { success: true, data } and books the item's cost and credits", () => {
    const result = call({ mobileServiceItemId: 11 }) as { success: boolean; data: Record<string, unknown> };
    expect(result).toEqual({
      success: true,
      data: { transactionId: expect.any(Number), carrierLineId: 1, costLbp: 400000, creditsAdded: 4.5, validityDaysAdded: 30 },
    });
    const drawers = db
      .prepare(`SELECT drawer_name, currency_code, balance FROM drawer_balances WHERE drawer_name IN ('MTC','iPick') AND balance != 0 ORDER BY drawer_name`)
      .all();
    expect(drawers).toEqual([
      { drawer_name: "MTC", currency_code: "USD", balance: 504.5 },
      { drawer_name: "iPick", currency_code: "LBP", balance: 49600000 },
    ]);
    expect((db.prepare(`SELECT credits FROM carrier_lines WHERE id = 1`).get() as { credits: number }).credits).toBe(504.5);
  });

  it("an unknown item is refused with { success: false, error } and books nothing", () => {
    const result = call({ mobileServiceItemId: 999 }) as { success: boolean; error: string };
    expect(result.success).toBe(false);
    expect(typeof result.error).toBe("string");
    expect(result.error.length).toBeGreaterThan(0);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM transactions`).get() as { n: number }).n).toBe(0);
  });
});
