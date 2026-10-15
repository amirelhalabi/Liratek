/** @jest-environment jsdom */

/**
 * LIRA-322 (US2, T025) — before confirming, each currency section previews
 * what the money will close, oldest first: Cash $300 against the six USD
 * transfers closes $152 and $101, part-pays the next $101 ($47 applied, $54
 * still owed) and leaves three untouched; $197 is still owed after. The LBP
 * section is not affected by USD money. An amount above what is owed says
 * the extra goes on the account.
 *
 * Owner 2026-10-15 (one-box follow-up): $ and LBP share ONE payment box, so
 * the $300 case types $300 on the USD line and leaves the LBP line at its
 * pre-filled 900,000 LBP (the mock's screen B): the LBP transfer closes and
 * "Still owed after" reads "$197.00 · 0 LBP". Rewritten after the sheet
 * change — not proven failing-first.
 */

import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AccountSettleSheet } from "../AccountSettleSheet";
import type { AccountUnsettledRow } from "../../hooks/useSuppliers";
import {
  LBP_ROW,
  OMT_ACCOUNT,
  SIX_USD_ROWS,
} from "../../testing/accountSettleFixtures";

const mockSettleSupplierAccount = jest.fn();
const mockGetSupplierAccountUnsettled = jest.fn();
const mockApi = {
  settleSupplierAccount: mockSettleSupplierAccount,
  getSupplierAccountUnsettled: mockGetSupplierAccountUnsettled,
};

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
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

function renderSheet(rows: AccountUnsettledRow[]) {
  mockGetSupplierAccountUnsettled.mockResolvedValue(rows);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <AccountSettleSheet
        account={OMT_ACCOUNT}
        onClose={jest.fn()}
        onSettled={jest.fn()}
      />
    </QueryClientProvider>,
  );
}

function amountInput(section: HTMLElement): HTMLInputElement {
  return within(section).getAllByTestId(
    /^payment-amount-/,
  )[0] as HTMLInputElement;
}

function previewStatuses(preview: HTMLElement) {
  return within(preview)
    .getAllByTestId("supplier-account-settle-preview-row")
    .map((r) => [r.getAttribute("data-row-id"), r.getAttribute("data-status")]);
}

describe("AccountSettleSheet — per-currency preview (LIRA-322 US2)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSettleSupplierAccount.mockResolvedValue({ success: true, id: 900 });
  });

  it("Cash $300 + 900,000 LBP: 2 close, 1 part-paid ($47 of $101 · $54 owed), 3 untouched, $197.00 · 0 LBP still owed", async () => {
    renderSheet([...SIX_USD_ROWS, LBP_ROW]);

    const usd = await screen.findByTestId(
      "supplier-account-settle-section-usd-lbp",
    );
    // Line 1 is USD; line 2 (LBP) stays pre-filled with 900,000.
    fireEvent.change(amountInput(usd), { target: { value: "300" } });

    const preview = within(usd).getByTestId(
      "supplier-account-settle-preview-usd",
    );
    await waitFor(() =>
      expect(previewStatuses(preview)).toEqual([
        ["101", "closes"],
        ["102", "closes"],
        ["103", "part-paid"],
        ["104", "untouched"],
        ["105", "untouched"],
        ["106", "untouched"],
      ]),
    );
    const partial = within(preview)
      .getAllByTestId("supplier-account-settle-preview-row")
      .find((r) => r.getAttribute("data-status") === "part-paid")!;
    expect(partial.textContent).toContain("$47 of $101 · $54 owed");
    expect(
      within(usd).getByTestId("supplier-account-settle-still-owed-usd")
        .textContent,
    ).toBe("$197.00");
    // The box's own Remaining row names only the short currency.
    expect(within(usd).getByTestId("remaining-amount").textContent).toBe(
      "$197.00",
    );

    const lbpPreview = within(usd).getByTestId(
      "supplier-account-settle-preview-lbp",
    );
    expect(previewStatuses(lbpPreview)).toEqual([["201", "closes"]]);
    expect(
      within(usd).getByTestId("supplier-account-settle-still-owed-lbp")
        .textContent,
    ).toBe("0 LBP");
  });

  it("an amount above what is owed says the extra goes on the account", async () => {
    renderSheet([...SIX_USD_ROWS]);

    const usd = await screen.findByTestId(
      "supplier-account-settle-section-usd",
    );
    fireEvent.change(amountInput(usd), { target: { value: "507.11" } });
    // "Account": nothing is handed back (the default hands the change back).
    await waitFor(() =>
      expect(within(usd).getByTestId("return-change")).toBeInTheDocument(),
    );
    fireEvent.click(within(usd).getByTestId("change-destination-account"));

    await waitFor(() =>
      expect(
        within(usd).getByTestId("supplier-account-settle-extra-usd")
          .textContent,
      ).toMatch(/\$10\.11.*goes on the account/),
    );
    expect(
      within(usd).getByTestId("supplier-account-settle-still-owed-usd")
        .textContent,
    ).toBe("$0.00");
  });
});
