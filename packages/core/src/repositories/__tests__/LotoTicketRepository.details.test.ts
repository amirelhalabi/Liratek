/**
 * LIRA-329 T029 — a Loto ticket keeps everything the cashier entered on its
 * own transaction: the sale amount, the commission rate, the ticket number,
 * the discount as typed, the partner (by id and mode), the note, the
 * customer's name and phone (also for a walk-in no client record was made
 * for), and how it was paid (lines, change returned, change kept).
 *
 * Money is asserted FIRST at today's values (FR-008). Expected details go
 * through the kind's own schema (rule 24). Rule 17: run before the builder
 * existed and seen failing.
 *
 * Real schema (`electron-app/create_db.sql`) via the debtItemDb helper.
 */
import type Database from "better-sqlite3";
import {
  installDebtItemTestDb,
  uninstallDebtItemTestDb,
  addClient,
  drawer,
} from "../testHelpers/debtItemDb";
import {
  LotoTicketRepository,
  type LotoTicketCreate,
} from "../LotoTicketRepository";
import { resetTransactionRepository } from "../TransactionRepository";
import { resetSupplierRepository } from "../SupplierRepository";
import { resetPartnerRepository } from "../PartnerRepository";
import { resetPaymentMethodRepository } from "../PaymentMethodRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import {
  lotoSaleDetailsSchema,
  paymentSnapshotSchema,
} from "../../validators/transactionDetails";
import { expectEverySnapshotMatchesPayments } from "../testHelpers/paymentSnapshotAssert";

const SALE = 500_000;
const COMMISSION = 25_000;
const RATE = COMMISSION / SALE;

let db: Database.Database;
let repo: LotoTicketRepository;

function resetAll(): void {
  resetTransactionRepository();
  resetSupplierRepository();
  resetPartnerRepository();
  resetPaymentMethodRepository();
}

beforeEach(() => {
  db = installDebtItemTestDb();
  initFixedTenantContext(1);
  resetAll();
  repo = new LotoTicketRepository();
});
// LIRA-329 T036 — every payment snapshot saved by a case above equals
// the payments rows it booked (method, currency, amount, direction).
afterEach(() => {
  expectEverySnapshotMatchesPayments(db);
});

afterEach(() => {
  resetAll();
  resetTenantContext();
  uninstallDebtItemTestDb(db);
});

/** The field this phase adds (typed loosely so the test runs against the
 *  unchanged `LotoTicketCreate` — rule 17). */
type WithPhone = LotoTicketCreate & { clientPhone?: string };

function ticket(o: Partial<WithPhone> = {}): WithPhone {
  return {
    sale_amount: SALE,
    commission_amount: COMMISSION,
    commission_rate: RATE,
    sale_date: "2026-10-16",
    currency: "LBP",
    userId: 1,
    ...o,
  };
}

interface TxnRow {
  id: number;
  amount_lbp: number;
  profit_usd: number;
  profit_lbp: number;
  client_name: string | null;
  client_phone: string | null;
  metadata_json: string;
}

function txnFor(ticketId: number): TxnRow {
  return db
    .prepare(
      `SELECT id, amount_lbp, profit_usd, profit_lbp, client_name, client_phone,
              metadata_json
         FROM transactions
        WHERE source_table = 'loto_tickets' AND source_id = ? AND type = 'LOTO'`,
    )
    .get(ticketId) as TxnRow;
}

function meta(row: TxnRow): Record<string, unknown> {
  return JSON.parse(row.metadata_json) as Record<string, unknown>;
}

function expectDetails(row: TxnRow, expected: Record<string, unknown>): void {
  expect(lotoSaleDetailsSchema.parse(expected)).toEqual(expected);
  expect(meta(row).details).toEqual(expected);
}

/** Every drawer line of the snapshot is a real `payments` row. */
function expectSnapshotMatchesPayments(row: TxnRow): void {
  const snap = paymentSnapshotSchema.parse(meta(row).payment_snapshot);
  const rows = (
    db
      .prepare(
        `SELECT method, currency_code, amount FROM payments WHERE transaction_id = ?`,
      )
      .all(row.id) as Array<{
      method: string;
      currency_code: string;
      amount: number;
    }>
  ).map((p) => ({
    method: p.method,
    currency: p.currency_code,
    amount: Math.abs(p.amount),
  }));
  for (const line of snap.lines.filter(
    (l) => l.method !== "CUSTOMER_ACCOUNT" && l.method !== "GIFT_CARD",
  )) {
    expect(rows).toContainEqual({
      method: line.method,
      currency: line.currency,
      amount: line.amount,
    });
  }
}

describe("LIRA-329 — LotoTicketRepository: loto_sale details", () => {
  it("a walk-in ticket with a discount keeps ticket number, rate, discount, note, the typed name and phone, and the payment line", () => {
    const lbp0 = drawer(db, "General", "LBP");
    const t = repo.createTicket(
      ticket({
        ticket_number: "T-778",
        note: "for Abu Fadi",
        payments: [{ method: "CASH", currencyCode: "LBP", amount: 480_000 }],
        discount_lbp: 20_000,
        clientName: "Sami Haddad",
        clientPhone: "71222333",
      }),
    );
    const row = txnFor(t.id);

    // FR-008 — today's money (asserted first; passed on the pre-change run).
    expect(row.amount_lbp).toBe(SALE);
    expect(row.profit_lbp).toBe(COMMISSION - 20_000);
    expect(drawer(db, "General", "LBP") - lbp0).toBe(480_000);

    expect(row.client_name).toBe("Sami Haddad");
    expect(row.client_phone).toBe("71222333");
    expectDetails(row, {
      v: 1,
      kind: "loto_sale",
      saleAmount: SALE,
      commissionRate: RATE,
      ticketNumber: "T-778",
      discount: { amount: 20_000, currency: "LBP" },
      note: "for Abu Fadi",
    });
    expect(paymentSnapshotSchema.parse(meta(row).payment_snapshot)).toEqual({
      lines: [
        { method: "CASH", currency: "LBP", amount: 480_000, direction: "IN" },
      ],
    });
    expectSnapshotMatchesPayments(row);
  });

  it("paid in dollars with change returned and kept: lines, change and kept change; the picked client's name and phone fill in", () => {
    addClient(db, 7, "Maya Khoury", "03111222");
    const usd0 = drawer(db, "General", "USD");
    const lbp0 = drawer(db, "General", "LBP");
    const t = repo.createTicket(
      ticket({
        clientId: 7,
        tender_exchange_rate: 89_000,
        payments: [
          { method: "CASH", currencyCode: "USD", amount: 6 },
          {
            method: "CASH",
            currencyCode: "LBP",
            amount: 30_000,
            direction: "OUT",
          },
        ],
        kept_change_lbp: 4_000,
      }),
    );
    const row = txnFor(t.id);

    expect(drawer(db, "General", "USD") - usd0).toBe(6);
    expect(drawer(db, "General", "LBP") - lbp0).toBe(-30_000);
    expect(row.profit_lbp).toBe(COMMISSION + 4_000);

    expect(row.client_name).toBe("Maya Khoury");
    expect(row.client_phone).toBe("03111222");
    expectDetails(row, {
      v: 1,
      kind: "loto_sale",
      saleAmount: SALE,
      commissionRate: RATE,
    });
    expect(paymentSnapshotSchema.parse(meta(row).payment_snapshot)).toEqual({
      lines: [
        { method: "CASH", currency: "USD", amount: 6, direction: "IN" },
        { method: "CASH", currency: "LBP", amount: 30_000, direction: "OUT" },
      ],
      change_returned: [{ method: "CASH", currency: "LBP", amount: 30_000 }],
      kept: { lbp: 4_000 },
    });
    expectSnapshotMatchesPayments(row);
  });

  it("a partner ticket keeps the partner by id and mode, never a walk-in phone, and has no counter payment snapshot", () => {
    const partnerId = Number(
      db
        .prepare(
          `INSERT INTO partners (tenant_id, name) VALUES (1, 'Corner Kiosk')`,
        )
        .run().lastInsertRowid,
    );
    const t = repo.createTicket(
      ticket({
        partnerId,
        partnerMode: "FOR",
        clientName: "Someone",
        clientPhone: "70999999",
      }),
    );
    const row = txnFor(t.id);

    expect(row.amount_lbp).toBe(SALE);
    expect(row.profit_lbp).toBe(COMMISSION);
    expect(row.client_name).toBe("Corner Kiosk [partner]");
    expect(row.client_phone).toBeNull();
    expectDetails(row, {
      v: 1,
      kind: "loto_sale",
      saleAmount: SALE,
      commissionRate: RATE,
      partner: { id: partnerId, name: "Corner Kiosk", mode: "FOR" },
    });
    expect(meta(row).payment_snapshot).toBeUndefined();
  });

  it("a single-method ticket (no lines) keeps the one payment line it booked", () => {
    const lbp0 = drawer(db, "General", "LBP");
    const t = repo.createTicket(ticket({ payment_method: "CASH" }));
    const row = txnFor(t.id);

    expect(drawer(db, "General", "LBP") - lbp0).toBe(SALE);
    expect(paymentSnapshotSchema.parse(meta(row).payment_snapshot)).toEqual({
      lines: [
        { method: "CASH", currency: "LBP", amount: SALE, direction: "IN" },
      ],
    });
    expectSnapshotMatchesPayments(row);
  });

  it("a customer-basket ticket keeps its details but no payment lines of its own (the basket owns them)", () => {
    const lbp0 = drawer(db, "General", "LBP");
    const t = repo.createTicket(
      ticket({ deferPayment: true, clientName: "Basket Guy" }),
    );
    const row = txnFor(t.id);

    expect(drawer(db, "General", "LBP") - lbp0).toBe(0);
    expect(row.client_name).toBe("Basket Guy");
    expectDetails(row, {
      v: 1,
      kind: "loto_sale",
      saleAmount: SALE,
      commissionRate: RATE,
    });
    expect(meta(row).payment_snapshot).toBeUndefined();
  });

  // LIRA-329 T037 — and it records the session that paid for it
  // (server-injected, like `deferPayment`).
  it("a customer-basket ticket records its session", () => {
    const t = repo.createTicket({
      ...ticket({ deferPayment: true, clientName: "Basket Guy" }),
      paid_in_session: 9,
    } as LotoTicketCreate);
    const row = txnFor(t.id);
    expect(row.amount_lbp).toBe(SALE);
    expect(meta(row).details).toMatchObject({
      kind: "loto_sale",
      paid_in_session: 9,
    });
    expect(meta(row).payment_snapshot).toEqual({ lines: [], session_id: 9 });
  });
});
