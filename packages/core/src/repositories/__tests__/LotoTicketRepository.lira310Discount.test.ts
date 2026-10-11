/**
 * LIRA-310 T019/T024 — the Loto ticket discount (the Waive / Discount on the
 * Loto page) is saved by the server and lowers PROFIT ONLY:
 *
 *   profit_lbp = commission + kept − discount     (stamp on the LOTO row)
 *   face value (amount_lbp) and the LOTO supplier TOP_UP (sale − commission)
 *   are exactly what they are without a discount
 *
 * The discount is checked by the one kept-change helper (`resolveKeptChange`
 * customer reduction): it must equal the real gap, sit under the commission,
 * and is refused with a session-cart (deferred) ticket, a partner ticket, or
 * kept change. Void and refund net drawer, supplier ledger and profit to 0.
 *
 * Real schema (`electron-app/create_db.sql`) via the debtItemDb helper, so the
 * Profits page's own reader (`ProfitService.getSummary`) is what is asserted.
 *
 * Rule 17: written before the repository learned `discount_lbp`; the red run
 * is recorded under T019 in specs/310-waive-everywhere/tasks.md.
 */
import type Database from "better-sqlite3";
import {
  installDebtItemTestDb,
  uninstallDebtItemTestDb,
  drawer,
} from "../testHelpers/debtItemDb";
import { LotoTicketRepository, type LotoTicketCreate } from "../LotoTicketRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import { resetSupplierRepository } from "../SupplierRepository";
import { resetPartnerRepository } from "../PartnerRepository";
import { resetPaymentMethodRepository } from "../PaymentMethodRepository";
import { resetProfitRepository } from "../ProfitRepository";
import {
  getProfitService,
  resetProfitService,
} from "../../services/ProfitService";
import { lotoSellSchema } from "../../validators/loto";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

const SALE = 500_000;
const COMMISSION = 25_000;
const DISCOUNT = 20_000;
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

/** The new fields, typed loosely so this file runs against the unchanged
 *  `LotoTicketCreate` (rule 17 — red for the right reason, not a compile
 *  error). */
type WithDiscount = LotoTicketCreate & {
  discount_usd?: number;
  discount_lbp?: number;
};

function ticket(o: Partial<WithDiscount> = {}): WithDiscount {
  return {
    sale_amount: SALE,
    commission_amount: COMMISSION,
    commission_rate: COMMISSION / SALE,
    sale_date: "2026-10-11",
    currency: "LBP",
    userId: 1,
    payments: [{ method: "CASH", currencyCode: "LBP", amount: SALE - DISCOUNT }],
    discount_lbp: DISCOUNT,
    ...o,
  };
}

function lotoTxn(ticketId: number) {
  return db
    .prepare(
      `SELECT id, amount_lbp, profit_usd, profit_lbp, metadata_json FROM transactions
        WHERE source_table = 'loto_tickets' AND source_id = ? AND type = 'LOTO'`,
    )
    .get(ticketId) as {
    id: number;
    amount_lbp: number;
    profit_usd: number;
    profit_lbp: number;
    metadata_json: string;
  };
}

/** The LOTO supplier's live balance (soft-voided rows drop out). */
function lotoSupplierLbp(): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(sl.amount_lbp), 0) AS bal FROM supplier_ledger sl
         JOIN suppliers s ON s.id = sl.supplier_id
        WHERE s.provider = 'LOTO' AND COALESCE(sl.is_refunded, 0) = 0`,
    )
    .get() as { bal: number };
  return row.bal;
}

function grossProfit(): { usd: number; lbp: number } {
  resetProfitRepository();
  resetProfitService();
  const t = getProfitService().getSummary(FROM, TO).totals;
  return { usd: t.gross_profit_usd, lbp: t.gross_profit_lbp };
}

describe("Loto ticket discount — sale (LIRA-310)", () => {
  it("lowers profit by the discount only; face value and the LOTO TOP_UP are unchanged", () => {
    const drawerBefore = drawer(db, "General", "LBP");
    const supplierBefore = lotoSupplierLbp();
    const profitBefore = grossProfit();

    const t = repo.createTicket(ticket());
    const txn = lotoTxn(t.id);

    expect(txn.amount_lbp).toBe(SALE);
    expect(txn.profit_lbp).toBe(COMMISSION - DISCOUNT); // 5,000
    expect(txn.profit_usd).toBe(0);
    expect(JSON.parse(txn.metadata_json).discount_lbp).toBe(DISCOUNT);

    // The cash actually handed over, never the face value.
    expect(drawer(db, "General", "LBP") - drawerBefore).toBe(SALE - DISCOUNT);
    // LOTO is owed exactly what it is owed without a discount.
    expect(lotoSupplierLbp() - supplierBefore).toBe(SALE - COMMISSION);
    // The Profits page reads the lowered stamp.
    expect(grossProfit().lbp - profitBefore.lbp).toBe(COMMISSION - DISCOUNT);
  });

  it("T024: the Loto page's kept-change figure does not read a discount as negative kept change", () => {
    repo.createTicket(ticket());
    expect(repo.getTotalKeptChange("2000-01-01", "2100-12-31")).toEqual({
      usd: 0,
      lbp: 0,
    });
  });
});

describe("Loto ticket discount — reversal nets to 0 (rule 20)", () => {
  it.each(["void", "refund"] as const)("%s: drawer, LOTO supplier and profit return to start", (how) => {
    const drawerBefore = drawer(db, "General", "LBP");
    const supplierBefore = lotoSupplierLbp();
    const profitBefore = grossProfit();

    const t = repo.createTicket(ticket());
    const txnId = lotoTxn(t.id).id;
    if (how === "void") getTransactionRepository().voidTransaction(txnId, 1);
    else getTransactionRepository().refundTransaction(txnId, 1);

    expect(drawer(db, "General", "LBP")).toBeCloseTo(drawerBefore, 6);
    expect(lotoSupplierLbp()).toBeCloseTo(supplierBefore, 6);
    const after = grossProfit();
    expect(after.lbp).toBeCloseTo(profitBefore.lbp, 6);
    expect(after.usd).toBeCloseTo(profitBefore.usd, 6);
  });
});

describe("Loto ticket discount — refusals", () => {
  it("a discount above the commission is refused", () => {
    expect(() =>
      repo.createTicket(
        ticket({
          discount_lbp: 30_000,
          payments: [{ method: "CASH", currencyCode: "LBP", amount: SALE - 30_000 }],
        }),
      ),
    ).toThrow(/more than the shop's commission/);
  });

  it("a discount that does not match the real gap is refused", () => {
    expect(() =>
      repo.createTicket(
        ticket({
          discount_lbp: 10_000,
          payments: [{ method: "CASH", currencyCode: "LBP", amount: SALE - 20_000 }],
        }),
      ),
    ).toThrow(/does not match what is left to pay/);
  });

  it("a discount on a session-cart (deferred) ticket is refused", () => {
    expect(() =>
      repo.createTicket(ticket({ deferPayment: true, payments: [] })),
    ).toThrow(/discount/i);
  });

  it("a discount on a partner ticket is refused (repository and schema)", () => {
    expect(() =>
      repo.createTicket(
        ticket({ partnerMode: "FOR", partnerId: 1, payments: [] }),
      ),
    ).toThrow(/partner/);
    const parsed = lotoSellSchema.safeParse({
      sale_amount: SALE,
      partnerMode: "FOR",
      partnerId: 1,
      discount_lbp: DISCOUNT,
    });
    expect(parsed.success).toBe(false);
  });

  it("a discount together with kept change is refused", () => {
    expect(() =>
      repo.createTicket(ticket({ kept_change_lbp: 1_000 })),
    ).toThrow(/can't be combined with change kept/);
  });

  it("the schema keeps discount_usd / discount_lbp (Zod would strip unknown keys — rule 23)", () => {
    const parsed = lotoSellSchema.parse({
      sale_amount: SALE,
      discount_lbp: DISCOUNT,
      discount_usd: 0,
    });
    expect(parsed).toMatchObject({ discount_lbp: DISCOUNT, discount_usd: 0 });
  });
});

describe("Loto ticket — the kept-change check now applies (R4 side effect)", () => {
  it("a phantom kept change on an exact payment is refused (was booked as profit before)", () => {
    // 4,000 LBP ≈ $0.045 at the test rate — inside reconcileLegs' $0.05
    // epsilon, so only the helper's excess check can catch it.
    expect(() =>
      repo.createTicket(
        ticket({
          discount_lbp: undefined,
          payments: [{ method: "CASH", currencyCode: "LBP", amount: SALE }],
          kept_change_lbp: 4_000,
        }),
      ),
    ).toThrow(/more than the change due/);
  });

  it("no discount, exact payment → the stamp is the commission (unchanged)", () => {
    const t = repo.createTicket(
      ticket({
        discount_lbp: undefined,
        payments: [{ method: "CASH", currencyCode: "LBP", amount: SALE }],
      }),
    );
    expect(lotoTxn(t.id).profit_lbp).toBe(COMMISSION);
  });
});

describe("Loto ticket discount — with change given back (typed discount)", () => {
  it("500,000 handed, 20,000 discount, 20,000 change → drawer +480,000, profit 5,000", () => {
    const drawerBefore = drawer(db, "General", "LBP");
    const t = repo.createTicket(
      ticket({
        payments: [
          { method: "CASH", currencyCode: "LBP", amount: SALE },
          { method: "CASH", currencyCode: "LBP", amount: DISCOUNT, direction: "OUT" },
        ],
      }),
    );
    expect(lotoTxn(t.id).profit_lbp).toBe(COMMISSION - DISCOUNT);
    expect(drawer(db, "General", "LBP") - drawerBefore).toBe(SALE - DISCOUNT);
  });

  it("…but a discount claim that does not match (IN − change) is still refused", () => {
    expect(() =>
      repo.createTicket(
        ticket({
          discount_lbp: 10_000,
          payments: [
            { method: "CASH", currencyCode: "LBP", amount: SALE },
            { method: "CASH", currencyCode: "LBP", amount: 20_000, direction: "OUT" },
          ],
        }),
      ),
    ).toThrow(/does not match what is left to pay/);
  });
});
