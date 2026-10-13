/**
 * LIRA-319 US4 (T043) + US5 (T053, Recharge part) — an MTC/Alfa sale with an
 * extra charge.
 *
 * The cashier switches the payment sheet's Discount line to "+ Extra" and
 * adds a small amount on top of the sale. Contract (research R2/R4):
 *   - the customer owes and pays `price + extra` (legs, drawer, account debt);
 *   - the RECHARGE row's amount includes the extra, its profit does not
 *     (the commission is unchanged), and the extra sits on its own column;
 *   - `recharges.price` stays the sale price;
 *   - the extra is in the sale's currency, never with a discount, never on a
 *     credit buy-back (a payout), a for-partner sale or a session-basket item,
 *     and never above the sale itself — each refused with nothing written;
 *   - a void / refund nets every ledger back to 0.
 *
 * Fixtures are the schema's own input, parsed through `createRechargeSchema`
 * (rule 24) — a key the schema does not declare is stripped, so a missing
 * schema key fails here as a short charge. Refusals only the repository can
 * see (session item, and a caller that skips the schema) call
 * `processRecharge` directly. Real schema (create_db.sql); nothing is mocked.
 * ALFA_GIFT keeps the SMS-fee expense out of the deltas.
 */
import * as fs from "fs";
import * as path from "path";
import Database from "better-sqlite3";
import type { z } from "zod";
import { RechargeRepository } from "../RechargeRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import { resetDebtRepository } from "../DebtRepository";
import { resetDebtService } from "../../services/DebtService";
import { resetCarrierLineRepository } from "../CarrierLineRepository";
import { resetCarrierLineMovementRepository } from "../CarrierLineMovementRepository";
import { resetCarrierLineService } from "../../services/CarrierLineService";
import { resetPartnerRepository } from "../PartnerRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import {
  createRechargeSchema,
  NO_EXTRA_ON_BUYBACK_MESSAGE,
  RECHARGE_EXTRA_CURRENCY_MESSAGE,
} from "../../validators/recharge";
import {
  DISCOUNT_AND_EXTRA_MESSAGE,
  EXTRA_ABOVE_TOTAL_MESSAGE,
  EXTRA_ON_SESSION_ITEM_MESSAGE,
  NO_EXTRA_FOR_PARTNER_MESSAGE,
} from "../../validators/common";
import {
  snapshotLedgers,
  ledgerDeltas,
  expectPostings,
} from "../testHelpers/postingAssert";

type RechargePayload = z.input<typeof createRechargeSchema>;
type ProcessInput = Parameters<RechargeRepository["processRecharge"]>[0];

const SCHEMA = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "..", "..", "electron-app", "create_db.sql"),
  "utf-8",
);
const CLIENT_ID = 7;
const PARTNER_ID = 3;

type G = { __LIRATEK_TEST_DB__?: Database.Database };
let db: Database.Database;

function resetSingletons(): void {
  resetTransactionRepository();
  resetDebtService();
  resetDebtRepository();
  resetCarrierLineRepository();
  resetCarrierLineMovementRepository();
  resetCarrierLineService();
  resetPartnerRepository();
}

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(SCHEMA);
  db.pragma("foreign_keys = OFF");
  (globalThis as G).__LIRATEK_TEST_DB__ = db;
  initFixedTenantContext(1);
  resetSingletons();
  const seed = db.prepare(
    `INSERT OR REPLACE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, ?, ?, ?)`,
  );
  for (const [d, c, b] of [
    ["MTC", "USD", 1000],
    ["Alfa", "USD", 1000],
    ["General", "USD", 5000],
    ["General", "LBP", 500_000_000],
  ] as const)
    seed.run(d, c, b);
  db.prepare(
    `INSERT INTO clients (id, tenant_id, full_name, phone_number) VALUES (?, 1, 'Rami', '70111222')`,
  ).run(CLIENT_ID);
  db.prepare(`INSERT INTO partners (id, tenant_id, name) VALUES (?, 1, 'Partner')`).run(
    PARTNER_ID,
  );
});

afterEach(() => {
  resetTenantContext();
  resetSingletons();
  delete (globalThis as G).__LIRATEK_TEST_DB__;
  db.close();
});

const repo = () => new RechargeRepository();

/** Alfa $3 gift at 300,000 LBP (cost 255,000) as the page sends it. */
function giftLbp(patch: Partial<RechargePayload> = {}): RechargePayload {
  return {
    provider: "Alfa",
    type: "ALFA_GIFT",
    amount: 3,
    cost: 255_000,
    price: 300_000,
    currency: "LBP",
    payments: [{ method: "CASH", currencyCode: "LBP", amount: 300_000 }],
    ...patch,
  };
}

/** Parse through the shared schema (both transports), then add the actor. */
function viaSchema(payload: RechargePayload): ProcessInput {
  return { ...createRechargeSchema.parse(payload), userId: 1 } as ProcessInput;
}

function rechargeTxn(rechargeId: number) {
  return db
    .prepare(
      `SELECT id, amount_usd, amount_lbp, profit_usd, profit_lbp, extra_usd, extra_lbp, metadata_json
         FROM transactions WHERE source_table = 'recharges' AND source_id = ? AND type = 'RECHARGE'`,
    )
    .get(rechargeId) as {
    id: number;
    amount_usd: number;
    amount_lbp: number;
    profit_usd: number;
    profit_lbp: number;
    extra_usd: number;
    extra_lbp: number;
    metadata_json: string;
  };
}

function rechargePrice(rechargeId: number): number {
  return (
    db.prepare(`SELECT price FROM recharges WHERE id = ?`).get(rechargeId) as {
      price: number;
    }
  ).price;
}

function rechargeCount(): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM recharges`).get() as { n: number }).n;
}

/** Ledger deltas of one baseline sale with no extra, rolled back after. */
function baselineDeltas(payload: RechargePayload) {
  const before = snapshotLedgers(db);
  const res = repo().processRecharge(viaSchema(payload));
  expect(res.success).toBe(true);
  const deltas = ledgerDeltas(before, snapshotLedgers(db));
  getTransactionRepository().voidTransaction(rechargeTxn(res.id!).id, 1);
  return deltas;
}

describe("schema — extra keys and refusals (rule 23: Zod would strip them)", () => {
  it("keeps extra_lbp / extra_usd and invents none when absent", () => {
    const withExtra = createRechargeSchema.parse(giftLbp({ extra_lbp: 20_000 }));
    expect(withExtra).toMatchObject({ extra_lbp: 20_000 });
    const none = createRechargeSchema.parse(giftLbp());
    expect(none).not.toHaveProperty("extra_usd");
    expect(none).not.toHaveProperty("extra_lbp");
  });

  it.each([
    ["discount + extra", { discount: 10_000, extra_lbp: 20_000 }, DISCOUNT_AND_EXTRA_MESSAGE],
    [
      "extra on a for-partner sale",
      { extra_lbp: 20_000, partnerId: PARTNER_ID, partnerMode: "FOR" as const, payments: [] },
      NO_EXTRA_FOR_PARTNER_MESSAGE,
    ],
    ["extra above the sale", { extra_lbp: 300_001 }, EXTRA_ABOVE_TOTAL_MESSAGE],
    ["a USD extra on an LBP sale", { extra_usd: 1 }, RECHARGE_EXTRA_CURRENCY_MESSAGE],
    [
      "extra on a credit buy-back",
      { type: "CREDIT_BUYBACK" as const, extra_lbp: 20_000 },
      NO_EXTRA_ON_BUYBACK_MESSAGE,
    ],
  ])("refuses %s", (_name, patch, message) => {
    const r = createRechargeSchema.safeParse(giftLbp(patch));
    expect(r.success).toBe(false);
    expect(r.success ? [] : r.error.issues.map((i) => i.message)).toContain(message);
  });
});

describe("sale with an extra", () => {
  it("LBP: 300,000 + 20,000 extra paid 320,000 cash → row amount 320,000, extra 20,000, commission unchanged, drawer +20,000 more than without", () => {
    const base = baselineDeltas(giftLbp());
    const before = snapshotLedgers(db);
    const res = repo().processRecharge(
      viaSchema(
        giftLbp({
          extra_lbp: 20_000,
          payments: [{ method: "CASH", currencyCode: "LBP", amount: 320_000 }],
        }),
      ),
    );
    expect(res).toEqual(expect.objectContaining({ success: true }));
    const id = res.id!;
    const txn = rechargeTxn(id);
    expect(txn).toMatchObject({
      amount_lbp: 320_000,
      amount_usd: 0,
      profit_lbp: 45_000,
      profit_usd: 0,
      extra_lbp: 20_000,
      extra_usd: 0,
    });
    expect(JSON.parse(txn.metadata_json)).toMatchObject({ extra_lbp: 20_000 });
    expect(rechargePrice(id)).toBe(300_000);
    expectPostings(before, snapshotLedgers(db), {
      ...base,
      drawers: {
        ...base.drawers,
        "General|LBP": (base.drawers["General|LBP"] ?? 0) + 20_000,
      },
    });
  });

  it("USD: $5 + $1 extra paid $6 → amount 6, extra 1, commission 1 unchanged", () => {
    const usd = (patch: Partial<RechargePayload> = {}) =>
      giftLbp({
        cost: 4,
        price: 5,
        currency: "USD",
        payments: [{ method: "CASH", currencyCode: "USD", amount: 5 }],
        ...patch,
      });
    const base = baselineDeltas(usd());
    const before = snapshotLedgers(db);
    const res = repo().processRecharge(
      viaSchema(
        usd({ extra_usd: 1, payments: [{ method: "CASH", currencyCode: "USD", amount: 6 }] }),
      ),
    );
    expect(res.success).toBe(true);
    expect(rechargeTxn(res.id!)).toMatchObject({
      amount_usd: 6,
      profit_usd: 1,
      extra_usd: 1,
      extra_lbp: 0,
    });
    expectPostings(before, snapshotLedgers(db), {
      ...base,
      drawers: {
        ...base.drawers,
        "General|USD": (base.drawers["General|USD"] ?? 0) + 1,
      },
    });
  });

  it("no payment legs (single-method CASH fallback) → the drawer takes price + extra", () => {
    const base = baselineDeltas(giftLbp({ payments: undefined, paid_by_method: "CASH" }));
    const before = snapshotLedgers(db);
    const res = repo().processRecharge(
      viaSchema(giftLbp({ payments: undefined, paid_by_method: "CASH", extra_lbp: 20_000 })),
    );
    expect(res.success).toBe(true);
    expect(ledgerDeltas(before, snapshotLedgers(db)).drawers["General|LBP"]).toBe(
      (base.drawers["General|LBP"] ?? 0) + 20_000,
    );
  });
});

describe("US5 — on the client's account (T053, Recharge part)", () => {
  it("fully on CUSTOMER_ACCOUNT → debt +320,000; void → every ledger back to 0", () => {
    const before = snapshotLedgers(db);
    const res = repo().processRecharge(
      viaSchema(
        giftLbp({
          clientId: CLIENT_ID,
          extra_lbp: 20_000,
          payments: [{ method: "CUSTOMER_ACCOUNT", currencyCode: "LBP", amount: 320_000 }],
        }),
      ),
    );
    expect(res.success).toBe(true);
    expect(ledgerDeltas(before, snapshotLedgers(db)).debt).toEqual({
      [`${CLIENT_ID}|LBP`]: 320_000,
    });
    getTransactionRepository().voidTransaction(rechargeTxn(res.id!).id, 1);
    expectPostings(before, snapshotLedgers(db), {});
  });

  it("no legs, paid_by_method CUSTOMER_ACCOUNT → debt is price + extra", () => {
    const before = snapshotLedgers(db);
    const res = repo().processRecharge(
      viaSchema(
        giftLbp({
          clientId: CLIENT_ID,
          payments: undefined,
          paid_by_method: "CUSTOMER_ACCOUNT",
          extra_lbp: 20_000,
        }),
      ),
    );
    expect(res.success).toBe(true);
    expect(ledgerDeltas(before, snapshotLedgers(db)).debt).toEqual({
      [`${CLIENT_ID}|LBP`]: 320_000,
    });
  });
});

describe("reversal nets to 0 (rule 20)", () => {
  it("full refund: REFUND row carries −extra; every ledger back to 0", () => {
    const before = snapshotLedgers(db);
    const res = repo().processRecharge(
      viaSchema(
        giftLbp({
          extra_lbp: 20_000,
          payments: [{ method: "CASH", currencyCode: "LBP", amount: 320_000 }],
        }),
      ),
    );
    expect(res.success).toBe(true);
    const txnId = rechargeTxn(res.id!).id;
    getTransactionRepository().refundTransaction(txnId, 1);
    const refund = db
      .prepare(
        `SELECT amount_lbp, extra_lbp, profit_lbp FROM transactions WHERE type = 'REFUND' AND reverses_id = ?`,
      )
      .get(txnId);
    expect(refund).toEqual({ amount_lbp: -320_000, extra_lbp: -20_000, profit_lbp: -45_000 });
    expectPostings(before, snapshotLedgers(db), {});
  });
});

describe("repository refusals — nothing is written", () => {
  /** Typed input that skips the schema (e.g. the session checkout path). */
  const direct = (patch: Partial<ProcessInput>): ProcessInput =>
    ({ ...giftLbp(), userId: 1, ...patch }) as ProcessInput;

  it.each([
    [
      "extra above the sale",
      { extra_lbp: 300_001, payments: [{ method: "CASH", currencyCode: "LBP", amount: 600_001 }] },
      EXTRA_ABOVE_TOTAL_MESSAGE,
    ],
    ["discount + extra", { discount: 10_000, extra_lbp: 20_000 }, DISCOUNT_AND_EXTRA_MESSAGE],
    ["a session-basket item", { deferPayment: true, extra_lbp: 20_000 }, EXTRA_ON_SESSION_ITEM_MESSAGE],
    [
      "a for-partner sale",
      { partnerId: PARTNER_ID, partnerMode: "FOR" as const, payments: [], extra_lbp: 20_000 },
      NO_EXTRA_FOR_PARTNER_MESSAGE,
    ],
    ["a USD extra on an LBP sale", { extra_usd: 1 }, RECHARGE_EXTRA_CURRENCY_MESSAGE],
    [
      "a credit buy-back",
      { type: "CREDIT_BUYBACK" as const, extra_lbp: 20_000 },
      NO_EXTRA_ON_BUYBACK_MESSAGE,
    ],
    ["a negative extra", { extra_lbp: -1 }, "The extra can't be negative."],
  ])("refuses %s", (_name, patch, message) => {
    const before = snapshotLedgers(db);
    const count = rechargeCount();
    const res = repo().processRecharge(direct(patch as Partial<ProcessInput>));
    expect(res).toEqual({ success: false, error: message });
    expectPostings(before, snapshotLedgers(db), {});
    expect(rechargeCount()).toBe(count);
  });
});
