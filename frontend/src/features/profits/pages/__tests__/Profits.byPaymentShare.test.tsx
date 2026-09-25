/** @jest-environment jsdom */

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
