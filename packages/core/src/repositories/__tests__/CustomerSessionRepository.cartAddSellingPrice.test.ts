/**
 * Owner rule (2026-10-07): "we should not be able to add to cart the service
 * if we have no total amount in the payment form [set by the selling price].
 * If no selling price exists, we cannot pay anything."
 *
 * The Custom Services page already refuses to put a no-price line in a
 * customer-session basket, but the server accepted one: both transports
 * (`session:cart:add` IPC and `POST /api/sessions/:id/cart`) call
 * `CustomerSessionRepository.addCartItem` straight through, and that wrote
 * any custom-service line, priced or not. This guards the ONE shared writer,
 * so both transports refuse together.
 *
 * What counts as a custom-service line is its `ipc_channel` — the channel the
 * checkout replays — not its `module` label, which the caller picks freely.
 * Other modules' lines (OMT/Whish/recharge…, including For-Partner OMT lines
 * that carry amount 0 by design) are untouched.
 */
import Database from "better-sqlite3";
import { runWithTenant } from "../../db/tenantContext.js";
import {
  CustomerSessionRepository,
  resetCustomerSessionRepository,
} from "../CustomerSessionRepository.js";

let db: Database.Database;
let repo: CustomerSessionRepository;
let sessionId: number;

beforeEach(() => {
  db = new Database(":memory:");
  resetCustomerSessionRepository();
  db.exec(`
    CREATE TABLE customer_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      customer_name TEXT,
      started_by TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE session_cart_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      session_id INTEGER NOT NULL,
      item_id TEXT NOT NULL,
      module TEXT NOT NULL,
      label TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      form_data TEXT NOT NULL DEFAULT '{}',
      ipc_channel TEXT NOT NULL,
      user_id INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  sessionId = Number(
    db
      .prepare(
        `INSERT INTO customer_sessions (tenant_id, customer_name, started_by) VALUES (1, 'Walk-in', 'admin')`,
      )
      .run().lastInsertRowid,
  );
  repo = new CustomerSessionRepository(db);
});

afterEach(() => {
  db.close();
});

function add(item: {
  module?: string;
  ipc_channel: string;
  amount?: number;
  currency?: string;
  formData: unknown;
  rawFormData?: string;
}) {
  return runWithTenant(1, () =>
    repo.addCartItem(sessionId, {
      item_id: `item-${Math.random()}`,
      module: item.module ?? "custom_service",
      label: "line",
      amount: item.amount ?? 0,
      currency: item.currency ?? "USD",
      form_data: item.rawFormData ?? JSON.stringify(item.formData),
      ipc_channel: item.ipc_channel,
      user_id: 1,
    }),
  );
}

function cartCount(): number {
  return (
    db.prepare(`SELECT COUNT(*) AS n FROM session_cart_items`).get() as {
      n: number;
    }
  ).n;
}

describe("custom-service line with no selling price is refused at cart-add", () => {
  it("walk-in, cost only, no price → refused, nothing saved", () => {
    expect(() =>
      add({
        ipc_channel: "custom-services:add",
        formData: { description: "Repair", cost_usd: 3, price_usd: 0 },
      }),
    ).toThrow("Enter a selling price first.");
    expect(cartCount()).toBe(0);
  });

  it("For-Partner, cost only, no price → refused, nothing saved", () => {
    expect(() =>
      add({
        ipc_channel: "custom-services:add",
        formData: {
          description: "Partner job",
          cost_usd: 30,
          partnerMode: "FOR",
          partnerId: 7,
        },
      }),
    ).toThrow("Enter a selling price first.");
    expect(cartCount()).toBe(0);
  });

  it("legacy channel spelling (customService:create) → refused too", () => {
    expect(() =>
      add({
        ipc_channel: "customService:create",
        formData: { description: "Repair", cost_lbp: 100000 },
      }),
    ).toThrow("Enter a selling price first.");
  });

  it("module label that is not custom_service but the custom-service channel → refused (channel decides)", () => {
    expect(() =>
      add({
        module: "omt",
        ipc_channel: "custom-services:add",
        formData: { description: "Repair", cost_usd: 3 },
      }),
    ).toThrow("Enter a selling price first.");
  });

  it("a batch with a no-price custom-service sub-item → refused", () => {
    expect(() =>
      add({
        ipc_channel: "custom-services:add",
        formData: {
          _batch: true,
          items: [
            { description: "A", price_usd: 5 },
            { description: "B", cost_usd: 3 },
          ],
        },
      }),
    ).toThrow("Enter a selling price first.");
  });

  it("unreadable form_data on a custom-service line → refused", () => {
    expect(() =>
      add({
        ipc_channel: "custom-services:add",
        formData: null,
        rawFormData: "{not json",
      }),
    ).toThrow("Enter a selling price first.");
  });
});

describe("custom-service line WITH a selling price is accepted", () => {
  it("USD price → saved", () => {
    add({
      ipc_channel: "custom-services:add",
      amount: 5,
      formData: { description: "Repair", price_usd: 5, cost_usd: 3 },
    });
    expect(cartCount()).toBe(1);
  });

  it("LBP price only (cart amount may be 0 in USD) → saved", () => {
    add({
      ipc_channel: "custom-services:add",
      amount: 450000,
      currency: "LBP",
      formData: { description: "Repair", price_lbp: 450000 },
    });
    expect(cartCount()).toBe(1);
  });

  it("For-Partner with a price → saved", () => {
    add({
      ipc_channel: "custom-services:add",
      formData: {
        description: "Partner job",
        price_usd: 50,
        cost_usd: 30,
        partnerMode: "FOR",
        partnerId: 7,
      },
    });
    expect(cartCount()).toBe(1);
  });
});

describe("other modules' cart lines are untouched", () => {
  it("For-Partner OMT line with amount 0 and no price fields → saved", () => {
    add({
      module: "omt",
      ipc_channel: "omt:add-transaction",
      amount: 0,
      formData: {
        provider: "OMT",
        serviceType: "SEND",
        amount: 100,
        partnerMode: "FOR",
      },
    });
    expect(cartCount()).toBe(1);
  });

  it("recharge line with no price_usd/price_lbp keys → saved", () => {
    add({
      module: "recharge",
      ipc_channel: "recharge:process",
      amount: 10,
      formData: { provider: "MTC", amount: 10 },
    });
    expect(cartCount()).toBe(1);
  });
});
