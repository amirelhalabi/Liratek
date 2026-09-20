/** @jest-environment jsdom */

/**
 * Diagnostic/regression guard for the LIRA-189 e2e flake on
 * lira-189-omt-account-settlement.spec.ts:604 ("A net-negative account
 * (cashout credit alone, no debt) offers the COLLECT direction" — net
 * readout expected -337.34, received 0).
 *
 * Root-cause reasoning (confirmed here by actually running it, not just
 * reading the source — fable-brain §6.5/§28): `useSupplierAccountUnsettledQuery`
 * (queryKey `["supplier-account-unsettled", accountId]`) is shared between
 * `SupplierAccountCard` (rendered continuously while the Companies tab is
 * open) and `AccountSettleSheet` (mounted only while the sheet is open).
 * The app-wide `staleTime` is 30s (`App.tsx`). The failing e2e spec seeds
 * its cashout row via a RAW `window.api.omt.*` call — the same class of
 * change `useSuppliers.ts`'s own `useRefreshSupplierAccountQueries` doc
 * comment already names as a gap ("a top-up made from Recharge... still
 * leaves the account card stale ... until the 30s staleTime lapses") —
 * which never invalidates this query. If the sheet reuses a NOT-stale
 * cached queue from before that seed, the freshly-seeded row is invisible
 * to the sheet: `isolateSelection` (the spec's checkbox-driving helper)
 * has nothing matching to check, the selection stays empty, and every
 * total — selected-total AND net alike — reads $0.00. That is what the
 * fix (`AccountSettleSheet` now passes `refetchOnMount: "always"` to this
 * query) closes: this test proves the mechanism by reusing ONE QueryClient
 * across two mounts, exactly like the shared Electron app instance the e2e
 * suite runs against.
 *
 * Failing-first proof (rule 17): temporarily reverting the second render's
 * options to omit `refetchOnMount: "always"` (i.e. simulating the pre-fix
 * `AccountSettleSheet`) makes this test fail with the second mount still
 * showing the STALE row set — reproducing "Received: 0" in miniature. That
 * revert was applied, observed failing, then reverted back; see the PR/
 * handover notes for the transcript. The assertions below run against the
 * FIXED component/hook.
 */

import { render, screen, waitFor, cleanup, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AccountSettleSheet } from "../AccountSettleSheet";
import type { AccountBalance, AccountUnsettledRow } from "../../hooks/useSuppliers";

const mockSettleSupplierAccount = jest.fn();
const mockGetSupplierAccountUnsettled = jest.fn();

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return {
    ...actual,
    useApi: () => ({
      settleSupplierAccount: mockSettleSupplierAccount,
      getSupplierAccountUnsettled: mockGetSupplierAccountUnsettled,
    }),
  };
});

jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: [{ code: "CASH", label: "Cash" }],
    drawerAffectingMethods: [],
    allMethods: [],
    loading: false,
    refresh: jest.fn(),
  }),
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 89500, buyRate: 89000, isLoading: false }),
}));

const ACCOUNT: AccountBalance = {
  account_supplier_id: 1,
  account_name: "OMT",
  total_usd: 0,
  total_lbp: 0,
  children: [
    {
      supplier_id: 1,
      name: "OMT",
      provider: "OMT",
      drawer_name: "OMT_System",
      total_usd: 0,
      total_lbp: 0,
      is_parent: true,
    },
  ],
};

/** The queue as it existed BEFORE the out-of-band seed (e.g. empty, like
 *  right after a prior test's settle emptied it out). */
const ROWS_BEFORE_SEED: AccountUnsettledRow[] = [];

/** A cashout credit row that appears ONLY after an out-of-band raw-IPC
 *  seed — analogous to the e2e spec's `seedOmtAppCashout`. */
const ROW_CASHOUT: AccountUnsettledRow = {
  kind: "LEDGER",
  id: 999,
  supplier_id: 2,
  source_provider: "OMT_APP",
  source_name: "OMT App",
  created_at: "2026-09-20T00:00:00Z",
  amount_usd: -337.34,
  amount_lbp: 0,
  entry_type: "PAYMENT",
  service_type: null,
  commission_usd: 0.34,
  commission_lbp: 0,
};
const ROWS_AFTER_SEED: AccountUnsettledRow[] = [ROW_CASHOUT];

describe("AccountSettleSheet — settle sheet must not settle against a stale queue", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows a row seeded AFTER the query was last cached, on a fresh sheet mount reusing the SAME QueryClient (production staleTime)", async () => {
    // Mirrors App.tsx's real QueryClient config (rule 28 — reproduce the
    // actual environment, not a jest-friendly staleTime of 0) and is reused
    // across both mounts below, exactly like the one long-lived Electron
    // renderer/QueryClient the e2e suite's `sharedPage` runs the WHOLE spec
    // file (and every other spec file) against.
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false },
        mutations: { retry: false },
      },
    });

    // First mount — analogous to a SupplierAccountCard/AccountSettleSheet
    // instance observing the queue BEFORE the out-of-band seed. Populates
    // the shared cache with the empty pre-seed queue.
    mockGetSupplierAccountUnsettled.mockResolvedValueOnce(ROWS_BEFORE_SEED);
    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <AccountSettleSheet account={ACCOUNT} onClose={jest.fn()} onSettled={jest.fn()} />
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(
        screen.getByText(/Nothing to settle on the OMT account/i),
      ).toBeInTheDocument();
    });
    unmount();

    // Out-of-band seed: a raw IPC call (e.g. `window.api.omt.*`, exactly
    // like the e2e spec's `seedOmtAppCashout`) adds the cashout row WITHOUT
    // touching the query cache — nothing here calls
    // `queryClient.invalidateQueries`, matching the real gap.
    mockGetSupplierAccountUnsettled.mockResolvedValueOnce(ROWS_AFTER_SEED);

    // Second mount, same QueryClient, well within the 30s staleTime — this
    // is the moment `AccountSettleSheet` reopens in the e2e spec's second
    // test.
    render(
      <QueryClientProvider client={queryClient}>
        <AccountSettleSheet account={ACCOUNT} onClose={jest.fn()} onSettled={jest.fn()} />
      </QueryClientProvider>,
    );

    // The fix (`refetchOnMount: "always"` in AccountSettleSheet) forces a
    // real refetch despite the cache being "fresh" — the row seeded
    // out-of-band must eventually be RENDERED. Without the fix this
    // `waitFor` times out with the row never appearing at all: the second
    // mount's FIRST render already resolves `isSuccess` from the shared
    // cache's stale (pre-seed, empty) data, and with a plain
    // `refetchOnMount: true` that data is not stale (30s `staleTime`), so
    // no network call is ever made — not merely delayed. (Verified by
    // temporarily removing the `refetchOnMount: "always"` override and
    // re-running this test: it fails on exactly this `waitFor`, per rule 17.)
    const row = await waitFor(
      () => {
        const found = screen.getByTestId("supplier-account-settle-row");
        expect(found).toHaveAttribute("data-row-id", "999");
        return found;
      },
      { timeout: 3000 },
    );

    // The preselect effect only auto-checks rows present at the FIRST
    // `isSuccess` (D8's own "not on every refetch" rule, so it never
    // silently re-checks something the admin deliberately unticked) —
    // since this row only exists after the forced re-fetch, it renders
    // UNCHECKED, exactly like every other not-yet-selected row. This
    // mirrors the e2e spec's own `isolateSelection`, which never trusts
    // preselection either and drives the checkbox directly.
    const toggle = within(row).getByTestId(
      "supplier-account-settle-row-toggle",
    );
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(
        screen.getByTestId("supplier-account-settle-net").textContent,
      ).toBe("-$337.34");
    });
    expect(
      screen.getByTestId("supplier-account-settle-selected-total").textContent,
    ).toBe("$337.34");
  });
});
