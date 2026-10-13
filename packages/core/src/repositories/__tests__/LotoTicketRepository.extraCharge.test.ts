/**
 * LIRA-319 US4 (T041 + T053) — a Loto ticket sold with an extra charge.
 *
 * Loto tickets are LBP-native, so the extra is in LBP (the sale's currency).
 * A 100,000 LBP ticket (commission 4,450) with a 10,000 LBP extra:
 *
 *   LOTO row: amount_lbp 110,000 (what the customer owes and pays)
 *             profit_lbp 4,450   (the commission — the extra is NOT in it)
 *             extra_lbp 10,000   (reported as "Extra charges" in Profits)
 *   drawer +110,000; the LOTO supplier is owed 100,000 − 4,450, unchanged
 *
 * Refused before any write: an extra above the ticket itself, with a
 * discount, on a session-basket (deferred) ticket, on a partner ticket, or
 * in USD. On the client's account the debt includes the extra (FR-015), and
 * void / refund net every ledger, profit and "Extra charges" to 0 (rule 20).
 *
 * Real schema (create_db.sql) via the debtItemDb helper. Fixtures typed
 * loosely so this file runs against the unchanged `LotoTicketCreate`
 * (rule 17 — red for the right reason, not a compile error).
 */
import type Database from "better-sqlite3";
import {
  installDebtItemTestDb,
  uninstallDebtItemTestDb,
  addClient,
} from "../testHelpers/debtItemDb";
import {
  snapshotLedgers,
  ledgerDeltas,
  expectPostings,
} from "../testHelpers/postingAssert";
import {
  LotoTicketRepository,
  resetLotoTicketRepository,
  type LotoTicketCreate,
} from "../LotoTicketRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import { resetSupplierRepository } from "../SupplierRepository";
import { resetPartnerRepository } from "../PartnerRepository";
import { resetPaymentMethodRepository } from "../PaymentMethodRepository";
import { resetProfitRepository } from "../ProfitRepository";
import { resetDebtRepository } from "../DebtRepository";
import { resetDebtService } from "../../services/DebtService";
import {
  getProfitService,
  resetProfitService,
} from "../../services/ProfitService";
import { getLotoService, resetLotoService } from "../../services/LotoService";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

const SALE = 100_000;
const COMMISSION = 4_450;
const EXTRA = 10_000;
const FROM = "2000-01-01";
const TO = "2100-12-31";

let db: Database.Database;
let repo: LotoTicketRepository;

function resetAll(): void {
  resetTransactionRepository();
  resetSupplierRepository();
  resetPartnerRepository();
  resetPaymentMethodRepository();
  resetProfitRepository();
  resetProfitService();
  resetDebtRepository();
  resetDebtService();
  resetLotoTicketRepository();
  resetLotoService();
}

beforeEach(() => {
  db = installDebtItemTestDb();
  initFixedTenantContext(1);
  resetAll();
  repo = new LotoTicketRepository();
});
afterEach(() => {
  resetAll();
  resetTenantContext();
  uninstallDebtItemTestDb(db);
});

type WithExtra = LotoTicketCreate & {
  extra_usd?: number;
  extra_lbp?: number;
};

function ticket(o: Partial<WithExtra> = {}): WithExtra {
  return {
    sale_amount: SALE,
    commission_amount: COMMISSION,
    commission_rate: COMMISSION / SALE,
    sale_date: "2026-10-14",
    currency: "LBP",
    userId: 1,
    payments: [{ method: "CASH", currencyCode: "LBP", amount: SALE + EXTRA }],
    extra_lbp: EXTRA,
    ...o,
  };
}

interface LotoTxnRow {
  id: number;
  amount_usd: number;
  amount_lbp: number;
  profit_usd: number;
  profit_lbp: number;
  extra_usd: number;
  extra_lbp: number;
}

function lotoTxn(ticketId: number): LotoTxnRow {
  return db
    .prepare(
      `SELECT id, amount_usd, amount_lbp, profit_usd, profit_lbp, extra_usd, extra_lbp
         FROM transactions
        WHERE source_table = 'loto_tickets' AND source_id = ? AND type = 'LOTO'`,
    )
    .get(ticketId) as LotoTxnRow;
}

function ticketCount(): number {
  return (
    db.prepare(`SELECT COUNT(*) AS n FROM loto_tickets`).get() as { n: number }
  ).n;
}

function lotoSupplierId(): number {
  return (
    db
      .prepare(`SELECT id FROM suppliers WHERE provider = 'LOTO' LIMIT 1`)
      .get() as { id: number }
  ).id;
}

function profits() {
  resetProfitRepository();
  resetProfitService();
  const s = getProfitService().getSummary(FROM, TO);
  return {
    grossLbp: s.totals.gross_profit_lbp,
    grossUsd: s.totals.gross_profit_usd,
    extraLbp: s.extra_charges.lbp,
    extraUsd: s.extra_charges.usd,
    lotoRevenueLbp: s.loto.revenue_lbp,
    lotoProfitLbp: s.loto.profit_lbp,
  };
}

describe("T041 — Loto ticket with an extra (LBP)", () => {
  it("100,000 + extra 10,000 → amount 110,000, commission profit unchanged, extra 10,000", () => {
    const before = snapshotLedgers(db);
    const p0 = profits();

    const t = repo.createTicket(ticket());
    const txn = lotoTxn(t.id);

    expect(txn.amount_lbp).toBe(SALE + EXTRA);
    expect(txn.amount_usd).toBe(0);
    expect(txn.profit_lbp).toBe(COMMISSION);
    expect(txn.profit_usd).toBe(0);
    expect(txn.extra_lbp).toBe(EXTRA);
    expect(txn.extra_usd).toBe(0);
    // The ticket itself keeps its face value.
    expect(t.sale_amount).toBe(SALE);

    expectPostings(before, snapshotLedgers(db), {
      drawers: { "General|LBP": SALE + EXTRA },
      // LOTO is owed exactly what it is owed without an extra.
      supplier: { [`${lotoSupplierId()}|LBP`]: SALE - COMMISSION },
    });

    const p1 = profits();
    expect(p1.extraLbp - p0.extraLbp).toBe(EXTRA);
    expect(p1.extraUsd - p0.extraUsd).toBe(0);
    // Loto's own line stays the ticket (no double count of the extra).
    expect(p1.lotoRevenueLbp - p0.lotoRevenueLbp).toBe(SALE);
    expect(p1.lotoProfitLbp - p0.lotoProfitLbp).toBe(COMMISSION);
    expect(p1.grossLbp - p0.grossLbp).toBe(COMMISSION + EXTRA);
  });

  it("the Loto page's kept-change figure does not read the extra as kept change", () => {
    repo.createTicket(ticket());
    expect(repo.getTotalKeptChange(FROM, TO)).toEqual({ usd: 0, lbp: 0 });
  });

  it("an extra with change given back: 120,000 handed, 10,000 back → drawer +110,000", () => {
    const before = snapshotLedgers(db);
    repo.createTicket(
      ticket({
        payments: [
          { method: "CASH", currencyCode: "LBP", amount: 120_000 },
          {
            method: "CASH",
            currencyCode: "LBP",
            amount: 10_000,
            direction: "OUT",
          },
        ],
      }),
    );
    expect(ledgerDeltas(before, snapshotLedgers(db)).drawers).toEqual({
      "General|LBP": SALE + EXTRA,
    });
  });

  it("legs that cover only the face value (extra unpaid, no client) are refused", () => {
    expect(() =>
      repo.createTicket(
        ticket({
          payments: [{ method: "CASH", currencyCode: "LBP", amount: SALE }],
        }),
      ),
    ).toThrow();
    expect(ticketCount()).toBe(0);
  });

  it("legacy single payment (no legs): the drawer takes the ticket plus the extra", () => {
    const before = snapshotLedgers(db);
    const t = repo.createTicket(
      ticket({ payments: undefined, payment_method: "CASH" }),
    );
    expect(lotoTxn(t.id).amount_lbp).toBe(SALE + EXTRA);
    expect(ledgerDeltas(before, snapshotLedgers(db)).drawers).toEqual({
      "General|LBP": SALE + EXTRA,
    });
  });

  it("the service forwards the extra to the repository (both transports call it)", () => {
    const t = getLotoService().sellTicket({
      sale_amount: SALE,
      commission_rate: COMMISSION / SALE,
      currency: "LBP",
      userId: 1,
      payments: [{ method: "CASH", currencyCode: "LBP", amount: SALE + EXTRA }],
      extra_lbp: EXTRA,
    } as Parameters<ReturnType<typeof getLotoService>["sellTicket"]>[0]);
    expect(lotoTxn(t.id).extra_lbp).toBe(EXTRA);
    expect(lotoTxn(t.id).amount_lbp).toBe(SALE + EXTRA);
  });
});

describe("T041/T042 — refusals, before anything is written", () => {
  it.each<[string, Partial<WithExtra>, RegExp]>([
    [
      "an extra above the ticket itself",
      {
        extra_lbp: SALE + 1,
        payments: [
          { method: "CASH", currencyCode: "LBP", amount: 2 * SALE + 1 },
        ],
      },
      /The extra can't be more than the sale itself\./,
    ],
    [
      "a discount and an extra together",
      { discount_lbp: 1_000 },
      /A sale can have a discount or an extra, not both\./,
    ],
    [
      "an extra on a session-basket (deferred) ticket",
      { deferPayment: true, payments: [] },
      /Add the extra at the session checkout\./,
    ],
    [
      "an extra on a partner ticket",
      { partnerMode: "FOR", partnerId: 1, payments: [] },
      /No extra on a for-partner sale\./,
    ],
    [
      "an extra in USD on an LBP ticket",
      {
        extra_lbp: undefined,
        extra_usd: 1,
        payments: [{ method: "CASH", currencyCode: "LBP", amount: SALE }],
      },
      /extra is in LBP/,
    ],
  ])("%s", (_name, patch, message) => {
    const before = snapshotLedgers(db);
    expect(() => repo.createTicket(ticket(patch))).toThrow(message);
    expectPostings(before, snapshotLedgers(db), {});
    expect(ticketCount()).toBe(0);
  });
});

describe("T053 — on the client's account the debt includes the extra", () => {
  it("all on Customer Account → Loto Debt +110,000; void → every ledger back to 0", () => {
    addClient(db, 50);
    const before = snapshotLedgers(db);
    const t = repo.createTicket(
      ticket({
        clientId: 50,
        payments: [
          {
            method: "CUSTOMER_ACCOUNT",
            currencyCode: "LBP",
            amount: SALE + EXTRA,
          },
        ],
      }),
    );
    expectPostings(before, snapshotLedgers(db), {
      debt: { "50|LBP": SALE + EXTRA },
      supplier: { [`${lotoSupplierId()}|LBP`]: SALE - COMMISSION },
    });
    getTransactionRepository().voidTransaction(lotoTxn(t.id).id, 1);
    expectPostings(before, snapshotLedgers(db), {});
  });

  it("face value in cash, the extra on account → Loto Debt +10,000", () => {
    addClient(db, 51);
    const before = snapshotLedgers(db);
    repo.createTicket(
      ticket({
        clientId: 51,
        payments: [
          { method: "CASH", currencyCode: "LBP", amount: SALE },
          { method: "CUSTOMER_ACCOUNT", currencyCode: "LBP", amount: EXTRA },
        ],
      }),
    );
    const d = ledgerDeltas(before, snapshotLedgers(db));
    expect(d.debt).toEqual({ "51|LBP": EXTRA });
    expect(d.drawers).toEqual({ "General|LBP": SALE });
  });
});

describe("rule 20 — void / refund net the extra to 0", () => {
  it.each(["void", "refund"] as const)(
    "%s: drawer, LOTO supplier, profit and Extra charges return to start",
    (how) => {
      const before = snapshotLedgers(db);
      const p0 = profits();
      const t = repo.createTicket(ticket());
      const txnId = lotoTxn(t.id).id;
      if (how === "void") getTransactionRepository().voidTransaction(txnId, 1);
      else getTransactionRepository().refundTransaction(txnId, 1);

      expectPostings(before, snapshotLedgers(db), {});
      const p1 = profits();
      expect(p1.extraLbp).toBeCloseTo(p0.extraLbp, 6);
      expect(p1.grossLbp).toBeCloseTo(p0.grossLbp, 6);
      expect(p1.grossUsd).toBeCloseTo(p0.grossUsd, 6);
    },
  );
});
