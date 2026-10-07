/**
 * Production test 2026-10-07 — the Transactions table showed the CASH HANDED
 * as the row's amount instead of the transaction's own value:
 *
 *   - Sale #99 ($4.25, customer paid $5, $0.50 change, $0.25 kept) read "$5";
 *   - its void read "$0.5" (looked like a 50-cent void);
 *   - its refund read "$-4.25" + "out: $4", with no mention of the $0.25 kept.
 *
 * The books were right — only the presentation was wrong. These pin the new
 * display contract: the main figure is the transaction amount (signed, with a
 * real minus sign), and the cash that moved is a secondary line in words.
 *
 * Every figure below is built from the field names the row type declares
 * (rule 24): kept change on a REFUND comes from core's own
 * `REFUND_KEPT_CHANGE_META` keys, never a hand-typed string.
 */
import { REFUND_KEPT_CHANGE_META } from "@liratek/core";
import type { TransactionPaymentLeg } from "../cashFlow";
import { amountSortValue } from "../amountSort";
import {
  cashMovementLine,
  displayAmountFields,
  displaySummary,
  formatAmount,
} from "../transactionDisplay";
import type { TransactionRow } from "../hooks/useTransactionRows";

function leg(
  direction: "in" | "out",
  amount: number,
  currency_code = "USD",
): TransactionPaymentLeg {
  return {
    direction,
    amount,
    signed_amount: direction === "out" ? -amount : amount,
    currency_code,
    method: "CASH",
    drawer_name: "General",
  };
}

function row(overrides: Partial<TransactionRow>): TransactionRow {
  return {
    id: 1,
    type: "SALE",
    status: "ACTIVE",
    source_table: "sales",
    source_id: 99,
    user_id: 1,
    amount_usd: 0,
    amount_lbp: 0,
    exchange_rate: null,
    client_id: null,
    reverses_id: null,
    summary: null,
    metadata_json: null,
    device_id: null,
    created_at: "2026-10-07 10:00:00",
    username: "admin",
    client_name: null,
    session_id: null,
    payments: [],
    ...overrides,
  };
}

// Sale #99 and the two rows that reverse it, as the repositories write them:
// the void copies type + metadata and negates amounts and every leg; the
// refund is a REFUND row with the negated value and its own handed-back leg.
const sale = row({
  id: 99,
  amount_usd: 4.25,
  payments: [leg("in", 5), leg("out", 0.5)],
  // The sale's OWN kept change lives here; a refund inherits this metadata.
  metadata_json: JSON.stringify({ kept_change_usd: 0.25 }),
});
const saleVoid = row({
  id: 100,
  amount_usd: -4.25,
  reverses_id: 99,
  payments: [leg("out", 5), leg("in", 0.5)],
  metadata_json: sale.metadata_json,
});
const saleRefund = row({
  id: 101,
  type: "REFUND",
  amount_usd: -4.25,
  reverses_id: 99,
  payments: [leg("out", 4)],
  metadata_json: JSON.stringify({
    kept_change_usd: 0.25,
    [REFUND_KEPT_CHANGE_META.usd]: 0.25,
  }),
});

describe("formatAmount — negative amounts", () => {
  it("renders a real minus sign before the currency, never `$-4.25`", () => {
    expect(formatAmount(-4.25, 0)).toBe("−$4.25");
    expect(formatAmount(0, -450000)).toBe("−450,000 LBP");
  });

  it("leaves positive amounts unchanged", () => {
    expect(formatAmount(4.25, 0)).toBe("$4.25");
    expect(formatAmount(5, 450000)).toBe("$5 + 450,000 LBP");
  });
});

describe("displayAmountFields — the main figure is the transaction amount", () => {
  it("a sale shows its value ($4.25), not the $5 the customer handed over", () => {
    expect(displayAmountFields(sale)).toEqual({ usd: 4.25, lbp: 0 });
  });

  it("a sale's void shows the reversed value (−$4.25), not the $0.50 change leg", () => {
    expect(formatAmount(...fields(saleVoid))).toBe("−$4.25");
  });

  it("a refund shows the reversed value (−$4.25)", () => {
    expect(formatAmount(...fields(saleRefund))).toBe("−$4.25");
  });

  it("a legacy sale that stamped its LBP tender alongside the USD value shows the USD value only", () => {
    // Pre-value-not-tender rows wrote the LBP handed over into amount_lbp;
    // sales are USD-priced, so the LBP half is cash, not value.
    const legacy = row({ amount_usd: 5, amount_lbp: 450000 });
    expect(displayAmountFields(legacy)).toEqual({ usd: 5, lbp: 0 });
  });

  function fields(r: TransactionRow): [number, number] {
    const f = displayAmountFields(r);
    return [f.usd, f.lbp];
  }
});

describe("cashMovementLine — the cash that moved, in words", () => {
  it("sale: paid and change given", () => {
    expect(cashMovementLine(sale)).toBe("paid $5.00 · change $0.50");
  });

  it("void of a sale: what went back to the customer and the change that came back", () => {
    expect(cashMovementLine(saleVoid)).toBe(
      "handed back $5.00 · change taken back $0.50",
    );
  });

  it("refund: handed back, plus the change the shop kept on the refund", () => {
    expect(cashMovementLine(saleRefund)).toBe("handed back $4.00 · kept $0.25");
  });

  it("refund that kept nothing does NOT report the original sale's kept change", () => {
    // The REFUND row copies the original's metadata, so `kept_change_usd`
    // there is the SALE's kept change — reading it would invent a kept
    // amount on a refund that handed back everything.
    const fullRefund = row({
      ...saleRefund,
      payments: [leg("out", 4.25)],
      metadata_json: JSON.stringify({ kept_change_usd: 0.25 }),
    });
    expect(cashMovementLine(fullRefund)).toBe("handed back $4.25");
  });

  it("item refund (fresh metadata, plain kept_change_* keys) also reports what it kept", () => {
    // SalesRepository.refundSaleItem / the session item refund write their
    // OWN metadata (refundType "item"/"sessionItem") with kept_change_*,
    // not the refund_kept_change_* keys of the whole-transaction refund.
    for (const refundType of ["item", "sessionItem"]) {
      const itemRefund = row({
        ...saleRefund,
        metadata_json: JSON.stringify({ refundType, kept_change_usd: 0.25 }),
      });
      expect(cashMovementLine(itemRefund)).toBe(
        "handed back $4.00 · kept $0.25",
      );
    }
  });

  it("mixed currencies are joined per side", () => {
    const lbpSale = row({
      amount_usd: 10,
      payments: [leg("in", 5), leg("in", 450000, "LBP"), leg("out", 0.5)],
    });
    expect(cashMovementLine(lbpSale)).toBe(
      "paid $5.00 + 450,000 LBP · change $0.50",
    );
  });

  it("returns null for types it does not describe, and for a row with no cash legs", () => {
    expect(
      cashMovementLine(row({ type: "RECHARGE", payments: [leg("in", 5)] })),
    ).toBeNull();
    expect(
      cashMovementLine(row({ amount_usd: 4.25, payments: [] })),
    ).toBeNull();
  });
});

describe("displaySummary — auto supplier TOP_UP rows are labelled by meaning", () => {
  const omtTopUp = (amount_usd: number, extra: Partial<TransactionRow> = {}) =>
    row({
      type: "SUPPLIER_PAYMENT",
      source_table: "supplier_ledger",
      amount_usd,
      summary: `Supplier TOP_UP: $${amount_usd} + 0 LBP`,
      metadata_json: JSON.stringify({
        supplier_id: 3,
        entry_type: "TOP_UP",
        counterparty: {
          kind: "supplier",
          id: 3,
          name: "OMT",
          flow: amount_usd < 0 ? "OUT" : "IN",
          method: "LEDGER",
        },
        is_auto: true,
      }),
      ...extra,
    });

  it("a RECEIVE's auto row (negative TOP_UP) reads 'Owed to OMT reduced'", () => {
    expect(displaySummary(omtTopUp(-100))).toBe(
      "Owed to OMT reduced by $100.00",
    );
  });

  it("a SEND's auto row (positive TOP_UP) reads 'Owed to OMT increased' — same wording family", () => {
    expect(displaySummary(omtTopUp(105))).toBe(
      "Owed to OMT increased by $105.00",
    );
  });

  it("keeps a VOID:/REFUND: prefix the stored summary carried", () => {
    expect(
      displaySummary(
        omtTopUp(-105, {
          reverses_id: 7,
          summary: "VOID: Supplier TOP_UP: $105 + 0 LBP",
        }),
      ),
    ).toBe("VOID: Owed to OMT reduced by $105.00");
  });

  it("leaves every other row's stored summary untouched", () => {
    expect(displaySummary(sale)).toBeNull();
    const manualPayment = row({
      type: "SUPPLIER_PAYMENT",
      summary: "Supplier Payment: $50 + 0 LBP — paid to OMT",
      metadata_json: JSON.stringify({ entry_type: "PAYMENT" }),
    });
    expect(displaySummary(manualPayment)).toBe(manualPayment.summary);
  });
});

describe("amountSortValue — sorts on the figure the column shows", () => {
  // Written after the fix (not proven failing-first): before, the column
  // showed the tender while the sort used usd + lbp, so they disagreed.
  it("a legacy sale with a stamped LBP tender sorts by its USD value only", () => {
    const legacy = row({
      amount_usd: 5,
      amount_lbp: 450000,
      exchange_rate: 90000,
    });
    expect(amountSortValue(legacy, 89000)).toBe(5);
  });

  it("a void sorts by its negated value", () => {
    expect(amountSortValue(saleVoid, 89000)).toBe(-4.25);
  });
});
