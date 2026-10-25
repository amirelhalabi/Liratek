/**
 * Money guard (owner-approved 2026-10-25) — cash change travels ONLY as
 * `change_given_usd/lbp`, never as a returned payment line.
 *
 * Bug: `SalesRepository.processSale` posts change twice when one request
 * carries BOTH a CASH OUT leg in `payments[]` and `change_given_*`: the OUT
 * leg loop books "Change returned" (−amt) and the change_given block books
 * "Change given" (−change), so the General drawer is debited twice and the
 * payment snapshot shows the change doubled. `saleProcessSchema` accepted it.
 * No shipped screen sends that shape (POS CheckoutModal: cash change as
 * change_given_*, account change as a CUSTOMER_ACCOUNT OUT leg), but both
 * transports and repository callers could.
 *
 * Rule: the only OUT leg a sale or a repair checkout accepts is
 * CUSTOMER_ACCOUNT (change put on the client's account). One shared
 * definition (rule 14) — `validators/changeLegs.ts` — used by the sale and
 * maintenance schemas and by both repositories. A session-basket item
 * (`deferPayment`) is unaffected: the basket owns its payment and change.
 *
 * Failing-first (rule 17), run 2026-10-25 against the UNFIXED code:
 *   (a) FAILED — `processSale` returned { success: true, id: 1 }; measured
 *       General USD delta +44, payment rows +50 / −3 "Change returned" /
 *       −3 "Change given", snapshot change_returned [3, 3] — the $3 change
 *       debited twice (expected: refused, delta 0).
 *   (a2) FAILED — a lone CASH OUT leg saved (success: true).
 *   (b) FAILED — `saleProcessSchema.safeParse` succeeded (no refine);
 *       `saveMaintenanceJobSchema.safeParse` also succeeded (measured).
 *   (c), (d), (e) PASSED (controls — behaviour that must not change).
 * After the fix: 6/6 pass.
 */
import type Database from "better-sqlite3";
import { buildDb } from "../testHelpers/omtAccountDb";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { SalesRepository } from "../SalesRepository";
import { resetTransactionRepository } from "../TransactionRepository";
import { resetExpenseRepository } from "../ExpenseRepository";
import { resetDebtRepository } from "../DebtRepository";
import { resetClientRepository } from "../ClientRepository";
import { resetDebtService } from "../../services/DebtService";
import { saleProcessSchema } from "../../validators/sale";
import { saveMaintenanceJobSchema } from "../../validators/maintenance";

const RATE = 89000;
type SaleInput = Parameters<SalesRepository["processSale"]>[0];

let db: Database.Database;
let repo: SalesRepository;
let productId: number;

function general(): Record<string, number> {
  const rows = db
    .prepare(
      `SELECT currency_code, balance FROM drawer_balances WHERE drawer_name = 'General' AND tenant_id = 1`,
    )
    .all() as { currency_code: string; balance: number }[];
  return Object.fromEntries(rows.map((r) => [r.currency_code, r.balance]));
}

function generalUsd(): number {
  return general()["USD"] ?? 0;
}

function saleCount(): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM sales`).get() as { n: number })
    .n;
}

function resetSingletons(): void {
  resetTransactionRepository();
  resetExpenseRepository();
  resetDebtRepository();
  resetClientRepository();
  resetDebtService();
}

beforeEach(() => {
  resetSingletons();
  db = buildDb();
  initFixedTenantContext(1);
  db.prepare(
    `INSERT INTO drawer_balances (drawer_name, currency_code, balance, tenant_id)
     VALUES ('General', 'USD', 1000, 1)
     ON CONFLICT(drawer_name, currency_code, tenant_id) DO UPDATE SET balance = 1000`,
  ).run();
  productId = Number(
    db
      .prepare(
        `INSERT INTO products (name, barcode, item_type, cost_price_usd, stock_quantity, tenant_id)
         VALUES ('Anker 20W charger','nc1','Accessory',20,10,1)`,
      )
      .run().lastInsertRowid,
  );
  repo = new SalesRepository();
});

afterEach(() => {
  resetTenantContext();
  resetSingletons();
});

/** A $47 charger. Field names come from the shared schema (rule 24): every
 *  repository payload below is first parsed by `saleProcessSchema` where the
 *  schema accepts it. */
function base(over: Partial<SaleInput> = {}): SaleInput {
  return {
    client_id: null,
    items: [{ product_id: productId, quantity: 1, price: 47 }],
    total_amount: 47,
    discount: 0,
    final_amount: 47,
    payment_usd: 50,
    payment_lbp: 0,
    exchange_rate: RATE,
    status: "completed",
    ...over,
  } as SaleInput;
}

const cashInPlusCashOutPlusChange = (): SaleInput =>
  base({
    payments: [
      { method: "CASH", currency_code: "USD", amount: 50 },
      { method: "CASH", currency_code: "USD", amount: 3, direction: "OUT" },
    ],
    change_given_usd: 3,
  });

describe("cash change is change_given only — never a CASH OUT leg", () => {
  it("(a) Cash $50 IN + Cash $3 OUT + change_given $3 → refused, nothing written", () => {
    const before = generalUsd();
    const salesBefore = saleCount();
    const res = repo.processSale(cashInPlusCashOutPlusChange(), 1);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/change given/i);
    expect(generalUsd() - before).toBe(0);
    expect(saleCount()).toBe(salesBefore);
  });

  it("(a2) a CASH OUT leg alone (no change_given) is refused too — change goes on change_given", () => {
    const before = generalUsd();
    const res = repo.processSale(
      base({
        payments: [
          { method: "CASH", currency_code: "USD", amount: 50 },
          { method: "CASH", currency_code: "USD", amount: 3, direction: "OUT" },
        ],
      }),
      1,
    );
    expect(res.success).toBe(false);
    expect(generalUsd() - before).toBe(0);
  });

  it("(b) both checkout schemas refuse a non-account OUT leg at the edge", () => {
    const sale = saleProcessSchema.safeParse(cashInPlusCashOutPlusChange());
    expect(sale.success).toBe(false);
    if (!sale.success) {
      expect(sale.error.issues[0]?.message).toMatch(/change given/i);
      expect(sale.error.issues[0]?.path).toEqual(["payments"]);
    }

    const job = saveMaintenanceJobSchema.safeParse({
      device_name: "iPhone 13",
      price_usd: 47,
      payments: [
        { method: "CASH", currency_code: "USD", amount: 50 },
        { method: "CASH", currency_code: "USD", amount: 3, direction: "OUT" },
      ],
      change_given_usd: 3,
    });
    expect(job.success).toBe(false);
  });

  it("(c) normal sale — change_given $3 only → accepted, General +47", () => {
    const before = generalUsd();
    const payload = saleProcessSchema.parse(
      base({
        payments: [{ method: "CASH", currency_code: "USD", amount: 50 }],
        change_given_usd: 3,
      }),
    ) as SaleInput;
    const res = repo.processSale(payload, 1);
    expect(res.success).toBe(true);
    expect(generalUsd() - before).toBe(47);
  });

  it("(d) CUSTOMER_ACCOUNT OUT leg with a client → accepted, $3 credited", () => {
    const clientId = Number(
      db
        .prepare(
          `INSERT INTO clients (full_name, phone_number, tenant_id) VALUES ('Rami Haddad','70445566',1)`,
        )
        .run().lastInsertRowid,
    );
    const before = generalUsd();
    const payload = saleProcessSchema.parse(
      base({
        client_id: clientId,
        payments: [
          { method: "CASH", currency_code: "USD", amount: 50 },
          {
            method: "CUSTOMER_ACCOUNT",
            currency_code: "USD",
            amount: 3,
            direction: "OUT",
          },
        ],
      }),
    ) as SaleInput;
    const res = repo.processSale(payload, 1);
    expect(res.success).toBe(true);
    expect(generalUsd() - before).toBe(50);
    const credit = db
      .prepare(
        `SELECT COALESCE(SUM(amount_usd), 0) AS usd FROM debt_ledger WHERE client_id = ?`,
      )
      .get(clientId) as { usd: number };
    expect(credit.usd).toBe(-3);
  });

  it("(e) session-basket replay (deferPayment) with an OUT leg → unaffected, no drawer move", () => {
    const before = generalUsd();
    const res = repo.processSale(
      {
        ...cashInPlusCashOutPlusChange(),
        deferPayment: true,
      } as SaleInput,
      1,
    );
    expect(res.success).toBe(true);
    expect(generalUsd() - before).toBe(0);
  });
});
