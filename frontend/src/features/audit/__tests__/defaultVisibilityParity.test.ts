import {
  AUTO_HIDDEN_TRANSACTION_TYPES,
  DEFAULT_HIDDEN_TRANSACTION_TYPES,
} from "@liratek/core";
import {
  isExpenseVisible,
  isSupplierPaymentVisible,
  isWarrantyCostVisible,
} from "../auditConstants";
import { HIDDEN_TRANSACTION_TYPES } from "../hooks/useTransactionRows";

/**
 * The phone's Activity tab hides exactly what core's `isHiddenByDefault`
 * says. This page applies the same rule through per-type helpers (so an
 * explicit filter can override it). Guard that the two agree: a type added
 * to core's auto-hidden list without a helper here fails this test.
 */
const WEB_DEFAULT_HELPERS: Record<string, (meta: string | null) => boolean> = {
  SUPPLIER_PAYMENT: (m) => isSupplierPaymentVisible(m, undefined),
  EXPENSE: (m) => isExpenseVisible(m, undefined),
  WARRANTY_COST: (m) => isWarrantyCostVisible(m, undefined),
};

describe("web default view matches core's isHiddenByDefault", () => {
  it("has a default-view helper for every auto-hidden type", () => {
    expect([...AUTO_HIDDEN_TRANSACTION_TYPES].sort()).toEqual(
      Object.keys(WEB_DEFAULT_HELPERS).sort(),
    );
  });

  it.each([...AUTO_HIDDEN_TRANSACTION_TYPES])(
    "%s: auto row hidden, manual row shown",
    (type) => {
      const visible = WEB_DEFAULT_HELPERS[type]!;
      expect(visible(JSON.stringify({ is_auto: true }))).toBe(false);
      expect(visible(null)).toBe(true);
    },
  );

  it("blanket-hides the same types", () => {
    expect([...HIDDEN_TRANSACTION_TYPES].sort()).toEqual(
      [...DEFAULT_HIDDEN_TRANSACTION_TYPES].sort(),
    );
  });
});
