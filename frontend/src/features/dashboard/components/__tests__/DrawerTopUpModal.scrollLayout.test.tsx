/** @jest-environment jsdom */

// NOT RUN — proven at the end-of-batch gate.
//
// LIRA-141 follow-up — DrawerTopUpModal carried the same latent pattern
// TopUpModal.tsx had (OWNER_NOTES_REMAINING_BUILD.md #lira-141 scout
// findings, "Sibling with the same pattern"): the panel had no `max-h`, and
// Cancel/the submit button sat inside the SAME unbounded `p-6` div as every
// other section (header, mode toggle, and the mode-specific body), with no
// scroll container anywhere. It was not failing in the current e2e window,
// but any mode whose content grows (extra-currency picker, negative-balance
// panel, notes) is one step away from the exact lira-141 failure.
//
// The fix applies the same scrollable-modal shape as TopUpModal.tsx /
// CashReportModal: the panel is `max-h-[90vh] flex flex-col`; the header is
// `shrink-0`; the mode toggle + mode body are wrapped together in one
// `flex-1 min-h-0 overflow-y-auto` container; the footer (Cancel/submit) is
// pulled out into its own `shrink-0` section below that container, no
// longer a descendant of it.
//
// jsdom has no layout engine, so — like TopUpModal.scrollLayout.test.tsx —
// this only pins the structure, not real scrolling.
//
// Rule 17: fails against the pre-fix markup, where the panel div has no
// `overflow-y-auto`/`max-h-` classes anywhere (`w-full max-w-md bg-slate-800
// border border-slate-700 rounded-xl shadow-2xl p-6`, no `flex flex-col`),
// so the very first assertion (a scroll container exists) fails outright.
// Per the owner process rule for this batch, not executed yet.

import { render, screen } from "@testing-library/react";

import { DrawerTopUpModal } from "../DrawerTopUpModal";

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
  Select: ({
    value,
    onChange,
    options,
  }: {
    value: string;
    onChange: (v: string) => void;
    options: Array<{ value: string; label: string }>;
  }) => (
    <select
      data-testid="source-drawer-select"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
  DecimalInput: ({
    value,
    onChange,
    "data-testid": testId,
  }: {
    value: number;
    onChange: (n: number) => void;
    "data-testid"?: string;
  }) => (
    <input
      type="text"
      data-testid={testId}
      value={value === 0 ? "" : String(value)}
      onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
    />
  ),
}));

const mockApi = {
  drawerTopUp: {
    getSourceDrawers: jest.fn().mockResolvedValue({ success: true, data: [] }),
    create: jest.fn().mockResolvedValue({ success: true }),
    createFromDrawer: jest.fn().mockResolvedValue({ success: true }),
  },
  getSystemExpectedBalancesDynamic: jest.fn().mockResolvedValue({}),
  transferBetweenDrawers: jest.fn().mockResolvedValue({ success: true }),
  getRates: jest.fn().mockResolvedValue([]),
};

jest.mock("@/contexts/CurrencyContext", () => ({
  useCurrencyContext: () => ({
    activeCurrencies: [],
    getCurrenciesForDrawer: jest.fn().mockResolvedValue([]),
  }),
}));

jest.mock("@/utils/liveExchangeRates", () => ({
  fetchLiveRatesSnapshot: jest.fn().mockResolvedValue({
    raw: {},
    rates: [],
    marketRates: [],
    lastUpdatedUtc: "",
    nextUpdateUnix: 0,
  }),
  CURRENCY_NAMES: {},
  getCurrencySymbol: (code: string) => code,
}));

jest.mock("@/hooks/useShopBase", () => ({
  useShopBase: () => ({ baseSystem: "OMT" }),
}));

jest.mock("@/shared/hooks/useModalFocusFix", () => ({
  useModalFocusFix: jest.fn(),
}));

describe("DrawerTopUpModal — scrollable-modal layout (LIRA-141 follow-up)", () => {
  it("keeps Cancel/submit outside the scrolling body, in a fixed footer", () => {
    render(<DrawerTopUpModal isOpen onClose={jest.fn()} onSuccess={jest.fn()} />);

    const scrollBody = document.querySelector('[class*="overflow-y-auto"]');
    expect(scrollBody).not.toBeNull();

    const cancelButton = screen.getByRole("button", { name: /cancel/i });
    const submitButton = screen.getByTestId("drawer-topup-submit");

    expect(scrollBody?.contains(cancelButton)).toBe(false);
    expect(scrollBody?.contains(submitButton)).toBe(false);

    const panel = submitButton.closest('[class*="max-h-"]');
    expect(panel).not.toBeNull();
  });
});
