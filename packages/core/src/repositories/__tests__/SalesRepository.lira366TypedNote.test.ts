/**
 * LIRA-366 T010 — the cashier's typed note on a POS sale.
 *
 * A $20 sale to a known client: $15 cash + $5 on the client's account, note
 * "rest on Monday". The note goes to `details.note`, the sale's `note`
 * column, and the end of the 'Sale Debt' note. Money is unchanged by it
 * (deltas, rule 15). Editing the sale note later moves every copy (rule 31).
 * A session-basket (deferred) sale keeps its note on the item's own
 * transaction, whatever the basket checkout later books.
 *
 * Field names come from `saleProcessSchema` (rule 24). Real schema via the
 * debtItemDb helper. Rule 17: seen failing before the repository read
 * `typedNote`.
 */
import type Database from "better-sqlite3";
import {
  addClient,
  installDebtItemTestDb,
  uninstallDebtItemTestDb,
} from "../testHelpers/debtItemDb";
import { ledgerDeltas, snapshotLedgers } from "../testHelpers/postingAssert";
import { readTypedNoteCopies } from "../testHelpers/typedNoteAssert";
import {
  getSalesRepository,
  resetSalesRepository,
  type SaleRequest,
} from "../SalesRepository";
import { resetTransactionRepository } from "../TransactionRepository";
import { resetPaymentMethodRepository } from "../PaymentMethodRepository";
import { resetDebtRepository } from "../DebtRepository";
import { getSalesService, resetSalesService } from "../../services/SalesService";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { saleProcessSchema } from "../../validators/sale";

let db: Database.Database;

function resetAll(): void {
  resetTransactionRepository();
  resetPaymentMethodRepository();
  resetDebtRepository();
  resetSalesRepository();
  resetSalesService();
}

beforeEach(() => {
  db = installDebtItemTestDb();
  initFixedTenantContext(1);
  resetAll();
  addClient(db, 60);
  db.prepare(
    `INSERT INTO products (id, tenant_id, name, item_type, cost_price_usd, stock_quantity)
     VALUES (1, 1, 'Charger', 'product', 8, 10)`,
  ).run();
});
afterEach(() => {
  resetAll();
  resetTenantContext();
  uninstallDebtItemTestDb(db);
});

/** The wire payload, parsed through the real schema (rule 24). */
function payload(
  typedNote: string | undefined,
  extra: Record<string, unknown> = {},
): SaleRequest {
  return saleProcessSchema.parse({
    client_id: 60,
    items: [{ product_id: 1, quantity: 1, price: 20 }],
    total_amount: 20,
    discount: 0,
    final_amount: 20,
    payment_usd: 15,
    payment_lbp: 0,
    payments: [
      { method: "CASH", currency_code: "USD", amount: 15 },
      { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 5 },
    ],
    exchange_rate: 89_000,
    typedNote,
    ...extra,
  }) as unknown as SaleRequest;
}

function sell(typedNote: string | undefined): number {
  const r = getSalesService().processSale(payload(typedNote), 1);
  expect(r.error).toBeUndefined();
  return r.id as number;
}

function saleTxnId(saleId: number): number {
  return (
    db
      .prepare(
        `SELECT id FROM transactions WHERE source_table = 'sales' AND source_id = ? AND type = 'SALE'`,
      )
      .get(saleId) as { id: number }
  ).id;
}

describe("LIRA-366 — typed note on a POS sale", () => {
  it("lands in details.note, the sale note and the Sale Debt note; money unchanged", () => {
    const before = snapshotLedgers(db);
    const id = sell(" rest on Monday  ");
    const d = ledgerDeltas(before, snapshotLedgers(db));
    expect(d.debt).toEqual({ "60|USD": 5 });
    expect(d.drawers).toEqual({ "General|USD": 15 });

    const c = readTypedNoteCopies(db, saleTxnId(id));
    expect(c.detailsNote).toBe("rest on Monday");
    expect(c.debtNotes).toHaveLength(1);
    expect(c.debtNotes[0]).toMatch(/^Sale #\d+: .* — rest on Monday$/);
    expect(
      (db.prepare(`SELECT note FROM sales WHERE id = ?`).get(id) as {
        note: string;
      }).note,
    ).toBe("rest on Monday");
  });

  it("no typed note → no details.note and no suffix", () => {
    const id = sell(undefined);
    const c = readTypedNoteCopies(db, saleTxnId(id));
    expect(c.detailsNote).toBeUndefined();
    expect(c.debtNotes[0]).not.toContain(" — rest");
  });

  it("editing the sale note moves details.note and the debt note together", () => {
    const id = sell("rest on Monday");
    const systemPart = readTypedNoteCopies(db, saleTxnId(id)).debtNotes[0]
      .replace(/ — rest on Monday$/, "");
    getSalesRepository().updateMetadata(id, { note: "rest on Tuesday" }, "admin");
    const c = readTypedNoteCopies(db, saleTxnId(id));
    expect(c.detailsNote).toBe("rest on Tuesday");
    expect(c.debtNotes).toEqual([`${systemPart} — rest on Tuesday`]);
  });

  it("session basket (deferred) sale keeps the note on its own transaction", () => {
    // The basket stores the item's formData opaquely and replays it through
    // processSale with deferPayment (SessionCheckoutService) — no schema
    // re-parse, so the raw text arrives untrimmed.
    const r = getSalesService().processSale(
      {
        ...payload(undefined, { payments: [], payment_usd: 0 }),
        typedNote: "  for his brother ",
        deferPayment: true,
      } as SaleRequest,
      1,
    );
    expect(r.error).toBeUndefined();
    expect(readTypedNoteCopies(db, saleTxnId(r.id as number)).detailsNote).toBe(
      "for his brother",
    );
  });
});
