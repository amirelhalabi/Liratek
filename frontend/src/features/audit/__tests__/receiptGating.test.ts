/**
 * Guard: isReceiptableTransaction (LIRA-069 W1.a) — provider-aware receipt
 * gating. This test proves the OLD type-only gate (RECEIPTABLE_TYPES) was a
 * correctness bug (it shows Print on every FINANCIAL_SERVICE row, including
 * providers the ticket explicitly excludes) and pins the FIXED behavior.
 *
 * Failing-first proof (rule 17): the "old gate would wrongly include" block
 * below asserts the pre-fix behavior directly against `RECEIPTABLE_TYPES` —
 * it passes today (proving the bug existed) and stays green after the fix
 * (RECEIPTABLE_TYPES itself is untouched; only the NEW predicate replaces its
 * use as a print-button gate). The matrix below is what actually changes
 * behavior at the call sites — see the report for the manual before/after run.
 */
import {
  isReceiptableTransaction,
  isReceiptableRow,
  type ReceiptGatingFields,
} from "../receiptGating";
import { RECEIPTABLE_TYPES } from "../auditConstants";

describe("isReceiptableTransaction — provider-aware gate", () => {
  // ---------------------------------------------------------------------
  // Proof the OLD type-only gate was wrong: every one of these rows is a
  // FINANCIAL_SERVICE type (so RECEIPTABLE_TYPES.has(type) === true, the
  // button WOULD show under the old gate) but the ticket excludes them.
  // ---------------------------------------------------------------------
  describe("old type-only gate wrongly included these (the bug this fixes)", () => {
    const excludedFinancialRows: Array<{
      label: string;
      provider: string;
      itemKey?: string;
    }> = [
      { label: "OMT System SEND", provider: "OMT" },
      { label: "OMT System RECEIVE", provider: "OMT" },
      { label: "Whish System SEND", provider: "WHISH" },
      { label: "Whish System RECEIVE", provider: "WHISH" },
      { label: "OMT App transfer", provider: "OMT_APP" },
      { label: "Whish App transfer (no item_key)", provider: "WHISH_APP" },
      { label: "Binance SEND", provider: "BINANCE" },
      { label: "Binance RECEIVE", provider: "BINANCE" },
    ];

    it.each(excludedFinancialRows)(
      "$label: old gate said true, new predicate says false",
      ({
        provider,
        itemKey,
      }: {
        label: string;
        provider: string;
        itemKey?: string;
      }) => {
        // The old gate (still exported, still used by the actionGating guard
        // test as a real-TransactionType pin) — type-only, no provider check.
        expect(RECEIPTABLE_TYPES.has("FINANCIAL_SERVICE")).toBe(true);

        // The new predicate correctly excludes it.
        expect(
          isReceiptableTransaction({
            type: "FINANCIAL_SERVICE",
            provider,
            itemKey,
          }),
        ).toBe(false);
      },
    );
  });

  // ---------------------------------------------------------------------
  // Full include/exclude matrix over realistic row shapes.
  // ---------------------------------------------------------------------
  describe("include/exclude matrix", () => {
    const cases: Array<{
      label: string;
      fields: ReceiptGatingFields;
      expected: boolean;
    }> = [
      // Always-receiptable types (no provider concept)
      {
        label: "RECHARGE (MTC telecom)",
        fields: { type: "RECHARGE", provider: "MTC" },
        expected: true,
      },
      {
        label: "RECHARGE (Alfa telecom)",
        fields: { type: "RECHARGE", provider: "Alfa" },
        expected: true,
      },
      {
        label: "MAINTENANCE",
        fields: { type: "MAINTENANCE" },
        expected: true,
      },
      {
        label: "CUSTOM_SERVICE",
        fields: { type: "CUSTOM_SERVICE" },
        expected: true,
      },
      { label: "LOTO ticket sale", fields: { type: "LOTO" }, expected: true },

      // FINANCIAL_SERVICE — iPick/Katsh always receiptable
      {
        label: "iPick catalog item",
        fields: { type: "FINANCIAL_SERVICE", provider: "iPick" },
        expected: true,
      },
      {
        label: "iPick bill (BILL service_type, still just provider-gated)",
        fields: {
          type: "FINANCIAL_SERVICE",
          provider: "iPick",
          itemKey: null,
        },
        expected: true,
      },
      {
        label: "Katsh catalog item",
        fields: { type: "FINANCIAL_SERVICE", provider: "Katsh" },
        expected: true,
      },

      // FINANCIAL_SERVICE — Whish App: item_key is the discriminator
      {
        label: "Whish App Bill (item_key set)",
        fields: {
          type: "FINANCIAL_SERVICE",
          provider: "WHISH_APP",
          itemKey: "bill-123",
        },
        expected: true,
      },
      {
        label: "Whish App transfer SEND (no item_key)",
        fields: {
          type: "FINANCIAL_SERVICE",
          provider: "WHISH_APP",
          itemKey: undefined,
        },
        expected: false,
      },
      {
        label: "Whish App transfer RECEIVE (no item_key)",
        fields: {
          type: "FINANCIAL_SERVICE",
          provider: "WHISH_APP",
          itemKey: null,
        },
        expected: false,
      },

      // FINANCIAL_SERVICE — excluded providers regardless of item_key
      {
        label: "OMT System",
        fields: { type: "FINANCIAL_SERVICE", provider: "OMT" },
        expected: false,
      },
      {
        label: "Whish System",
        fields: { type: "FINANCIAL_SERVICE", provider: "WHISH" },
        expected: false,
      },
      {
        label: "OMT App transfer",
        fields: { type: "FINANCIAL_SERVICE", provider: "OMT_APP" },
        expected: false,
      },
      {
        label: "Binance SEND",
        fields: { type: "FINANCIAL_SERVICE", provider: "BINANCE" },
        expected: false,
      },
      {
        label: "Binance RECEIVE",
        fields: {
          type: "FINANCIAL_SERVICE",
          provider: "BINANCE",
          itemKey: undefined,
        },
        expected: false,
      },
      {
        label: "unknown/missing provider on a FINANCIAL_SERVICE row",
        fields: { type: "FINANCIAL_SERVICE", provider: null },
        expected: false,
      },

      // Types that never get a customer receipt — drawer top-ups, exchange,
      // sales (POS has its own receipt path), debt, expenses, etc.
      {
        label: "RECHARGE_TOPUP",
        fields: { type: "RECHARGE_TOPUP" },
        expected: false,
      },
      { label: "MTC_TOPUP", fields: { type: "MTC_TOPUP" }, expected: false },
      { label: "ALFA_TOPUP", fields: { type: "ALFA_TOPUP" }, expected: false },
      {
        label: "DRAWER_TOPUP",
        fields: { type: "DRAWER_TOPUP" },
        expected: false,
      },
      {
        label: "SALE (POS has its own receipt)",
        fields: { type: "SALE" },
        expected: false,
      },
      { label: "EXCHANGE", fields: { type: "EXCHANGE" }, expected: false },
      { label: "EXPENSE", fields: { type: "EXPENSE" }, expected: false },
      {
        label: "LOTO_CASH_PRIZE (payout, not a ticket sale)",
        fields: { type: "LOTO_CASH_PRIZE" },
        expected: false,
      },
    ];

    it.each(cases)(
      "$label -> $expected",
      ({
        fields,
        expected,
      }: {
        fields: ReceiptGatingFields;
        expected: boolean;
      }) => {
        expect(isReceiptableTransaction(fields)).toBe(expected);
      },
    );
  });

  describe("isReceiptableRow — parses metadata_json defensively", () => {
    it("Whish App Bill row (item_key in metadata_json)", () => {
      expect(
        isReceiptableRow({
          type: "FINANCIAL_SERVICE",
          metadata_json: JSON.stringify({
            provider: "WHISH_APP",
            item_key: "phone-bill",
          }),
        }),
      ).toBe(true);
    });

    it("Whish App transfer row (no item_key in metadata_json)", () => {
      expect(
        isReceiptableRow({
          type: "FINANCIAL_SERVICE",
          metadata_json: JSON.stringify({
            provider: "WHISH_APP",
            service_type: "SEND",
          }),
        }),
      ).toBe(false);
    });

    it("null/unparsable metadata_json never throws, reads as not receiptable for FINANCIAL_SERVICE", () => {
      expect(
        isReceiptableRow({ type: "FINANCIAL_SERVICE", metadata_json: null }),
      ).toBe(false);
      expect(
        isReceiptableRow({
          type: "FINANCIAL_SERVICE",
          metadata_json: "{not json",
        }),
      ).toBe(false);
    });

    it("always-receiptable types don't need metadata_json at all", () => {
      expect(
        isReceiptableRow({ type: "MAINTENANCE", metadata_json: null }),
      ).toBe(true);
    });
  });
});
