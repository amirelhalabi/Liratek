/** @jest-environment jsdom */
/**
 * Checkpoint (per-drawer count sheet) — item 8 of
 * docs/plans/todo_plans/GENERAL_DRAWER_UNRESTRICTED.md.
 *
 * Before this fix, `Checkpoint/index.tsx` re-split the server's ONE
 * count-sheet list (`getCountableDrawerCurrencies()`) into `coreCurrencies`
 * (intersected against a hardcoded `["USD","LBP","EUR","USDT"]` whitelist)
 * and, for General only, `otherCurrencies` (the same list minus
 * `{USD,LBP,EUR}`). USDT landed in BOTH — `DrawerCard` rendered both lists
 * independently with no dedup, so General's checkpoint carried two USDT
 * inputs, and `statusFields` (`[...coreCurrencies, ...otherCurrencies]`)
 * double-counted USDT in the variance/save-button summary.
 *
 * The fix: the server already returns one deduplicated, correctly-ordered
 * set per drawer (base allowlist ∪ non-zero balances). The page renders that
 * ONE list verbatim — no re-filtering against a whitelist, no
 * `drawerName === "General"` special case — and `DrawerCard` lost the
 * `otherCurrencies` prop and everything it drove (Coins button, tooltip,
 * popup), so the second render path is gone, not just unused.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CheckpointModal from "../index";

const mockGetCurrencies = jest.fn();
const mockGetCountableDrawerCurrencies = jest.fn();
const mockGetSystemExpectedBalancesDynamic = jest.fn();
const mockGetActiveCarrierLines = jest.fn();
const mockPartnersGetAll = jest.fn();
const mockCreateCheckpoint = jest.fn();

// STABLE object reference — several hooks here (useCurrencies,
// useSystemExpected) call useApi() independently; a fresh literal per call
// would re-trigger their load effects forever (same trap as
// CurrencyManager.drawerGrid.test.tsx).
const mockApi = {
  getCurrencies: mockGetCurrencies,
  getCountableDrawerCurrencies: mockGetCountableDrawerCurrencies,
  getSystemExpectedBalancesDynamic: mockGetSystemExpectedBalancesDynamic,
  getActiveCarrierLines: mockGetActiveCarrierLines,
  partners: { getAll: mockPartnersGetAll },
  createCheckpoint: mockCreateCheckpoint,
  getDailyStatsSnapshot: jest.fn().mockResolvedValue({}),
  generatePDF: jest.fn().mockResolvedValue({ success: false }),
  updateDailyClosing: jest.fn().mockResolvedValue({ success: true }),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1 } }),
}));

jest.mock("@/shared/hooks/useModalFocusFix", () => ({
  useModalFocusFix: jest.fn(),
}));

// drawerName is "General" throughout, which never equals partnerDrawerName
// ("Whish_System" here), so isPartnerDrawerInactive stays false regardless —
// this hook is mocked purely to avoid useShopBase's real network call.
jest.mock("@/hooks/useShopBase", () => ({
  useShopBase: () => ({
    baseSystem: "OMT",
    partnerSystem: "WHISH",
    loading: false,
  }),
}));

// Mirrors the live DB shape (GENERAL_DRAWER_UNRESTRICTED.md §8 evidence):
// USD, LBP, EUR, USDT all active.
const ACTIVE_CURRENCIES = [
  { id: 1, code: "USD", name: "US Dollar", symbol: "$", is_active: 1 },
  { id: 2, code: "LBP", name: "Lebanese Pound", symbol: "LBP", is_active: 1 },
  { id: 3, code: "EUR", name: "Euro", symbol: "€", is_active: 1 },
  { id: 4, code: "USDT", name: "Tether", symbol: "USDT", is_active: 1 },
];

function renderCheckpoint() {
  return render(
    <CheckpointModal isOpen drawerName="General" onClose={jest.fn()} />,
  );
}

describe("Checkpoint count sheet — General drawer (item 8)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrencies.mockResolvedValue(ACTIVE_CURRENCIES);
    mockPartnersGetAll.mockResolvedValue([]);
    mockGetActiveCarrierLines.mockResolvedValue([]);
    mockCreateCheckpoint.mockResolvedValue({ success: true, id: 1 });
  });

  it("(a) renders exactly one input per currency code — no duplicate USDT field", async () => {
    // A realistic post-fix server response: USDT is held (non-zero), so it's
    // in the ONE list the server returns.
    mockGetCountableDrawerCurrencies.mockResolvedValue({
      General: ["USD", "LBP", "USDT"],
    });
    mockGetSystemExpectedBalancesDynamic.mockResolvedValue({
      General: { USD: 100, LBP: 500_000, EUR: 0, USDT: 50 },
    });

    renderCheckpoint();

    await screen.findByLabelText("USDT");
    expect(screen.getAllByLabelText("USD")).toHaveLength(1);
    expect(screen.getAllByLabelText("LBP")).toHaveLength(1);
    expect(screen.getAllByLabelText("USDT")).toHaveLength(1);

    // The second render path itself must not exist any more, not merely be
    // unopened — the "Other currencies" trigger drove the duplicate popup.
    expect(
      screen.queryByTitle("Other currencies"),
    ).not.toBeInTheDocument();
  });

  it("(b) omits EUR and USDT fields for General when their balance is zero", async () => {
    // D2: base (USD+LBP for an unrestricted drawer) only — no exotic held.
    mockGetCountableDrawerCurrencies.mockResolvedValue({
      General: ["USD", "LBP"],
    });
    mockGetSystemExpectedBalancesDynamic.mockResolvedValue({
      General: { USD: 100, LBP: 500_000, EUR: 0, USDT: 0 },
    });

    renderCheckpoint();

    await screen.findByLabelText("USD");
    await waitFor(() => {
      expect(screen.queryByLabelText("EUR")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("USDT")).not.toBeInTheDocument();
    });
  });

  it("(c) shows the EUR field once EUR carries a held (non-zero) balance", async () => {
    mockGetCountableDrawerCurrencies.mockResolvedValue({
      General: ["USD", "LBP", "EUR"],
    });
    mockGetSystemExpectedBalancesDynamic.mockResolvedValue({
      General: { USD: 100, LBP: 500_000, EUR: 300, USDT: 0 },
    });

    renderCheckpoint();

    await screen.findByLabelText("USD");
    await waitFor(() => {
      expect(screen.getAllByLabelText("EUR")).toHaveLength(1);
    });
    expect(screen.queryByLabelText("USDT")).not.toBeInTheDocument();
  });

  it("(d) counts each currency once in the variance/save-button summary", async () => {
    mockGetCountableDrawerCurrencies.mockResolvedValue({
      General: ["USD", "LBP", "USDT"],
    });
    mockGetSystemExpectedBalancesDynamic.mockResolvedValue({
      General: { USD: 100, LBP: 500_000, EUR: 0, USDT: 50 },
    });

    renderCheckpoint();

    const usdtField = await screen.findByLabelText("USDT");
    // Move USDT away from its expected value (50) so it produces exactly one
    // variance entry. Under the old coreCurrencies/otherCurrencies split,
    // USDT appeared in BOTH lists, so `statusFields` iterated it twice and
    // the save button listed it twice.
    fireEvent.change(usdtField, { target: { value: "10" } });

    await waitFor(() => {
      const saveButton = screen.getByRole("button", { name: /Save/ });
      const usdtMentions = (saveButton.textContent?.match(/USDT/g) ?? [])
        .length;
      expect(usdtMentions).toBe(1);
    });
  });

  it("(e) still renders a count field for a currency the server reports as countable even after it was deactivated (BLOCKER regression)", async () => {
    // A currency that is deactivated while still holding cash MUST stay
    // countable — CurrencyRepository.getNonZeroBalancesForDrawer/
    // derivedCurrencyCodesForDrawer ignore is_active for held balances by
    // design ("a currency that was deactivated while holding cash stays
    // visible and countable"). getCountableDrawerCurrencies() correctly
    // still returns it here.
    mockGetCurrencies.mockResolvedValue([
      { id: 1, code: "USD", name: "US Dollar", symbol: "$", is_active: 1 },
      {
        id: 2,
        code: "LBP",
        name: "Lebanese Pound",
        symbol: "LBP",
        is_active: 1,
      },
      // EUR is now DEACTIVATED but the drawer still holds 300 of it.
      { id: 3, code: "EUR", name: "Euro", symbol: "€", is_active: 0 },
    ]);
    mockGetCountableDrawerCurrencies.mockResolvedValue({
      General: ["USD", "LBP", "EUR"],
    });
    mockGetSystemExpectedBalancesDynamic.mockResolvedValue({
      General: { USD: 100, LBP: 500_000, EUR: 300 },
    });

    renderCheckpoint();

    await screen.findByLabelText("USD");
    // Before the fix, Checkpoint/index.tsx intersected the server's
    // countable set against `useCurrencies()`'s ACTIVE-ONLY list, so a
    // deactivated-but-held currency silently dropped out and no field
    // rendered for it.
    await waitFor(() => {
      expect(screen.getByLabelText("EUR")).toBeInTheDocument();
    });
  });
});
