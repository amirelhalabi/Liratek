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
 *
 * LIRA-322 rewrite (rule 24 — intent kept): the sheet no longer has a
 * tick list or a merged "net" figure; the seeded row must show up in the
 * USD section's preview, which now reads "OMT pays you $337.34". The
 * `useApi` mock is now ONE stable object (rule 25). A second case guards
 * FR-021: when the server refuses a stale preview, the sheet refetches the
 * queue, shows the message and keeps the amount the operator typed (written
 * with the change — not proven failing-first).
 */

import {
  render,
  screen,
  waitFor,
  cleanup,
  fireEvent,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AccountSettleSheet } from "../AccountSettleSheet";
import type {
  AccountBalance,
  AccountUnsettledRow,
} from "../../hooks/useSuppliers";
import { queueRow } from "../../testing/accountSettleFixtures";

const mockSettleSupplierAccount = jest.fn();
const mockGetSupplierAccountUnsettled = jest.fn();
const mockApi = {
  settleSupplierAccount: mockSettleSupplierAccount,
  getSupplierAccountUnsettled: mockGetSupplierAccountUnsettled,
};

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  // Rule 25: ONE stable object, never a fresh literal per useApi() call.
  return { ...actual, useApi: () => mockApi };
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
const ROW_CASHOUT = queueRow({
  kind: "LEDGER",
  id: 999,
  supplier_id: 2,
  source_provider: "OMT_APP",
  source_name: "OMT App",
  created_at: "2026-09-20 00:00:00",
  amount_usd: -337.34,
  entry_type: "PAYMENT",
  service_type: null,
  commission_usd: 0.34,
  omt_service_type: null,
  commission_model: null,
});
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
    // across both mounts below, exactly like the one long-lived renderer.
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: 30_000,
          refetchOnWindowFocus: false,
        },
        mutations: { retry: false },
      },
    });

    // First mount — populates the shared cache with the empty queue.
    mockGetSupplierAccountUnsettled.mockResolvedValueOnce(ROWS_BEFORE_SEED);
    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <AccountSettleSheet
          account={ACCOUNT}
          onClose={jest.fn()}
          onSettled={jest.fn()}
        />
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(
        screen.getByText(/Nothing to settle on the OMT account/i),
      ).toBeInTheDocument();
    });
    unmount();

    // Out-of-band seed: nothing invalidates the query cache.
    mockGetSupplierAccountUnsettled.mockResolvedValueOnce(ROWS_AFTER_SEED);

    // Second mount, same QueryClient, well within the 30s staleTime.
    render(
      <QueryClientProvider client={queryClient}>
        <AccountSettleSheet
          account={ACCOUNT}
          onClose={jest.fn()}
          onSettled={jest.fn()}
        />
      </QueryClientProvider>,
    );

    // `refetchOnMount: "always"` forces a real refetch despite the "fresh"
    // cache — the seeded row must be RENDERED in the preview.
    const row = await waitFor(
      () => {
        const found = screen.getByTestId("supplier-account-settle-preview-row");
        expect(found).toHaveAttribute("data-row-id", "999");
        return found;
      },
      { timeout: 3000 },
    );
    expect(row).toBeInTheDocument();

    const usd = screen.getByTestId("supplier-account-settle-section-usd");
    expect(usd.textContent).toContain("OMT pays you");
    expect(
      within(usd).getByTestId("supplier-account-settle-owed-usd").textContent,
    ).toBe("$337.34");
  });

  it("FR-021: a stale refusal refetches the queue, shows the message and keeps the typed amount", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    mockGetSupplierAccountUnsettled.mockResolvedValue(ROWS_AFTER_SEED);
    mockSettleSupplierAccount.mockResolvedValue({
      success: false,
      error:
        "OMT's balance changed since you opened this sheet. Check the new amounts. (expected $-337.34 + 0 LBP, found $-300.00 + 0 LBP)",
    });
    render(
      <QueryClientProvider client={queryClient}>
        <AccountSettleSheet
          account={ACCOUNT}
          onClose={jest.fn()}
          onSettled={jest.fn()}
        />
      </QueryClientProvider>,
    );

    const usd = await screen.findByTestId(
      "supplier-account-settle-section-usd",
    );
    const amount = within(usd).getAllByTestId(
      /^payment-amount-/,
    )[0] as HTMLInputElement;
    fireEvent.change(amount, { target: { value: "337.34" } });
    const submit = screen.getByTestId("supplier-account-settle-submit");
    await waitFor(() => expect(submit).not.toBeDisabled());
    const fetchesBefore = mockGetSupplierAccountUnsettled.mock.calls.length;
    fireEvent.click(submit);

    expect(
      (await screen.findByTestId("supplier-account-settle-error")).textContent,
    ).toMatch(/^OMT's balance changed since you opened this sheet\./);
    await waitFor(() =>
      expect(mockGetSupplierAccountUnsettled.mock.calls.length).toBeGreaterThan(
        fetchesBefore,
      ),
    );
    const amountAfter = within(
      screen.getByTestId("supplier-account-settle-section-usd"),
    ).getAllByTestId(/^payment-amount-/)[0] as HTMLInputElement;
    expect(amountAfter.value.replace(/,/g, "")).toBe("337.34");
  });
});
