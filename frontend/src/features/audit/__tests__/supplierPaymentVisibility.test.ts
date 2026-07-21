/**
 * D2 (CQ-8) — SUPPLIER_PAYMENT default-view visibility.
 *
 * Manual supplier payments (Suppliers page Pay/Receive) are first-class
 * visible rows on the Transactions page by default; only the auto-generated
 * ledger siblings other modules book (metadata.is_auto === true) stay
 * hidden until the operator explicitly filters for SUPPLIER_PAYMENT rows.
 * Extracted as pure helpers in auditConstants.ts so this rule is unit
 * testable without rendering TransactionsViewer.
 */
import {
  FILTER_GROUPS,
  isAutoSupplierPayment,
  isSupplierPaymentVisible,
  type FilterOption,
} from "../auditConstants";

const autoMeta = JSON.stringify({ is_auto: true, supplier_id: 1 });
const manualMeta = JSON.stringify({ supplier_id: 1, direction: "PAY" });
const creditMeta = JSON.stringify({ is_credit: true });
const autoCreditMeta = JSON.stringify({ is_auto: true, is_credit: true });

describe("isAutoSupplierPayment", () => {
  it("true only when metadata.is_auto === true", () => {
    expect(isAutoSupplierPayment(autoMeta)).toBe(true);
  });

  it("false for manual rows (no is_auto key at all)", () => {
    expect(isAutoSupplierPayment(manualMeta)).toBe(false);
  });

  it("false for missing/malformed metadata — historical rows default to visible", () => {
    expect(isAutoSupplierPayment(null)).toBe(false);
    expect(isAutoSupplierPayment(undefined)).toBe(false);
    expect(isAutoSupplierPayment("not-json{")).toBe(false);
  });
});

describe("isSupplierPaymentVisible — D2 default-view hide rule", () => {
  it("manual payment visible with no filter active ('All types')", () => {
    expect(isSupplierPaymentVisible(manualMeta, undefined)).toBe(true);
  });

  it("auto payment hidden with no filter active", () => {
    expect(isSupplierPaymentVisible(autoMeta, undefined)).toBe(false);
  });

  it("auto payment stays hidden under an unrelated filter (e.g. Cash only)", () => {
    const cashOnly: FilterOption = {
      label: "Cash only (till)",
      cash_only: true,
    };
    expect(isSupplierPaymentVisible(autoMeta, cashOnly)).toBe(false);
    expect(isSupplierPaymentVisible(manualMeta, cashOnly)).toBe(true);
  });

  it("explicit 'Supplier Payment' filter overrides the default hide — reveals auto rows too", () => {
    const supplierPaymentFilter: FilterOption = {
      label: "Supplier Payment",
      type: "SUPPLIER_PAYMENT",
    };
    expect(isSupplierPaymentVisible(autoMeta, supplierPaymentFilter)).toBe(
      true,
    );
    expect(isSupplierPaymentVisible(manualMeta, supplierPaymentFilter)).toBe(
      true,
    );
  });

  it("'Supplier Credit' filter narrows to is_credit rows regardless of is_auto", () => {
    const supplierCreditFilter: FilterOption = {
      label: "Supplier Credit",
      type: "SUPPLIER_PAYMENT",
      supplier_credit_only: true,
    };
    expect(isSupplierPaymentVisible(creditMeta, supplierCreditFilter)).toBe(
      true,
    );
    expect(isSupplierPaymentVisible(autoCreditMeta, supplierCreditFilter)).toBe(
      true,
    );
    expect(isSupplierPaymentVisible(manualMeta, supplierCreditFilter)).toBe(
      false,
    );
    expect(isSupplierPaymentVisible(autoMeta, supplierCreditFilter)).toBe(
      false,
    );
  });
});

describe("FILTER_GROUPS — Suppliers and Partners are first-class groups (CQ-8)", () => {
  it("has a 'Suppliers' group with settlement, payment, credit, and adjustment options", () => {
    const suppliers = FILTER_GROUPS.find((g) => g.group === "Suppliers");
    expect(suppliers?.options.map((o) => o.label)).toEqual([
      "Supplier Settlement",
      "Supplier Payment",
      "Supplier Credit",
      // LIRA-080: the paper (no-cash) "Add Credit / Debt" entry.
      "Supplier Adjustment",
    ]);
    expect(suppliers?.options.every((o) => !!o.type)).toBe(true);
  });

  it("has a 'Partners' group with settlement, payment, and adjustment options", () => {
    const partners = FILTER_GROUPS.find((g) => g.group === "Partners");
    expect(partners?.options.map((o) => o.label)).toEqual([
      "Partner Settlement",
      "Partner Payment",
      "Partner Adjustment",
    ]);
    expect(partners?.options).toEqual([
      { label: "Partner Settlement", type: "PARTNER_SETTLEMENT" },
      { label: "Partner Payment", type: "PARTNER_PAYMENT" },
      { label: "Partner Adjustment", type: "PARTNER_ADJUSTMENT" },
    ]);
  });
});
