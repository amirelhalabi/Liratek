/**
 * LIRA-388 (T002) — the ONE refund classification the service and the
 * Transactions page both read. Written before `refundKinds.ts` exists
 * (rule 17); built from the spec's NAMED lists, never from a count.
 */
import {
  TRANSACTION_TYPES,
  NON_REVERSIBLE_TRANSACTION_TYPES,
  type TransactionType,
} from "../transactionTypes";
import {
  NON_REFUNDABLE_TRANSACTION_TYPES,
  REFUND_OWNERS,
  refundPlanOf,
} from "../refundKinds";
import * as browserEntry from "../../browser";

/** User Story 5 — the structural rows. */
const STRUCTURAL: TransactionType[] = [
  "REFUND",
  "REFUND_UNDO",
  "VOUCHER_CANCEL",
  "HOLD_MONEY_COLLECT_VOID",
  "KEPT_CHANGE",
  "WAIVED_SHORTFALL",
  "EXTRA_CHARGE",
  "BASKET_DISCOUNT",
  "CHECKPOINT",
  "LOTO_SETTLEMENT",
  "CLIENT_CREATED",
  "CLIENT_UPDATED",
  "CLIENT_DELETED",
];
/** Decision (spec → Decisions): legacy-only, kept refused with a true reason. */
const LEGACY_REFUSED: TransactionType[] = ["MTC_TOPUP", "ALFA_TOPUP"];

/** FR-003 + FR-004 minus the two legacy top-ups. */
const WINDOW_TO_CUSTOMER: TransactionType[] = [
  "CREDIT_CASH_IN",
  "HOLD_MONEY",
  "VOUCHER_SALE",
];
const WINDOW_FROM_CUSTOMER: TransactionType[] = [
  "LOTO_CASH_PRIZE",
  "CREDIT_CASH_OUT",
  "DEBT_CASH_OUT",
];
const CONFIRM: TransactionType[] = [
  "HOLD_MONEY_COLLECT",
  "WARRANTY_COST",
  "DRAWER_TOPUP",
  "DRAWER_CASHOUT",
  "PARTNER_ADJUSTMENT",
  "ACCOUNT_ADJUSTMENT",
  "SUPPLIER_ADJUSTMENT",
  "COUNTERPARTY_DISCOUNT",
  "LOTO_MONTHLY_FEE",
  "CARRIER_LINE_ADJUSTMENT",
];
const OWNED = [...WINDOW_TO_CUSTOMER, ...WINDOW_FROM_CUSTOMER, ...CONFIRM];

const row = (type: string, extra: Record<string, unknown> = {}) => ({
  type,
  reverses_id: null,
  metadata_json: null as string | null,
  amount_usd: 1,
  amount_lbp: 0,
  ...extra,
});

describe("LIRA-388 refund classification", () => {
  it("the non-refundable set is exactly the structural types plus the two legacy top-ups", () => {
    expect([...NON_REFUNDABLE_TRANSACTION_TYPES].sort()).toEqual(
      [...STRUCTURAL, ...LEGACY_REFUSED].sort(),
    );
  });

  it("every owned type stays behind the raw-void gate", () => {
    for (const t of OWNED) {
      expect(NON_REVERSIBLE_TRANSACTION_TYPES.has(t)).toBe(true);
      expect(REFUND_OWNERS[t]).toBeDefined();
    }
    // 31 = structural + legacy + owned; nothing else is in the gate.
    expect(NON_REVERSIBLE_TRANSACTION_TYPES.size).toBe(
      STRUCTURAL.length + LEGACY_REFUSED.length + OWNED.length,
    );
  });

  it("every TransactionType has a plan; only the non-refundable ones plan none", () => {
    const carrierMeta = JSON.stringify({
      reason: "edited",
      credits_before: 10,
      credits_after: 15,
    });
    for (const t of Object.values(TRANSACTION_TYPES)) {
      const plan = refundPlanOf(
        row(
          t,
          t === "CARRIER_LINE_ADJUSTMENT" ? { metadata_json: carrierMeta } : {},
        ),
      );
      if (NON_REFUNDABLE_TRANSACTION_TYPES.has(t)) {
        expect({ t, kind: plan.kind }).toEqual({ t, kind: "none" });
        expect(plan.reason).toBeTruthy();
      } else {
        expect({ t, none: plan.kind === "none" }).toEqual({ t, none: false });
      }
    }
  });

  it("customer-money rows open the window in the right direction", () => {
    for (const t of WINDOW_TO_CUSTOMER) {
      expect(refundPlanOf(row(t))).toMatchObject({
        kind: "window",
        direction: "to_customer",
      });
    }
    for (const t of WINDOW_FROM_CUSTOMER) {
      expect(refundPlanOf(row(t))).toMatchObject({
        kind: "window",
        direction: "from_customer",
      });
    }
  });

  it("bookkeeping and page-owned no-method rows are a one-line confirm", () => {
    const carrierMeta = JSON.stringify({
      reason: "quick-update",
      credits_before: 3,
      credits_after: 9,
    });
    for (const t of CONFIRM) {
      expect(
        refundPlanOf(
          row(
            t,
            t === "CARRIER_LINE_ADJUSTMENT"
              ? { metadata_json: carrierMeta }
              : {},
          ),
        ).kind,
      ).toBe("confirm");
    }
  });

  it("page-owned owners are named", () => {
    expect(REFUND_OWNERS.HOLD_MONEY_COLLECT?.owner).toBe("holdPickup");
    expect(REFUND_OWNERS.VOUCHER_SALE?.owner).toBe("voucher");
    expect(REFUND_OWNERS.WARRANTY_COST?.owner).toBe("warranty");
    expect(REFUND_OWNERS.LOTO_CASH_PRIZE?.owner).toBe("generic");
  });

  it("a carrier-line edit without stored before/after values keeps a true reason", () => {
    const plan = refundPlanOf(
      row("CARRIER_LINE_ADJUSTMENT", {
        metadata_json: JSON.stringify({ reason: "edited" }),
      }),
    );
    expect(plan.kind).toBe("none");
    expect(plan.reason).toBe("carrierLineNoValues");
    // a status toggle never had credits to put back
    expect(
      refundPlanOf(
        row("CARRIER_LINE_ADJUSTMENT", {
          metadata_json: JSON.stringify({
            reason: "deactivated",
            credits_before: 1,
            credits_after: 0,
          }),
        }),
      ).kind,
    ).toBe("none");
  });

  it("a reversal row is never refundable", () => {
    expect(refundPlanOf(row("SALE", { reverses_id: 5 })).kind).toBe("none");
    expect(refundPlanOf(row("WARRANTY_COST", { reverses_id: 5 })).kind).toBe(
      "none",
    );
  });

  it("generic reversible types open the window", () => {
    expect(refundPlanOf(row("SALE"))).toMatchObject({
      kind: "window",
      owner: "generic",
    });
  });

  it("is reachable from the browser entry (rule 29)", () => {
    expect(typeof (browserEntry as Record<string, unknown>).refundPlanOf).toBe(
      "function",
    );
  });
});
