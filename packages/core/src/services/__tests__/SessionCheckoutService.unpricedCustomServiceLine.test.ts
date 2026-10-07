/**
 * Owner rule (2026-10-07): a custom service with no selling price cannot be
 * paid for, so it cannot go through a session basket.
 *
 * Checkout replays the cart items the CLIENT sends, not the rows saved in
 * `session_cart_items` — so refusing only at cart-add would leave a
 * hand-built checkout able to book a no-price custom service anyway.
 *
 * Owner decision (same day): baskets opened BEFORE this update that already
 * hold such a line are left as they are and must still check out. So the
 * checkout refusal is limited to NEW lines: a no-price custom-service line is
 * accepted only when the same line (same `item_id`) is already saved in this
 * session's `session_cart_items` AND that saved row itself has no price —
 * i.e. it was saved before cart-add started refusing. A line that was never
 * saved, or that borrows the id of a saved priced line, is refused before
 * anything is written.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { initDatabase } from "../../db/connection";
import { runMigrations } from "../../db/migrations/index";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { SessionCheckoutService } from "../SessionCheckoutService";
import { resetSessionPaymentService } from "../SessionPaymentService";
import { resetDebtService } from "../DebtService";
import { resetDebtRepository } from "../../repositories/DebtRepository";
import { resetCustomerSessionRepository } from "../../repositories/CustomerSessionRepository";
import { resetSessionPaymentRepository } from "../../repositories/SessionPaymentRepository";
import { resetClientRepository } from "../../repositories/ClientRepository";
import { resetTransactionRepository } from "../../repositories/TransactionRepository";
import { resetPartnerRepository } from "../../repositories/PartnerRepository";
import { resetCustomServiceRepository } from "../../repositories/CustomServiceRepository";
import { resetSettingsRepository } from "../../repositories/SettingsRepository";

const REPO_ROOT = path.join(__dirname, "../../../../..");
const CREATE_DB_SQL_PATH = path.join(REPO_ROOT, "electron-app/create_db.sql");

function buildDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(fs.readFileSync(CREATE_DB_SQL_PATH, "utf-8"));
  initDatabase(db);
  runMigrations(db);
  return db;
}

function resetAll(): void {
  resetSessionPaymentService();
  resetDebtService();
  resetDebtRepository();
  resetCustomerSessionRepository();
  resetSessionPaymentRepository();
  resetClientRepository();
  resetTransactionRepository();
  resetPartnerRepository();
  resetCustomServiceRepository();
  resetSettingsRepository();
}

let db: Database.Database;

beforeEach(() => {
  resetAll();
  db = buildDb();
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  initFixedTenantContext(1);
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  resetTenantContext();
  resetAll();
  db.close();
});

function newSession(): number {
  return Number(
    db
      .prepare(
        `INSERT INTO customer_sessions (tenant_id, customer_name, started_by) VALUES (1, 'Walk-in', 'admin')`,
      )
      .run().lastInsertRowid,
  );
}

/** Save a line straight into session_cart_items — the way a basket opened
 *  before this update holds it (cart-add did not refuse back then). */
function saveLegacyLine(
  sessionId: number,
  itemId: string,
  formData: Record<string, unknown>,
): void {
  db.prepare(
    `INSERT INTO session_cart_items (tenant_id, session_id, item_id, module, label, amount, currency, form_data, ipc_channel)
     VALUES (1, ?, ?, 'custom_service', 'old line', 0, 'USD', ?, 'custom-services:add')`,
  ).run(sessionId, itemId, JSON.stringify(formData));
}

function unpricedLine(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    module: "custom_service",
    label: "Repair",
    amount: 0,
    currency: "USD",
    ipcChannel: "custom-services:add",
    formData: { description: "Repair", cost_usd: 3, ...extra },
  };
}

function checkout(
  sessionId: number,
  cartItems: Array<ReturnType<typeof unpricedLine>>,
) {
  return new SessionCheckoutService().checkout(
    { sessionId, cartItems, payments: [], exchangeRate: 90000, userId: 1 },
    { username: "admin" },
  );
}

function rowCount(table: string): number {
  return (
    db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }
  ).n;
}

describe("checkout refuses a NEW no-price custom-service line", () => {
  it("never saved to the basket (walk-in) → refused, nothing written", async () => {
    const sessionId = newSession();
    const before = {
      cs: rowCount("custom_services"),
      tx: rowCount("transactions"),
    };
    const result = await checkout(sessionId, [unpricedLine("crafted")]);
    expect(result.success).toBe(false);
    expect(result.error).toBe("Enter a selling price first.");
    expect(rowCount("custom_services")).toBe(before.cs);
    expect(rowCount("transactions")).toBe(before.tx);
  });

  it("never saved (For-Partner) → refused, nothing written", async () => {
    const sessionId = newSession();
    const partnerId = Number(
      db
        .prepare(`INSERT INTO partners (tenant_id, name) VALUES (1, 'P')`)
        .run().lastInsertRowid,
    );
    const before = rowCount("custom_services");
    const result = await checkout(sessionId, [
      unpricedLine("crafted-for", { partnerMode: "FOR", partnerId }),
    ]);
    expect(result.success).toBe(false);
    expect(result.error).toBe("Enter a selling price first.");
    expect(rowCount("custom_services")).toBe(before);
  });

  it("borrows the id of a saved PRICED line → refused", async () => {
    const sessionId = newSession();
    saveLegacyLine(sessionId, "priced", {
      description: "Repair",
      price_usd: 5,
    });
    const result = await checkout(sessionId, [unpricedLine("priced")]);
    expect(result.success).toBe(false);
    expect(result.error).toBe("Enter a selling price first.");
  });
});

describe("a basket opened before this update is left as it is", () => {
  it("saved no-price line still checks out", async () => {
    const sessionId = newSession();
    saveLegacyLine(sessionId, "old-line", {
      description: "Repair",
      cost_usd: 3,
    });
    const before = rowCount("custom_services");
    const result = await checkout(sessionId, [unpricedLine("old-line")]);
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(rowCount("custom_services")).toBe(before + 1);
  });
});
