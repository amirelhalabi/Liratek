/**
 * Pure unit test for `formatMoneyAmount` (utils/formatMoney.ts) — the shared
 * money-string formatter introduced to fix the raw-unformatted-number bug in
 * RechargeRepository's top-up summary/note strings (rule 14: one formatter,
 * not five). Deliberately has ZERO better-sqlite3 dependency (no `new
 * Database(...)` anywhere in this file) so it can run standalone in
 * environments where the native module's ABI doesn't match the running
 * Node — unlike the full DB round-trip regression test in
 * `RechargeRepository.topUpAmountFormatting.test.ts`, which exercises the
 * actual repository methods and therefore DOES need a working better-sqlite3
 * binding.
 *
 * Must MATCH the transactions-table cash-flow badge's own formatting
 * (`frontend/src/features/audit/pages/TransactionsViewer.tsx`'s
 * `formatAmount`: `$${usd.toLocaleString()}` / `${lbp.toLocaleString()} LBP`)
 * so a row's stored summary text and its badge never disagree on the same
 * number.
 *
 * Moved here from repositories/__tests__/formatMoneyAmount.test.ts when the
 * function itself moved out of moneyPosting.ts into this zero-import leaf
 * module (so it is reachable from browser.ts, the Vite/frontend entry point,
 * without pulling better-sqlite3 into the renderer bundle) — see
 * utils/formatMoney.ts's own header comment for the full reasoning.
 */

import { formatMoneyAmount } from "../formatMoney";

describe("formatMoneyAmount", () => {
  it("formats LBP with thousands separators and an LBP suffix, no decimals", () => {
    expect(formatMoneyAmount(700_579, "LBP")).toBe("700,579 LBP");
    expect(formatMoneyAmount(1_000_000, "LBP")).toBe("1,000,000 LBP");
    expect(formatMoneyAmount(681, "LBP")).toBe("681 LBP");
  });

  it("formats USD with a $ prefix and thousands separators, matching the badge", () => {
    expect(formatMoneyAmount(123_456, "USD")).toBe("$123,456");
    expect(formatMoneyAmount(50, "USD")).toBe("$50");
  });

  it("falls back to '<amount> <CODE>' for any other currency code", () => {
    expect(formatMoneyAmount(1_234, "EUR")).toBe("1,234 EUR");
  });
});
