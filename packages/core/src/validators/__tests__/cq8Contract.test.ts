/**
 * CQ-8 — validator-level coverage for the counterparty transaction contract
 * and validation parity (rule 14).
 *
 * docs/plans/todo_plans/COUNTERPARTY_CONSOLIDATION_PLAN.md, "Extension
 * (2026-07-18)".
 */

import { describe, it, expect } from "@jest/globals";
import {
  counterpartyMetadataSchema,
  buildCounterpartyMetadata,
  supplierLedgerEntrySchema,
  supplierSettleSchema,
  supplierCashflowSchema,
  supplierPurchaseCreateSchema,
  partnerRecordTransactionSchema,
  partnerSettleSchema,
  addRepaymentSchema,
} from "../index.js";

describe("counterpartyMetadataSchema / buildCounterpartyMetadata", () => {
  it("accepts a fully-formed contract object", () => {
    const meta = buildCounterpartyMetadata({
      kind: "client",
      id: 1,
      name: "Jane Client",
      flow: "IN",
      method: "CASH",
      ledgerEntryId: 42,
    });
    expect(() => counterpartyMetadataSchema.parse(meta)).not.toThrow();
    expect(meta).toEqual({
      kind: "client",
      id: 1,
      name: "Jane Client",
      flow: "IN",
      method: "CASH",
      ledger_entry_id: 42,
    });
  });

  it("accepts a null ledger_entry_id", () => {
    const meta = buildCounterpartyMetadata({
      kind: "supplier",
      id: 2,
      name: "Acme",
      flow: "OUT",
      method: "LEDGER",
      ledgerEntryId: null,
    });
    expect(() => counterpartyMetadataSchema.parse(meta)).not.toThrow();
  });

  it("omits the discount key entirely when not provided (additive-only shape)", () => {
    const meta = buildCounterpartyMetadata({
      kind: "partner",
      id: 3,
      name: "Bob Partner",
      flow: "IN",
      method: "CASH",
      ledgerEntryId: 5,
    });
    expect(meta).not.toHaveProperty("discount");
  });

  it("accepts a discount object (schema-only for now — CQ-10 is the first writer)", () => {
    const meta = buildCounterpartyMetadata({
      kind: "client",
      id: 1,
      name: "Jane",
      flow: "IN",
      method: "CASH",
      ledgerEntryId: 1,
      discount: { amount_usd: 5, amount_lbp: 0, reason: "loyalty" },
    });
    expect(() => counterpartyMetadataSchema.parse(meta)).not.toThrow();
  });

  it("rejects an invalid kind", () => {
    expect(() =>
      counterpartyMetadataSchema.parse({
        kind: "vendor",
        id: 1,
        name: "X",
        flow: "IN",
        method: "CASH",
        ledger_entry_id: 1,
      }),
    ).toThrow();
  });

  it("rejects an invalid flow", () => {
    expect(() =>
      counterpartyMetadataSchema.parse({
        kind: "client",
        id: 1,
        name: "X",
        flow: "SIDEWAYS",
        method: "CASH",
        ledger_entry_id: 1,
      }),
    ).toThrow();
  });

  it("rejects a missing name", () => {
    expect(() =>
      counterpartyMetadataSchema.parse({
        kind: "client",
        id: 1,
        flow: "IN",
        method: "CASH",
        ledger_entry_id: 1,
      }),
    ).toThrow();
  });
});

describe("supplier.ts schemas (lifted from electron-app/schemas/index.ts, rule 14)", () => {
  it("supplierLedgerEntrySchema validates a manual TOP_UP entry", () => {
    expect(() =>
      supplierLedgerEntrySchema.parse({
        supplier_id: 1,
        entry_type: "TOP_UP",
        amount_usd: 10,
        amount_lbp: 0,
      }),
    ).not.toThrow();
  });

  it("supplierLedgerEntrySchema rejects an unknown entry_type", () => {
    expect(() =>
      supplierLedgerEntrySchema.parse({
        supplier_id: 1,
        entry_type: "SETTLEMENT", // not a valid MANUAL entry type
        amount_usd: 10,
        amount_lbp: 0,
      }),
    ).toThrow();
  });

  it("supplierSettleSchema requires at least one financial_service_id", () => {
    expect(() =>
      supplierSettleSchema.parse({
        supplier_id: 1,
        financial_service_ids: [],
        amount_usd: 10,
        amount_lbp: 0,
        commission_usd: 0,
        commission_lbp: 0,
        drawer_name: "General",
      }),
    ).toThrow();
  });

  it("supplierCashflowSchema requires at least one payment leg", () => {
    expect(() =>
      supplierCashflowSchema.parse({
        supplier_id: 1,
        direction: "PAY",
        payments: [],
      }),
    ).toThrow();
  });

  it("supplierPurchaseCreateSchema rejects a non-positive total", () => {
    expect(() =>
      supplierPurchaseCreateSchema.parse({ supplier_id: 1, total_usd: 0 }),
    ).toThrow();
  });
});

describe("partner schemas — IPC validation parity (rule 14/19)", () => {
  it("partnerRecordTransactionSchema rejects an invalid direction (guards partners:record-transaction)", () => {
    expect(() =>
      partnerRecordTransactionSchema.parse({
        partnerId: 1,
        amount: 10,
        currency: "USD",
        direction: "SIDEWAYS",
      }),
    ).toThrow();
  });

  it("partnerRecordTransactionSchema rejects a non-positive amount", () => {
    expect(() =>
      partnerRecordTransactionSchema.parse({
        partnerId: 1,
        amount: 0,
        currency: "USD",
        direction: "DEBIT",
      }),
    ).toThrow();
  });

  it("partnerRecordTransactionSchema accepts the full FOR_*/THROUGH_* union (superset of the old 7-value handler union)", () => {
    expect(() =>
      partnerRecordTransactionSchema.parse({
        partnerId: 1,
        transactionType: "FOR_WHISH_RECEIVE",
        amount: 10,
        currency: "USD",
        direction: "CREDIT",
      }),
    ).not.toThrow();
  });

  it("partnerSettleSchema rejects a missing settlementMethod (guards partners:settle)", () => {
    expect(() =>
      partnerSettleSchema.parse({
        partnerId: 1,
        amount: 10,
        currency: "USD",
        settlementMethod: "",
      }),
    ).toThrow();
  });

  it("partnerSettleSchema accepts a well-formed payload", () => {
    expect(() =>
      partnerSettleSchema.parse({
        partnerId: 1,
        amount: 10,
        currency: "USD",
        settlementMethod: "CASH",
      }),
    ).not.toThrow();
  });
});

describe("addRepaymentSchema — payment-leg direction (CQ-8 schema-drift fix)", () => {
  it("accepts a payment leg carrying direction: 'OUT' (a change-return leg)", () => {
    // Pre-fix, core's repaymentPaymentLineSchema had no `direction` field, so
    // Zod silently STRIPPED it from every leg — a real, pre-existing gap on
    // the REST repayment route (backend/src/api/debts.ts validates against
    // this exact schema). Proven here at the schema level: the parsed leg
    // must still carry `direction` after validation.
    const parsed = addRepaymentSchema.parse({
      clientId: 1,
      amountUSD: 10,
      amountLBP: 0,
      payments: [
        { method: "CASH", currencyCode: "USD", amount: 15 },
        { method: "CASH", currencyCode: "USD", amount: 5, direction: "OUT" },
      ],
    });
    expect(parsed.payments?.[1]?.direction).toBe("OUT");
  });

  it("still defaults an omitted leg direction to undefined (IN, per repository convention)", () => {
    const parsed = addRepaymentSchema.parse({
      clientId: 1,
      amountUSD: 10,
      amountLBP: 0,
      payments: [{ method: "CASH", currencyCode: "USD", amount: 10 }],
    });
    expect(parsed.payments?.[0]?.direction).toBeUndefined();
  });
});
