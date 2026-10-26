/**
 * LIRA-346 — the ONE payload builder for "settle picked days" on the
 * Partners page (rule 22): the calendar sheet and "Settle old history up
 * to…" both build their request here.
 *
 * Every payload is parsed through the core `partnerSettleDaysSchema`
 * (rule 24: the field names come from the schema, never hand-typed), and
 * the selection is compared against core's `buildDaySelections` on the same
 * rows.
 *
 * Failing-first (rule 17): written before `partnerSettleDaysPayload.ts`
 * existed.
 */
import {
  buildDaySelections,
  partnerSettleDaysSchema,
  type PartnerSettleRow,
} from "@liratek/core";
import {
  buildPartnerOldHistoryPayload,
  buildPartnerSettleDaysPayload,
  oldHistoryWouldSettle,
  planPartnerSettle,
} from "../partnerSettleDaysPayload";

function row(
  over: Partial<PartnerSettleRow> &
    Pick<PartnerSettleRow, "id" | "shop_day">,
): PartnerSettleRow {
  const usd = over.amount_usd ?? 0;
  const lbp = over.amount_lbp ?? 0;
  return {
    kind: "LEDGER",
    partner_id: 7,
    currency: lbp !== 0 ? "LBP" : "USD",
    transaction_type: "FOR_POS",
    direction: usd + lbp >= 0 ? "DEBIT" : "CREDIT",
    reference_table: null,
    reference_id: null,
    notes: null,
    source_txn_id: null,
    created_at: `${over.shop_day} 09:00:00`,
    covered_usd: 0,
    covered_lbp: 0,
    remaining_usd: usd,
    remaining_lbp: lbp,
    row_scope: "DAY",
    unit_class: "DAY",
    relief_origin: null,
    relief_ref: null,
    ...over,
    amount_usd: usd,
    amount_lbp: lbp,
  };
}

// P2 (spec 346): For +$100 on 20 Oct (the partner owes the shop), Through
// −$300 on 21 Oct (the shop owes the partner). Net: the shop pays $200.
const FOR_20 = row({ id: 11, shop_day: "2026-10-20", amount_usd: 100 });
const THROUGH_21 = row({
  id: 12,
  shop_day: "2026-10-21",
  amount_usd: -300,
  transaction_type: "THROUGH_OMT_SEND",
});
const LBP_22 = row({ id: 13, shop_day: "2026-10-22", amount_lbp: 450000 });
// Partner credit: an overpay from an earlier settlement (sits on no day).
const CREDIT = row({
  id: 30,
  shop_day: "2026-10-01",
  amount_usd: -50,
  transaction_type: "SETTLEMENT",
  row_scope: "ACCOUNT",
  unit_class: "PAYER",
});

const parse = (p: unknown) => partnerSettleDaysSchema.parse(p);

describe("planPartnerSettle / buildPartnerSettleDaysPayload (LIRA-346)", () => {
  it("P2: For +100 and Through −300 settle together — one USD section, the shop pays 200", () => {
    const rows = [FOR_20, THROUGH_21];
    const plan = planPartnerSettle(rows, {
      pickedDays: ["2026-10-20", "2026-10-21"],
    });
    expect(plan.currencies.USD.payer).toBe("SHOP");
    expect(plan.currencies.USD.prefill).toBe(-200);
    expect(plan.currencies.LBP.touched).toBe(false);

    const payload = parse(
      buildPartnerSettleDaysPayload({
        partnerId: 7,
        openRows: rows,
        pickedDays: ["2026-10-20", "2026-10-21"],
        money: {
          USD: { lines: [{ method: "CASH", currencyCode: "USD", amount: 200 }] },
        },
        exchangeRate: 89000,
      }),
    );
    expect(payload.partnerId).toBe(7);
    expect(payload.selections).toEqual([11, 12]);
    expect(payload.include_account_credits).toBe(true);
    expect(payload.expected_owed).toEqual({ usd: -200, lbp: 0 });
    expect(payload.per_currency.USD).toEqual({
      payer: "SHOP",
      payments: [{ method: "CASH", currency_code: "USD", amount: 200 }],
    });
    expect(payload.per_currency.LBP).toBeUndefined();
    expect(payload.exchange_rate).toBe(89000);
    // Same selection as the core builder on the same rows (rule 22).
    const core = buildDaySelections(rows, {
      pickedDays: ["2026-10-20", "2026-10-21"],
    });
    expect(payload.selections).toEqual(core.selections.map((s) => s.id));
    expect(payload.expected_owed).toEqual(core.expected_owed);
  });

  it("skipping a day leaves its rows out; the partner pays", () => {
    const rows = [FOR_20, THROUGH_21];
    const payload = parse(
      buildPartnerSettleDaysPayload({
        partnerId: 7,
        openRows: rows,
        pickedDays: ["2026-10-20"],
        money: {
          USD: { lines: [{ method: "CASH", currencyCode: "USD", amount: 100 }] },
        },
      }),
    );
    expect(payload.selections).toEqual([11]);
    expect(payload.per_currency.USD?.payer).toBe("PARTNER");
    expect(payload.expected_owed).toEqual({ usd: 100, lbp: 0 });
  });

  it("an unticked row of a picked day is left out", () => {
    const rows = [FOR_20, THROUGH_21];
    const payload = parse(
      buildPartnerSettleDaysPayload({
        partnerId: 7,
        openRows: rows,
        pickedDays: ["2026-10-20", "2026-10-21"],
        untickedRows: new Set(["LEDGER:12"]),
        money: {
          USD: { lines: [{ method: "CASH", currencyCode: "USD", amount: 100 }] },
        },
      }),
    );
    expect(payload.selections).toEqual([11]);
    expect(payload.per_currency.USD?.payer).toBe("PARTNER");
  });

  it("partner credit: pre-filled with min(owed, credit), sent as credit_used, payment pre-fill follows", () => {
    const rows = [FOR_20, CREDIT];
    const plan = planPartnerSettle(rows, { pickedDays: ["2026-10-20"] });
    expect(plan.currencies.USD.creditTotal).toBe(50);
    expect(plan.currencies.USD.creditUsed).toBe(50);
    expect(plan.currencies.USD.prefill).toBe(50);

    const payload = parse(
      buildPartnerSettleDaysPayload({
        partnerId: 7,
        openRows: rows,
        pickedDays: ["2026-10-20"],
        money: {
          USD: { lines: [{ method: "CASH", currencyCode: "USD", amount: 50 }] },
        },
      }),
    );
    expect(payload.credit_used).toEqual({ usd: 50, lbp: 0 });
    expect(payload.include_account_credits).toBe(true);
    // expected_owed = picked days + every open account row (signed).
    expect(payload.expected_owed).toEqual({ usd: 50, lbp: 0 });
  });

  it("a typed credit is clamped to what may be used", () => {
    const plan = planPartnerSettle([FOR_20, CREDIT], {
      pickedDays: ["2026-10-20"],
      creditUsed: { usd: 80 },
    });
    expect(plan.currencies.USD.creditUsed).toBe(50);
    const lower = planPartnerSettle([FOR_20, CREDIT], {
      pickedDays: ["2026-10-20"],
      creditUsed: { usd: 20 },
    });
    expect(lower.currencies.USD.creditUsed).toBe(20);
    expect(lower.currencies.USD.prefill).toBe(80);
  });

  it("change handed back goes as OUT legs; forgive only when the partner pays", () => {
    const rows = [FOR_20, LBP_22];
    const payload = parse(
      buildPartnerSettleDaysPayload({
        partnerId: 7,
        openRows: rows,
        pickedDays: ["2026-10-20", "2026-10-22"],
        money: {
          USD: {
            lines: [{ method: "CASH", currencyCode: "USD", amount: 100 }],
            returnLegs: [{ method: "CASH", currencyCode: "USD", amount: 20 }],
            forgive: { amount: 20, reason: " Goodwill " },
          },
          LBP: {
            lines: [{ method: "CASH", currencyCode: "LBP", amount: 450000 }],
          },
        },
        notes: " Week 43 ",
      }),
    );
    expect(payload.per_currency.USD).toEqual({
      payer: "PARTNER",
      payments: [
        { method: "CASH", currency_code: "USD", amount: 100 },
        { method: "CASH", currency_code: "USD", amount: 20, direction: "OUT" },
      ],
      forgive: { amount: 20, reason: "Goodwill" },
    });
    expect(payload.per_currency.LBP?.payments).toEqual([
      { method: "CASH", currency_code: "LBP", amount: 450000 },
    ]);
    expect(payload.notes).toBe("Week 43");

    // The shop pays: a forgive typed earlier is never sent.
    const shopPays = parse(
      buildPartnerSettleDaysPayload({
        partnerId: 7,
        openRows: [FOR_20, THROUGH_21],
        pickedDays: ["2026-10-20", "2026-10-21"],
        money: {
          USD: {
            lines: [{ method: "CASH", currencyCode: "USD", amount: 200 }],
            forgive: { amount: 5 },
          },
        },
      }),
    );
    expect(shopPays.per_currency.USD?.forgive).toBeUndefined();
  });

  it("netting that closes everything with no money still sends the section, with no payments", () => {
    const even = row({
      id: 14,
      shop_day: "2026-10-21",
      amount_usd: -100,
      transaction_type: "THROUGH_OMT_SEND",
    });
    const payload = parse(
      buildPartnerSettleDaysPayload({
        partnerId: 7,
        openRows: [FOR_20, even],
        pickedDays: ["2026-10-20", "2026-10-21"],
      }),
    );
    expect(payload.selections).toEqual([11, 14]);
    expect(payload.per_currency.USD).toEqual({ payer: "PARTNER", payments: [] });
  });

  it("old history: every open day up to the date, credit only where the days owe, no money", () => {
    const old = row({ id: 9, shop_day: "2026-09-01", amount_usd: 40 });
    const rows = [old, FOR_20, CREDIT];
    const payload = parse(
      buildPartnerOldHistoryPayload({
        partnerId: 7,
        openRows: rows,
        upTo: "2026-09-30",
      }),
    );
    expect(payload.selections).toEqual([9]);
    expect(payload.include_account_credits).toBe(true);
    expect(payload.credit_used).toEqual({ usd: 40, lbp: 0 });
    expect(payload.per_currency.USD?.payments).toEqual([]);
    expect(payload.per_currency.LBP).toBeUndefined();
    expect(payload.expected_owed).toEqual({ usd: -10, lbp: 0 });
  });
  it("old history: offered only when the server's allocator would close something (no money)", () => {
    const old = row({ id: 9, shop_day: "2026-09-01", amount_usd: 40 });
    // A debt alone, no credit, nothing to net: the server says "nothing to settle".
    expect(oldHistoryWouldSettle([old, FOR_20], "2026-09-30")).toBe(false);
    // The partner's credit pays it.
    expect(oldHistoryWouldSettle([old, CREDIT], "2026-09-30")).toBe(true);
    // A For and a Through net against each other.
    expect(oldHistoryWouldSettle([FOR_20, THROUGH_21], "2026-10-21")).toBe(true);
    // No open day up to the date.
    expect(oldHistoryWouldSettle([FOR_20], "2026-10-01")).toBe(false);
  });
});
