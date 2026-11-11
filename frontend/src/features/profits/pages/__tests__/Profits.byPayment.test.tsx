/**
 * Profits — 4 per-ticket test files merged into one suite
 * (2026-11-11, owner decision: one module boot instead of 4).
 *
 * Each former file is one describe block below, named after it; its own
 * header comment (including its rule-17 failing-first history) is kept at the
 * top of its block, and its test bodies are unchanged. Every former file
 * declared exactly the same jest.mock set and shared mock setup, which is
 * kept once at the top. Each block starts with resetBetweenFiles(), which
 * puts the shared mocks back to how a fresh file would see them, so no block
 * depends on state left by the block above it.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Profits from "../Profits";

const mockGetProfitByPaymentMethod = jest.fn();

const mockApi = {
  getProfitByPaymentMethod: mockGetProfitByPaymentMethod,
  getOMTAnalytics: jest.fn(),
  getUnsettledSummary: jest.fn(),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

jest.mock("@/contexts/ModuleContext", () => ({
  useModules: () => ({ isModuleEnabled: () => true }),
}));

jest.mock("@/contexts/CurrencyContext", () => ({
  useCurrencyContext: () => ({
    formatAmount: (v: number, c: string) => `${v} ${c}`,
  }),
}));

jest.mock("../../../dashboard/components/CommissionsChart", () => ({
  __esModule: true,
  default: () => null,
}));

function resetBetweenFiles() {
  jest.clearAllMocks();
  (mockGetProfitByPaymentMethod as unknown as jest.Mock).mockReset();
  (mockApi.getOMTAnalytics as unknown as jest.Mock).mockReset();
  (mockApi.getUnsettledSummary as unknown as jest.Mock).mockReset();
  localStorage.clear();
  sessionStorage.clear();
  jest.useRealTimers();
}

describe("Profits.byPaymentDebtRepaymentColumn", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Profits — "Cash intake by method" tab, owner decision 3 (2026-09-24,
   * OWNER_NOTES_2026-09-21.md §6.5 review round 3): debt-repayment intake
   * gets its OWN column instead of the old all-or-nothing "No Profit" flag,
   * and both new-sales and debt-repayment intake count toward Share.
   *
   * This drives the REAL `Profits` page (only `useApi`, `useModules` and
   * `useCurrencyContext` are mocked), matching the layer-seam testing lesson
   * recorded for this repo.
   *
   * Rule 17 status — UNVERIFIED red, GREEN confirmed (be explicit rather than
   * claim more than was checked): a revert-and-rerun of the PRE-FIX By Payment
   * JSX block was ATTEMPTED here the same way it was done successfully for the
   * backend query (see `ProfitRepository.paymentMethodRows.test.ts`), but this
   * file — `Profits.tsx` — is being edited concurrently by other lanes right
   * now (shared-tree protocol), and the revert collided with one of those
   * edits: restoring the surrounding ternary lost 4 lines
   * (`{byPaymentError}`'s second `<p>`, two closing `</div>`s, and the `) : (`
   * separator) that this test's own edit never touched. That corruption was
   * caught immediately by `tsc` and repaired via a small, targeted Edit (see
   * this lane's final report) — but repeating the same large-block revert to
   * chase a RED screenshot was judged not worth the risk of a second collision
   * on a file this volatile. What IS verified: both assertions below FAIL
   * (`toBeInTheDocument()`/`toHaveTextContent()` fail) against ANY render that
   * doesn't include the "Debt Repayment" header and doesn't fold
   * `debt_repayment_usd`/`_lbp` into the Share numerator/denominator — which
   * is mechanically what the pre-fix JSX did (no such header, `shareEligible`
   * excluded `is_debt_repayment_only` rows entirely) — and the backend's own
   * RED/GREEN proof for the SAME owner decision (`ProfitRepository
   * .paymentMethodRows.test.ts`'s "still routes a debt-repayment method..."
   * case, and `ProfitService.getByPaymentMethod` feeding `debt_repayment_usd`/
   * `_lbp` through) is real and already captured. GREEN below is confirmed
   * against the current, fixed code.
   */

  async function renderPage() {
    const utils = render(<Profits />);
    await waitFor(() =>
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument(),
    );
    return utils;
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Profits — "Cash intake by method" tab, debt-repayment column (owner decision 3)', () => {
    it("shows debt-repayment intake in its own column, separate from the sales total", async () => {
      mockGetProfitByPaymentMethod.mockResolvedValueOnce([
        {
          method: "CASH",
          total_usd: 100,
          total_lbp: 0,
          debt_repayment_usd: 40,
          debt_repayment_lbp: 0,
          count: 2,
          pending_commission_usd: 0,
          is_settled: 1,
        },
      ]);

      await renderPage();
      fireEvent.click(
        screen.getByRole("button", { name: /cash intake by method/i }),
      );
      await screen.findByText("CASH");

      // The column header exists.
      expect(screen.getByText("Debt Repayment")).toBeInTheDocument();

      const row = screen.getByText("CASH").closest("tr");
      expect(row).not.toBeNull();
      // Both figures are visible on the SAME row — sales intake (100 USD) is
      // never zeroed out by the presence of debt-repayment money (40 USD).
      expect(row).toHaveTextContent("100 USD");
      expect(row).toHaveTextContent("40 USD");
      // The old all-or-nothing flag text is gone.
      expect(row).not.toHaveTextContent("No Profit");
    });

    it("counts debt-repayment intake toward Share instead of hiding it behind 'No Profit'", async () => {
      mockGetProfitByPaymentMethod.mockResolvedValueOnce([
        {
          // Pure new-sales method: $50 sales, no debt repayment.
          method: "CASH",
          total_usd: 50,
          total_lbp: 0,
          debt_repayment_usd: 0,
          debt_repayment_lbp: 0,
          count: 1,
          pending_commission_usd: 0,
          is_settled: 1,
        },
        {
          // Pure debt-repayment method: used to read "No Profit" / excluded
          // from Share entirely. Now it must count toward Share like any
          // other intake.
          method: "OMT",
          total_usd: 0,
          total_lbp: 0,
          debt_repayment_usd: 50,
          debt_repayment_lbp: 0,
          count: 1,
          pending_commission_usd: 0,
          is_settled: 1,
        },
      ]);

      await renderPage();
      fireEvent.click(
        screen.getByRole("button", { name: /cash intake by method/i }),
      );
      await screen.findByText("OMT");

      // Denominator is 50 (CASH sales) + 50 (OMT debt repayment) = 100, so
      // OMT's share is 50/100 = 50%, not the old hidden/"0%" treatment.
      const omtRow = screen.getByText("OMT").closest("tr");
      expect(omtRow).not.toBeNull();
      expect(omtRow).toHaveTextContent(/50\.0% USD/i);
      expect(omtRow).not.toHaveTextContent("No Profit");

      const cashRow = screen.getByText("CASH").closest("tr");
      expect(cashRow).not.toBeNull();
      expect(cashRow).toHaveTextContent(/50\.0% USD/i);
    });
  });
});

describe("Profits.byPaymentErrorState", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Profits — "Cash intake by method" tab, PA-4.16
   * (OWNER_NOTES_2026-09-21.md §6.6, lane LPay's own tab only).
   *
   * Pre-fix, `loadByPayment`'s catch block collapsed ANY failure into
   * `setByPayment([])`, so a broken `getProfitByPaymentMethod` call rendered
   * the exact same "No payment data for this period" message the DataTable
   * shows for a genuine no-activity day — a query failure read as silence.
   *
   * This drives the REAL `Profits` page (only `useApi`, `useModules` and
   * `useCurrencyContext` are mocked), matching the layer-seam testing lesson
   * recorded for this repo.
   *
   * Rule 17 proof (RED observed before GREEN): run against the PRE-FIX
   * `loadByPayment` (`catch { setByPayment([]); }`, no error state) by
   * temporarily reverting that one function (Edit tool, this lane's own
   * uncommitted change only) and re-running. Observed failure, verbatim:
   *
   *   "shows a visible error state instead of the empty-data message"
   *     TestingLibraryElementError: Unable to find an element with the text:
   *     /Failed to load payment method data/. This could be because the text
   *     is broken up by multiple elements...
   *     (found "No payment data for this period" instead)
   *
   * After restoring the fix, the same run passed.
   */

  async function renderPage() {
    const utils = render(<Profits />);
    await waitFor(() =>
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument(),
    );
    return utils;
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Profits — "Cash intake by method" tab, error state (PA-4.16)', () => {
    it("shows a visible error state instead of the empty-data message", async () => {
      mockGetProfitByPaymentMethod.mockRejectedValueOnce(
        new Error("Network request failed"),
      );

      await renderPage();
      fireEvent.click(
        screen.getByRole("button", { name: /cash intake by method/i }),
      );
      await waitFor(() =>
        expect(mockGetProfitByPaymentMethod).toHaveBeenCalledTimes(1),
      );

      expect(
        await screen.findByText(/Failed to load payment method data/i),
      ).toBeInTheDocument();
      expect(screen.getByText("Network request failed")).toBeInTheDocument();
      expect(
        screen.queryByText("No payment data for this period"),
      ).not.toBeInTheDocument();
    });

    it("clears a prior error and shows real data on a successful reload (regression)", async () => {
      mockGetProfitByPaymentMethod.mockRejectedValueOnce(new Error("boom"));

      await renderPage();
      fireEvent.click(
        screen.getByRole("button", { name: /cash intake by method/i }),
      );
      await screen.findByText(/Failed to load payment method data/i);

      mockGetProfitByPaymentMethod.mockResolvedValueOnce([
        {
          method: "CASH",
          total_usd: 100,
          total_lbp: 0,
          // LPAY-V-6(d) (round-1 review, OWNER_NOTES_2026-09-21.md §6.9): the
          // old all-or-nothing `is_debt_repayment_only` flag is gone (owner
          // decision 3) — `debt_repayment_usd`/`_lbp` are its real replacement
          // on `PaymentMethodRow`. A stale flag key here doesn't fail this
          // test (rule 24), it just asserts a shape no real response has ever
          // had since owner decision 3 shipped.
          debt_repayment_usd: 0,
          debt_repayment_lbp: 0,
          count: 1,
          pending_commission_usd: 0,
          is_settled: 1,
        },
      ]);
      // Re-trigger the tab's own fetch by leaving and returning to it — the
      // page's existing effect re-fires loadByPayment on tab re-entry via its
      // dependency array (from/to unchanged, so this exercises the same path
      // the date-range filter would).
      fireEvent.click(screen.getByRole("button", { name: /overview/i }));
      fireEvent.click(
        screen.getByRole("button", { name: /cash intake by method/i }),
      );

      await waitFor(() =>
        expect(mockGetProfitByPaymentMethod).toHaveBeenCalledTimes(2),
      );
      await screen.findByText("CASH");
      expect(
        screen.queryByText(/Failed to load payment method data/i),
      ).not.toBeInTheDocument();
    });

    it("still renders the real empty-data message for a genuine no-activity period (regression)", async () => {
      mockGetProfitByPaymentMethod.mockResolvedValueOnce([]);

      await renderPage();
      fireEvent.click(
        screen.getByRole("button", { name: /cash intake by method/i }),
      );
      await waitFor(() =>
        expect(mockGetProfitByPaymentMethod).toHaveBeenCalledTimes(1),
      );

      expect(
        await screen.findByText("No payment data for this period"),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(/Failed to load payment method data/i),
      ).not.toBeInTheDocument();
    });
  });
});

describe("Profits.byPaymentShare", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Profits — "Cash intake by method" tab, Share column (LPAY-R3-6, round-3
   * adversarial review, lane LPay's own By Payment block only).
   *
   * Pre-fix, the Share column's denominator (`totalAll`) and its percentage
   * (`formatPct(row.total_usd, totalAll)`) were both USD-only, so a payment
   * method taken ONLY in LBP (total_usd = 0) always read "0%" no matter how
   * much LBP it actually took in — it was being compared against a USD total
   * it structurally could never contribute to.
   *
   * This drives the REAL `Profits` page (only `useApi`, `useModules` and
   * `useCurrencyContext` are mocked), matching the layer-seam testing lesson
   * recorded for this repo.
   *
   * Rule 17 proof (RED observed before GREEN): run against the PRE-FIX Share
   * cell (`formatPct(row.total_usd, totalAll)` only, `totalAll` computed from
   * `total_usd` alone, no LBP branch/denominator at all) by temporarily
   * reverting that JSX block and the `totalAllLbp` computation (Edit tool,
   * this lane's own uncommitted change only) and re-running. Observed
   * failure, verbatim:
   *
   *   "shows a non-zero share for an LBP-only tender, not a flat 0%"
   *     expect(element).toHaveTextContent()
   *     Expected element to have text content:
   *       /75\.0% LBP/i
   *     Received:
   *       WHISH_APP0 USD300000 LBP1—0.0%
   *     (the pre-fix cell renders a bare "0.0%" with no currency suffix — the
   *     LBP row's total_usd is 0, so `formatPct(0, totalAllUsd)` always
   *     renders "0.0%")
   *
   * After restoring the per-currency fix, the same run passed.
   *
   * LPAY-V8 (OWNER_NOTES_2026-09-21.md §6.5 PA-3.5 review, round 3): the
   * fixture originally used `WHISH_APP`/`OMT_APP` as its two LBP tenders —
   * both are internal wallet-side METHOD MARKERS
   * (`TransactionRepository.INTERNAL_LEG_METHODS`), never a value
   * `getPaymentMethodRows` can actually return; no real backend response can
   * ever contain a row shaped like this. Swapped for `WHISH`/`OMT` — the real
   * `payment_methods.code` values a customer's own wallet tender uses (owner
   * decision 2, 2026-09-24 — these are now genuinely shown on this tab). The
   * Share-column MATH under test (a per-currency, not USD-only, denominator)
   * is unchanged by the rename.
   */

  async function renderPage() {
    const utils = render(<Profits />);
    await waitFor(() =>
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument(),
    );
    return utils;
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Profits — "Cash intake by method" tab, Share column (LPAY-R3-6)', () => {
    it("shows a non-zero share for an LBP-only tender, not a flat 0%", async () => {
      mockGetProfitByPaymentMethod.mockResolvedValueOnce([
        {
          method: "CASH",
          total_usd: 100,
          total_lbp: 0,
          count: 1,
          pending_commission_usd: 0,
          is_settled: 1,
        },
        {
          // An LBP-only tender (a customer's Whish Wallet payment taken purely
          // in LBP — owner decision 2, 2026-09-24) — total_usd is genuinely 0,
          // not just unpaid.
          method: "WHISH",
          total_usd: 0,
          total_lbp: 300000,
          count: 1,
          pending_commission_usd: 0,
          is_settled: 1,
        },
        {
          // A second LBP tender so the LBP denominator (400000) has more than
          // one contributor — WHISH's real share is 300000/400000 = 75%.
          method: "OMT",
          total_usd: 0,
          total_lbp: 100000,
          count: 1,
          pending_commission_usd: 0,
          is_settled: 1,
        },
      ]);

      await renderPage();
      fireEvent.click(
        screen.getByRole("button", { name: /cash intake by method/i }),
      );
      await screen.findByText("WHISH");

      const row = screen.getByText("WHISH").closest("tr");
      expect(row).not.toBeNull();
      // 300000 / (300000 + 100000) = 75.0%, NOT the flat "0%" a USD-only
      // denominator would have produced (WHISH's total_usd is 0).
      expect(row).toHaveTextContent(/75\.0% LBP/i);

      const cashRow = screen.getByText("CASH").closest("tr");
      expect(cashRow).not.toBeNull();
      // CASH is the only USD contributor, so its USD share is still 100%,
      // unaffected by the new LBP denominator.
      expect(cashRow).toHaveTextContent(/100\.0% USD/i);
    });

    // ===========================================================================
    // LPAY-V-3 (round-1 review, OWNER_NOTES_2026-09-21.md §6.9 status table) —
    // a negative row must not drag the Share denominator negative, or below
    // another row's own share
    // ===========================================================================
    //
    // Rule 17 proof (RED observed before GREEN): run against the PRE-FIX
    // denominators (`totalAll`/`totalAllLbp` summing `shareUsd(r)`/`shareLbp(r)`
    // SIGNED, with no `Math.max(0, …)` floor) by temporarily reverting that one
    // change (Edit tool, this lane's own uncommitted change only) and
    // re-running. Observed failure, verbatim:
    //
    //   "floors each row at 0 before it enters the Share denominator, so a negative row cannot flip another row's percentage negative or push a positive row's percentage past 100%"
    //     expect(element).toHaveTextContent()
    //     Expected element to have text content: /(?<!-)100\.0% USD/i
    //     Received:
    //       OMT50 USD——1—-100.0% USD
    //     (OMT's own share (50) divided by the SIGNED total (50 + -100 + 0 =
    //     -50) read as -100.0%, not the correct 100.0%)
    //
    // After flooring each row at 0 before summing into the denominator, the
    // same run passed (both this case and the pre-existing LPAY-R3-6 case
    // above it).
    it("floors each row at 0 before it enters the Share denominator, so a negative row cannot flip another row's percentage negative or push a positive row's percentage past 100%", async () => {
      mockGetProfitByPaymentMethod.mockResolvedValueOnce([
        {
          // A tender-side row: $50 USD in, no LBP at all.
          method: "OMT",
          total_usd: 50,
          total_lbp: 0,
          count: 1,
          pending_commission_usd: 0,
          is_settled: 1,
        },
        {
          // A unit-level-floored (LPAY-X1) cross-currency row: net-NEGATIVE
          // in USD (change given in a different currency than the tender),
          // net-POSITIVE in LBP — a real, current shape this query can
          // produce, not a hypothetical.
          method: "CASH",
          total_usd: -100,
          total_lbp: 5_000_000,
          count: 1,
          pending_commission_usd: 0,
          is_settled: 1,
        },
        {
          // A partial-item-refund-only row (LPAY-X4): negative in LBP, zero
          // in USD — the SAME shape that makes the SIGNED LBP denominator
          // shrink below CASH's own LBP share, inflating it past 100%.
          method: "WHISH",
          total_usd: 0,
          total_lbp: -2_000_000,
          count: 1,
          pending_commission_usd: 0,
          is_settled: 1,
        },
      ]);

      await renderPage();
      fireEvent.click(
        screen.getByRole("button", { name: /cash intake by method/i }),
      );
      await screen.findByText("OMT");

      const omtRow = screen.getByText("OMT").closest("tr");
      expect(omtRow).not.toBeNull();
      // Signed denominator: totalAll = 50 + -100 + 0 = -50, so OMT's own 50
      // read as 50 / -50 = -100% pre-fix. Floored: totalAll = 50 + 0 + 0 = 50,
      // so OMT is the ONLY positive USD contributor and reads exactly 100% —
      // never negative. The lookbehind rejects a "-100.0%" match.
      expect(omtRow).toHaveTextContent(/(?<!-)100\.0% USD/i);

      const cashRow = screen.getByText("CASH").closest("tr");
      expect(cashRow).not.toBeNull();
      // Signed denominator: totalAllLbp = 0 + 5,000,000 + -2,000,000 =
      // 3,000,000, so CASH's own 5,000,000 read as 166.7% pre-fix — a bar
      // width over 100%. Floored: totalAllLbp = 0 + 5,000,000 + 0 =
      // 5,000,000, so CASH is the ONLY positive LBP contributor and reads
      // exactly 100%.
      expect(cashRow).toHaveTextContent(/(?<!\d)100\.0% LBP/i);
      // CASH's own USD share is negative, so `shareUsd(row) > 0` must gate it
      // out of the USD bar entirely — no percentage text for CASH's USD leg
      // at all (never a rendered "-100.0%").
      expect(cashRow).not.toHaveTextContent(/%\s*USD/i);

      // WHISH's own LBP share is negative and its USD share is 0, so neither
      // the `shareLbp(row) > 0` bar nor the `shareUsd(row) > 0` bar can ever
      // fire for it — no percentage of any sign, under the fix or without it
      // (this assertion is a sanity check, not part of the RED/GREEN
      // transition above; the empty-vs-"—" fallback for a negative-only row
      // is a separate, pre-existing gap outside LPAY-V-3's scope).
      const whishRow = screen.getByText("WHISH").closest("tr");
      expect(whishRow).not.toBeNull();
      expect(whishRow).not.toHaveTextContent(/%/);
    });
  });
});

describe("Profits.byPaymentUnitLevelFloor", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Profits — "Cash intake by method" tab, LPAY-X1 (round 5,
   * OWNER_NOTES_2026-09-21.md §6.8 follow-up).
   *
   * `ProfitRepository.getPaymentMethodRows` now floors owner decision 1's
   * "net of change" at the UNIT level, not per currency (see that method's own
   * doc comment and `ProfitRepository.paymentMethodRows.test.ts`'s "LPAY-X1"
   * describe block for the backend proof). A direct, mechanical consequence:
   * `total_usd`/`debt_repayment_usd`/`debt_repayment_lbp` can now be
   * GENUINELY NEGATIVE (a unit tendered in one currency with change given in
   * the other), which was previously impossible — the per-currency floor used
   * to clamp every one of those fields at 0. This file drives the REAL
   * `Profits` page (only `useApi`, `useModules` and `useCurrencyContext` are
   * mocked), matching the layer-seam testing lesson recorded for this repo.
   *
   * Rule 17 proof (RED observed before GREEN): each case below was run against
   * the PRE-FIX JSX (Edit tool, this lane's own uncommitted change only,
   * reverted immediately after each observation):
   *
   *   - Total (USD) cell: the `className` ternary had no `row.total_usd < 0`
   *     branch at all (`isCommission ? "text-emerald-400 font-semibold" :
   *     "text-white"`), so a negative total rendered in plain white, visually
   *     indistinguishable from a positive one.
   *     "renders a negative Total (USD) figure in red, not plain white"
   *       expect(element).toHaveClass("text-red-400")
   *       Received class list: ["text-white"] — element did NOT match
   *
   *   - Debt Repayment cell: the outer visibility check was `debtRepaymentUsd
   *     > 0 || debtRepaymentLbp > 0`, and each inner span was individually
   *     gated `> 0` — a row with debt_repayment_usd > 0 but debt_repayment_lbp
   *     < 0 rendered the cell (outer check passed on the USD side) but SILENTLY
   *     DROPPED the negative LBP span (inner check failed).
   *     "shows a negative debt-repayment LBP leg instead of silently dropping it"
   *       expect(row).toHaveTextContent(/-895000/)
   *       (not found — the LBP span was never rendered)
   *
   * After restoring the fix, both passed.
   */

  async function renderPage() {
    const utils = render(<Profits />);
    await waitFor(() =>
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument(),
    );
    return utils;
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Profits — "Cash intake by method" tab, LPAY-X1 unit-level floor display', () => {
    it("renders a negative Total (USD) figure in red, not plain white", async () => {
      mockGetProfitByPaymentMethod.mockResolvedValueOnce([
        {
          // Owner-ticket shape: LBP tender, USD change — the unit qualifies
          // via its positive LBP net, so its USD net (-100) is genuinely
          // negative rather than floored to 0.
          method: "CASH",
          total_usd: -100,
          total_lbp: 9_000_000,
          debt_repayment_usd: 0,
          debt_repayment_lbp: 0,
          count: 1,
          pending_commission_usd: 0,
          is_settled: 1,
        },
      ]);

      await renderPage();
      fireEvent.click(
        screen.getByRole("button", { name: /cash intake by method/i }),
      );
      await screen.findByText("CASH");

      const row = screen.getByText("CASH").closest("tr");
      expect(row).not.toBeNull();
      expect(row).toHaveTextContent("-100 USD");
      const usdCell = screen.getByText("-100 USD");
      expect(usdCell).toHaveClass("text-red-400");
    });

    it("shows a negative debt-repayment LBP leg instead of silently dropping it", async () => {
      mockGetProfitByPaymentMethod.mockResolvedValueOnce([
        {
          // Owner-ticket shape: $100 USD tendered on a debt repayment, 895,000
          // LBP change given back — debt_repayment_usd stays positive while
          // debt_repayment_lbp goes negative.
          method: "CASH",
          total_usd: 0,
          total_lbp: 0,
          debt_repayment_usd: 100,
          debt_repayment_lbp: -895_000,
          count: 1,
          pending_commission_usd: 0,
          is_settled: 1,
        },
      ]);

      await renderPage();
      fireEvent.click(
        screen.getByRole("button", { name: /cash intake by method/i }),
      );
      await screen.findByText("CASH");

      const row = screen.getByText("CASH").closest("tr");
      expect(row).not.toBeNull();
      // Both legs of the SAME debt-repayment unit must be visible — the
      // positive USD leg must not hide the negative LBP one.
      expect(row).toHaveTextContent("100 USD");
      expect(row).toHaveTextContent("-895000 LBP");
      const lbpCell = screen.getByText("-895000 LBP");
      expect(lbpCell).toHaveClass("text-red-400");
    });
  });
});
