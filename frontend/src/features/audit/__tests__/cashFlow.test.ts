/**
 * C2 — OMT/WHISH in/out semantics (LEFT_TO_DO).
 *
 * The transactions-table badge direction for FINANCIAL_SERVICE must follow the
 * service direction: SEND/BILL take customer cash (in), RECEIVE pays the
 * customer out of the drawers (out). The pre-C2 code returned "in" for EVERY
 * FINANCIAL_SERVICE row — the RECEIVE cases below fail against it.
 */
import { getCashFlowDirection, isCashTransaction } from "../cashFlow";

const meta = (service_type: string) => JSON.stringify({ service_type });

describe("getCashFlowDirection — FINANCIAL_SERVICE service_type branch", () => {
  it("SEND is cash in (customer pays us)", () => {
    expect(getCashFlowDirection("FINANCIAL_SERVICE", meta("SEND"))).toBe("in");
  });

  it("RECEIVE is cash out (shop pays the customer)", () => {
    expect(getCashFlowDirection("FINANCIAL_SERVICE", meta("RECEIVE"))).toBe(
      "out",
    );
  });

  it("BILL is cash in (customer pays for the bill)", () => {
    expect(getCashFlowDirection("FINANCIAL_SERVICE", meta("BILL"))).toBe("in");
  });

  it("falls back to 'in' when metadata is missing or malformed", () => {
    expect(getCashFlowDirection("FINANCIAL_SERVICE", null)).toBe("in");
    expect(getCashFlowDirection("FINANCIAL_SERVICE", undefined)).toBe("in");
    expect(getCashFlowDirection("FINANCIAL_SERVICE", "not-json{")).toBe("in");
    expect(getCashFlowDirection("FINANCIAL_SERVICE", "{}")).toBe("in");
  });
});

describe("getCashFlowDirection — unchanged types (guard against regressions)", () => {
  it.each([
    ["SALE", "in"],
    ["RECHARGE", "in"],
    ["DEBT_REPAYMENT", "in"],
    ["EXPENSE", "out"],
    ["LOTO_SETTLEMENT", "out"],
    ["EXCHANGE", "both"],
    // Same-shop transfer — funding drawer −, OMT_System/Whish_System + — has
    // no single customer-facing direction, same "both" treatment as EXCHANGE.
    ["SYSTEM_FLOAT_TOPUP", "both"],
    // B7: loto rows were unmapped → blank badge on every ticket sale / payout
    ["LOTO", "in"],
    ["LOTO_CASH_PRIZE", "out"],
    // Cash Out — owner's draw pulls physical cash OUT of the General drawer.
    ["DRAWER_CASHOUT", "out"],
  ] as const)("%s → %s", (type, expected) => {
    expect(getCashFlowDirection(type)).toBe(expected);
  });

  it("RECHARGE_TOPUP: 'out' from drawer, 'in' when partner/client funded", () => {
    expect(getCashFlowDirection("RECHARGE_TOPUP")).toBe("out");
    expect(
      getCashFlowDirection("RECHARGE_TOPUP", JSON.stringify({ partnerId: 3 })),
    ).toBe("in");
    expect(
      getCashFlowDirection("RECHARGE_TOPUP", JSON.stringify({ cashPaid: 10 })),
    ).toBe("in");
  });

  it("unknown types render no badge", () => {
    expect(getCashFlowDirection("CLIENT_CREATED")).toBeNull();
  });

  // CQ-10: COUNTERPARTY_DISCOUNT rows always carry amounts of 0 (the value
  // lives in signed profit_usd/lbp) — no cash physically moved, so the
  // viewer must fall through to the default "no badge" case, same as any
  // other unmapped type, rather than crashing or guessing a direction.
  it("COUNTERPARTY_DISCOUNT renders no badge (no cash moves — value is in profit, not amount)", () => {
    expect(getCashFlowDirection("COUNTERPARTY_DISCOUNT")).toBeNull();
    expect(
      getCashFlowDirection("COUNTERPARTY_DISCOUNT", JSON.stringify({})),
    ).toBeNull();
  });

  // LIRA-066: the paper (no-cash) Partners-page "Record Tx" entry. Unlike
  // PARTNER_SETTLEMENT/PARTNER_PAYMENT it never moves a drawer, so — same
  // rationale as COUNTERPARTY_DISCOUNT above — it must render no badge
  // regardless of its metadata.counterparty.flow or signed amount.
  it("PARTNER_ADJUSTMENT renders no badge (no cash moves — paper entry)", () => {
    expect(getCashFlowDirection("PARTNER_ADJUSTMENT")).toBeNull();
    expect(
      getCashFlowDirection(
        "PARTNER_ADJUSTMENT",
        JSON.stringify({ counterparty: { flow: "IN" } }),
        { usd: 250, lbp: 0 },
      ),
    ).toBeNull();
  });
});

/**
 * SUPPLIER_PAYMENT direction (owner-reported 2026-07-28): a manual Suppliers-page
 * PAY rendered the green ↓ "cash in" badge while its own payment-legs subtext read
 * "out: $2,000" — the type was in the hardcoded "in" list, so half its rows were
 * always wrong. Direction comes from the CQ-8 counterparty contract
 * (SupplierRepository.recordSupplierCashflow stamps flow OUT for PAY / IN for
 * RECEIVE) with `metadata.direction` as the secondary read. The PAY/OUT cases
 * below fail against the pre-fix code (rule 17).
 */
describe("getCashFlowDirection — SUPPLIER_PAYMENT (both directions)", () => {
  it("PAY is cash out (shop pays the supplier out of the drawer)", () => {
    expect(
      getCashFlowDirection(
        "SUPPLIER_PAYMENT",
        JSON.stringify({
          supplier_id: 1,
          direction: "PAY",
          counterparty: { flow: "OUT", method: "CASH" },
        }),
        { usd: 2000, lbp: 0 },
      ),
    ).toBe("out");
  });

  it("RECEIVE is cash in (supplier pays the shop back)", () => {
    expect(
      getCashFlowDirection(
        "SUPPLIER_PAYMENT",
        JSON.stringify({
          supplier_id: 1,
          direction: "RECEIVE",
          counterparty: { flow: "IN", method: "CASH" },
        }),
        { usd: 2000, lbp: 0 },
      ),
    ).toBe("in");
  });

  it("resolves from metadata.direction alone when no counterparty block exists", () => {
    expect(
      getCashFlowDirection(
        "SUPPLIER_PAYMENT",
        JSON.stringify({ supplier_id: 1, direction: "PAY" }),
      ),
    ).toBe("out");
    expect(
      getCashFlowDirection(
        "SUPPLIER_PAYMENT",
        JSON.stringify({ supplier_id: 1, direction: "RECEIVE" }),
      ),
    ).toBe("in");
  });

  it("counterparty.flow wins over metadata.direction", () => {
    expect(
      getCashFlowDirection(
        "SUPPLIER_PAYMENT",
        JSON.stringify({ direction: "RECEIVE", counterparty: { flow: "OUT" } }),
      ),
    ).toBe("out");
  });

  // The addLedgerEntry no-drawer branch stamps flow from the ledger sign
  // (PAYMENT → OUT, SUPPLIER_PAYS_US → IN, other accruals by sign) — auto rows
  // are filter-hidden by default but must still badge consistently when shown.
  it("auto ledger rows follow their stamped flow", () => {
    expect(
      getCashFlowDirection(
        "SUPPLIER_PAYMENT",
        JSON.stringify({
          is_auto: true,
          entry_type: "PAYMENT",
          counterparty: { flow: "OUT", method: "LEDGER" },
        }),
      ),
    ).toBe("out");
    expect(
      getCashFlowDirection(
        "SUPPLIER_PAYMENT",
        JSON.stringify({
          is_auto: true,
          entry_type: "TOP_UP",
          counterparty: { flow: "IN", method: "LEDGER" },
        }),
      ),
    ).toBe("in");
  });

  it("historical rows with neither marker keep the legacy 'in' default", () => {
    expect(getCashFlowDirection("SUPPLIER_PAYMENT")).toBe("in");
    expect(getCashFlowDirection("SUPPLIER_PAYMENT", null)).toBe("in");
    expect(getCashFlowDirection("SUPPLIER_PAYMENT", "not-json{")).toBe("in");
    expect(
      getCashFlowDirection("SUPPLIER_PAYMENT", JSON.stringify({ supplier_id: 1 })),
    ).toBe("in");
  });
});

describe("getCashFlowDirection — PARTNER_SETTLEMENT / PARTNER_PAYMENT (CQ-8)", () => {
  const flowMeta = (flow: "IN" | "OUT") =>
    JSON.stringify({ counterparty: { flow } });

  it.each(["PARTNER_SETTLEMENT", "PARTNER_PAYMENT"] as const)(
    "%s: metadata.counterparty.flow IN → in",
    (type) => {
      expect(getCashFlowDirection(type, flowMeta("IN"))).toBe("in");
    },
  );

  it.each(["PARTNER_SETTLEMENT", "PARTNER_PAYMENT"] as const)(
    "%s: metadata.counterparty.flow OUT → out",
    (type) => {
      expect(getCashFlowDirection(type, flowMeta("OUT"))).toBe("out");
    },
  );

  it.each(["PARTNER_SETTLEMENT", "PARTNER_PAYMENT"] as const)(
    "%s: no counterparty metadata falls back to the sign of amount_usd (historical rows)",
    (type) => {
      expect(getCashFlowDirection(type, null, { usd: 25, lbp: 0 })).toBe("in");
      expect(getCashFlowDirection(type, null, { usd: -25, lbp: 0 })).toBe(
        "out",
      );
    },
  );

  it.each(["PARTNER_SETTLEMENT", "PARTNER_PAYMENT"] as const)(
    "%s: sign fallback also reads amount_lbp when amount_usd is 0",
    (type) => {
      expect(getCashFlowDirection(type, null, { usd: 0, lbp: 900000 })).toBe(
        "in",
      );
      expect(getCashFlowDirection(type, null, { usd: 0, lbp: -900000 })).toBe(
        "out",
      );
    },
  );

  it("metadata.counterparty.flow takes precedence over the amount sign", () => {
    expect(
      getCashFlowDirection("PARTNER_SETTLEMENT", flowMeta("IN"), {
        usd: -5,
        lbp: 0,
      }),
    ).toBe("in");
    expect(
      getCashFlowDirection("PARTNER_PAYMENT", flowMeta("OUT"), {
        usd: 5,
        lbp: 0,
      }),
    ).toBe("out");
  });

  it("no metadata and no signed amounts → null (no badge, never crashes)", () => {
    expect(getCashFlowDirection("PARTNER_SETTLEMENT", null)).toBeNull();
    expect(getCashFlowDirection("PARTNER_PAYMENT", "not-json{")).toBeNull();
    expect(
      getCashFlowDirection("PARTNER_SETTLEMENT", null, { usd: 0, lbp: 0 }),
    ).toBeNull();
  });

  // LIRA-066 residual fix: a CLIENT_ACCOUNT settlement moves no real drawer
  // cash even though metadata.counterparty.flow is still stamped (IN/OUT) —
  // the method override must win over flow so the badge stays blank, same
  // "no cash, no arrow" treatment PARTNER_ADJUSTMENT already gets.
  it("metadata.counterparty.method CLIENT_ACCOUNT → null, even with flow set", () => {
    const clientAccountMeta = (flow: "IN" | "OUT") =>
      JSON.stringify({ counterparty: { flow, method: "CLIENT_ACCOUNT" } });
    expect(
      getCashFlowDirection("PARTNER_SETTLEMENT", clientAccountMeta("IN")),
    ).toBeNull();
    expect(
      getCashFlowDirection("PARTNER_SETTLEMENT", clientAccountMeta("OUT")),
    ).toBeNull();
    expect(
      getCashFlowDirection("PARTNER_PAYMENT", clientAccountMeta("IN")),
    ).toBeNull();
  });
});

describe("isCashTransaction — the 'Cash only (till)' filter predicate (B6)", () => {
  it("true when any leg is CASH", () => {
    expect(isCashTransaction([{ method: "CASH" }])).toBe(true);
    expect(isCashTransaction([{ method: "OMT" }, { method: "CASH" }])).toBe(
      true,
    );
  });

  it("false for wallet-only / on-account / empty transactions", () => {
    expect(isCashTransaction([{ method: "OMT" }])).toBe(false);
    expect(isCashTransaction([{ method: "WHISH" }])).toBe(false);
    expect(isCashTransaction([])).toBe(false);
    expect(isCashTransaction(undefined)).toBe(false);
  });
});
