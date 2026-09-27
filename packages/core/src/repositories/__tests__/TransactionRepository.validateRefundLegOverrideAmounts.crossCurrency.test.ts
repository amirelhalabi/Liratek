/**
 * LIRA-236 (REFUND_EXCHANGE_RATE_PLAN.md §3) — `validateRefundLegOverrideAmounts`
 * gains an optional `exchangeRate` parameter. Contract:
 *   - `exchangeRate` OMITTED: byte-identical to today — per-currency EXACT
 *     match, cross-currency legs still rejected (backward compatible).
 *   - `exchangeRate` GIVEN: validated by TOTAL VALUE at that rate
 *     (Σ legs (USD + LBP/rate) == Σ refund value (USD + LBP/rate), within
 *     `REFUND_VALUE_TOLERANCE_USD`) — cross-currency legs are now ALLOWED.
 *
 * Rule 17: written and run BEFORE the `exchangeRate` parameter existed —
 * every "given a rate" case below fails to compile/red on the pre-fix
 * signature (TS2554/2345 — too many arguments / wrong shape), which is the
 * strongest possible failing-first proof for a brand-new parameter.
 */

import Database from "better-sqlite3";
import {
  validateRefundLegOverrideAmounts,
  refundLegReversalSign,
  type RefundLegOverride,
} from "../TransactionRepository.js";
import { resetPaymentMethodRepository } from "../PaymentMethodRepository.js";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE payment_methods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL,
      label TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      affects_drawer INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_system INTEGER NOT NULL DEFAULT 0,
      tenant_id INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO payment_methods (code, label, drawer_name, affects_drawer, is_active, is_system) VALUES
      ('CASH', 'Cash', 'General', 1, 1, 1),
      ('CUSTOMER_ACCOUNT', 'Customer Account', 'General', 0, 1, 1);
  `);
  return db;
}

describe("validateRefundLegOverrideAmounts — exchangeRate (LIRA-236)", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetPaymentMethodRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
    delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
    resetPaymentMethodRepository();
  });

  it("no exchangeRate: per-currency exact match still required (unchanged)", () => {
    expect(() =>
      validateRefundLegOverrideAmounts({ USD: 50 }, [{ method: "CASH", currencyCode: "USD", amount: 50 }], 1),
    ).not.toThrow();
  });

  it("no exchangeRate: cross-currency legs still rejected (backward compatible)", () => {
    const legs: RefundLegOverride[] = [{ method: "CASH", currencyCode: "LBP", amount: 4500000 }];
    expect(() => validateRefundLegOverrideAmounts({ USD: 50 }, legs, 1)).toThrow(
      /do not match the original payment/,
    );
  });

  it("with exchangeRate: a USD sale refunded fully in LBP at that rate is ACCEPTED", () => {
    const legs: RefundLegOverride[] = [{ method: "CASH", currencyCode: "LBP", amount: 4450000 }];
    // $50 sale, rate 89000 -> 4,450,000 LBP exactly.
    expect(() =>
      validateRefundLegOverrideAmounts({ USD: 50 }, legs, 1, 89000),
    ).not.toThrow();
  });

  it("with exchangeRate: a MIXED-currency refund (part USD, part LBP) is ACCEPTED when the total value matches", () => {
    const legs: RefundLegOverride[] = [
      { method: "CASH", currencyCode: "USD", amount: 20 },
      { method: "CASH", currencyCode: "LBP", amount: 2670000 },
    ];
    // $50 sale at rate 89000: $20 + (30*89000=2,670,000 LBP) = exact value match.
    expect(() =>
      validateRefundLegOverrideAmounts({ USD: 50 }, legs, 1, 89000),
    ).not.toThrow();
  });

  it("with exchangeRate: a value MISMATCH is still rejected", () => {
    const legs: RefundLegOverride[] = [{ method: "CASH", currencyCode: "LBP", amount: 4000000 }];
    // $50 sale at rate 89000 -> should be 4,450,000 LBP; 4,000,000 is short.
    expect(() =>
      validateRefundLegOverrideAmounts({ USD: 50 }, legs, 1, 89000),
    ).toThrow(/do not match the original payment/);
  });

  it("with exchangeRate: still refuses a non-drawer-affecting method (CUSTOMER_ACCOUNT)", () => {
    const legs: RefundLegOverride[] = [
      { method: "CUSTOMER_ACCOUNT", currencyCode: "LBP", amount: 4450000 },
    ];
    expect(() =>
      validateRefundLegOverrideAmounts({ USD: 50 }, legs, 1, 89000),
    ).toThrow(/not an active, drawer-affecting payment method/);
  });

  it("with exchangeRate: still refuses a negative/zero leg amount", () => {
    const legs: RefundLegOverride[] = [{ method: "CASH", currencyCode: "LBP", amount: 0 }];
    expect(() =>
      validateRefundLegOverrideAmounts({ USD: 50 }, legs, 1, 89000),
    ).toThrow(/leg amount must be greater than 0/);
  });

  // F14 (round-3 review, defensive) — `Number.isFinite(rate) && rate > 0`
  // where the rate enters the repository. `exchangeRate > 0` ALONE lets
  // `Infinity` through (`Infinity > 0` is `true`), and `1 / Infinity` prices
  // EVERY LBP amount — on both the original side and the override side — at
  // exactly $0. An 8,000,000 LBP original and an unrelated 3,000,000 LBP
  // override both collapse to "$0 vs $0" and wrongly PASS. The zod schema
  // layer already rejects a non-finite rate for every transport-facing
  // caller (`refundExchangeRateSchema`'s `.finite()`), so this is
  // belt-and-suspenders for a caller that reaches the repository directly.
  it("with a non-finite exchangeRate (Infinity): the guard refuses to use it, falling back to the per-currency exact check instead of wrongly accepting a $0-vs-$0 match (F14, round-3 review)", () => {
    const legs: RefundLegOverride[] = [
      { method: "CASH", currencyCode: "LBP", amount: 3000000 },
    ];
    expect(() =>
      validateRefundLegOverrideAmounts({ LBP: -8000000 }, legs, 1, Infinity),
    ).toThrow(/do not match the original payment/);
  });

  // Same defensive gate, the OTHER exported entry point (rule 14 — ONE
  // shared predicate, not two copies): `refundLegReversalSign` with
  // `exchangeRate: Infinity` currently takes the "exchangeRate given" branch
  // (Infinity > 0), prices the LBP leg of a mixed-currency net at $0, and
  // derives the sign from the USD-only remainder — flipping the sign a
  // correct per-currency fallback would have produced.
  it("refundLegReversalSign ignores a non-finite exchangeRate (Infinity) and falls back to this currency's own net (F14, round-3 review)", () => {
    const netByCurrency = { USD: 100, LBP: -895000 };
    const sign = refundLegReversalSign(netByCurrency, "LBP", Infinity);
    // Per-currency fallback: LBP's own net is negative, so the sign is +1
    // (add back) — never the -1 a $0-priced-LBP "overall value" would derive.
    expect(sign).toBe(1);
  });
});
