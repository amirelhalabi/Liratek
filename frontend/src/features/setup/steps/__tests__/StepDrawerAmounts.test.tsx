/** @jest-environment jsdom */
/**
 * StepDrawerAmounts — Carrier Lines section (LIRA carrier-lines-validity
 * Phase 2, §0.1). The invariant under test: a carrier's Credits field is the
 * ONLY place its starting balance is typed — the value must reach BOTH the
 * carrier_lines payload entry AND that carrier's drawer_amounts entry,
 * and the two can never disagree because they read the same state.
 *
 * Also covers GENERAL_DRAWER_UNRESTRICTED.md item 8 (D2/D5): the drawer's
 * currency set must come from `useApi().getCountableDrawerCurrencies()`
 * (base allowlist ∪ non-zero-balance currencies) — never a raw
 * `window.api.currencies.allDrawerCurrencies()` call (rule 19: that takes
 * the wrong branch in the browser and under the web-test window.api shim).
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import StepDrawerAmounts from "../StepDrawerAmounts";

const mockUpdatePayload = jest.fn();
const mockSetStep = jest.fn();
// Mutable so the module-gating test can switch it without re-mocking the
// module (jest.mock factories are hoisted and evaluated once).
let mockEnabledModules: string[] = ["pos", "inventory", "recharge"];

jest.mock("../../context/SetupContext", () => ({
  useSetup: () => ({
    payload: { enabled_modules: mockEnabledModules },
    updatePayload: mockUpdatePayload,
    setStep: mockSetStep,
  }),
}));

const mockGetCountableDrawerCurrencies = jest.fn();
const mockGetCurrencies = jest.fn();

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    getCountableDrawerCurrencies: mockGetCountableDrawerCurrencies,
    getCurrencies: mockGetCurrencies,
  }),
}));

describe("StepDrawerAmounts — Carrier Lines section", () => {
  beforeEach(() => {
    mockUpdatePayload.mockReset();
    mockSetStep.mockReset();
    mockEnabledModules = ["pos", "inventory", "recharge"];
    mockGetCountableDrawerCurrencies.mockReset();
    mockGetCurrencies.mockReset();
    // Mirrors the countable-currency contract
    // (GENERAL_DRAWER_UNRESTRICTED.md D2/D5): base allowlist ∪
    // non-zero-balance currencies, already deduplicated server-side. This is
    // what buildDrawerAmounts() iterates to decide which currencies a drawer
    // even has — matching production so the credits→drawer-amount
    // assertions below reflect real behaviour, not a test-only shortcut.
    mockGetCountableDrawerCurrencies.mockResolvedValue({
      General: ["USD", "LBP"],
      MTC: ["USD"],
      Alfa: ["USD"],
    });
    mockGetCurrencies.mockResolvedValue([]);
  });

  it("renders exactly one Credits field per carrier and feeds it into both the line and that carrier's drawer amount", async () => {
    render(<StepDrawerAmounts />);

    // Wait for the async countable-currency set (mocked above) to land —
    // buildDrawerAmounts() only emits a currency it knows the drawer has.
    await waitFor(() =>
      expect(screen.getByTestId("setup-amount-General-USD")).toBeTruthy(),
    );

    // Only one credits input exists for MTC — in the Carrier Lines section.
    expect(
      screen.queryByTestId("setup-amount-MTC-USD"),
    ).not.toBeInTheDocument();
    const mtcCredits = screen.getByTestId("setup-carrier-credits-MTC");

    fireEvent.change(mtcCredits, { target: { value: "25" } });
    fireEvent.change(screen.getByTestId("setup-carrier-phone-MTC"), {
      target: { value: "03123456" },
    });

    fireEvent.click(screen.getByText("Next →"));

    expect(mockUpdatePayload).toHaveBeenCalledTimes(1);
    const payload = mockUpdatePayload.mock.calls[0][0];

    expect(payload.carrier_lines).toEqual([
      {
        carrier: "mtc",
        phone_number: "03123456",
        label: null,
        credits: 25,
        validity_expires_at: null,
      },
    ]);
    expect(payload.drawer_amounts).toEqual(
      expect.arrayContaining([
        { drawer_name: "MTC", currency_code: "USD", amount: 25 },
      ]),
    );
  });

  it("does not create a line for a carrier with no phone number, even if credits were typed (D4 — soft nudge, never blocks)", async () => {
    render(<StepDrawerAmounts />);
    await waitFor(() =>
      expect(screen.getByTestId("setup-amount-General-USD")).toBeTruthy(),
    );

    fireEvent.change(screen.getByTestId("setup-carrier-credits-MTC"), {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByText("Next →"));

    const payload = mockUpdatePayload.mock.calls[0][0];
    expect(payload.carrier_lines).toEqual([]);
    // The typed amount still reaches the drawer even without a line, exactly
    // like every other drawer on this step.
    expect(payload.drawer_amounts).toEqual(
      expect.arrayContaining([
        { drawer_name: "MTC", currency_code: "USD", amount: 10 },
      ]),
    );
  });

  it("Skip clears carrier_lines alongside drawer_amounts", () => {
    render(<StepDrawerAmounts />);

    fireEvent.change(screen.getByTestId("setup-carrier-credits-MTC"), {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByText("Skip"));

    expect(mockUpdatePayload).toHaveBeenCalledWith({
      drawer_amounts: [],
      drawer_currency_config: [],
      carrier_lines: [],
    });
  });

  it("omits the Carrier Lines section entirely when the recharge module is disabled", () => {
    mockEnabledModules = ["pos", "inventory"];
    render(<StepDrawerAmounts />);

    expect(screen.queryByText(/Carrier Lines/)).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("setup-carrier-credits-MTC"),
    ).not.toBeInTheDocument();
  });

  describe("countable currency set (GENERAL_DRAWER_UNRESTRICTED.md D2/D5)", () => {
    it("renders a field for a currency a restricted drawer holds even though its allowlist omits it, and omits a zero-balance exotic", async () => {
      mockEnabledModules = ["pos", "inventory", "recharge", "ipec_katch"];
      mockGetCountableDrawerCurrencies.mockResolvedValue({
        General: ["USD", "LBP"],
        MTC: ["USD"],
        Alfa: ["USD"],
        // Katsh's configured allowlist is LBP-only, but it also holds a
        // non-zero USD balance — the countable read (base ∪ non-zero
        // balances) already folds that in. The frontend must render exactly
        // what it's given, not re-filter back down to some hardcoded set.
        Katsh: ["LBP", "USD"],
      });
      // USDT is active shop-wide but Katsh holds zero of it, so it must
      // never appear — the D2-rejected "every active currency" behaviour.
      mockGetCurrencies.mockResolvedValue([
        { code: "USD", name: "US Dollar", is_active: 1 },
        { code: "LBP", name: "Lebanese Pound", is_active: 1 },
        { code: "USDT", name: "Tether", is_active: 1 },
      ]);

      render(<StepDrawerAmounts />);

      expect(
        await screen.findByTestId("setup-amount-Katsh-USD"),
      ).toBeInTheDocument();
      expect(screen.getByTestId("setup-amount-Katsh-LBP")).toBeInTheDocument();
      expect(
        screen.queryByTestId("setup-amount-Katsh-USDT"),
      ).not.toBeInTheDocument();
    });

    it("does not render a duplicate field when a currency is present in the countable set only once (General USD/LBP, no phantom extras)", async () => {
      render(<StepDrawerAmounts />);

      await screen.findByTestId("setup-amount-General-USD");

      expect(screen.getAllByTestId("setup-amount-General-USD")).toHaveLength(1);
      expect(screen.getAllByTestId("setup-amount-General-LBP")).toHaveLength(1);
    });
  });
});
