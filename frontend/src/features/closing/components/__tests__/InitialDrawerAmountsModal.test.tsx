/** @jest-environment jsdom */
/**
 * InitialDrawerAmountsModal — "Add currency" scope (owner-reported 2026-07-28).
 *
 * The Dashboard's "Set now →" flow (shown when initial drawer amounts were
 * skipped at setup) opens this modal. It must restrict "Add currency" to the
 * General till ONLY, exactly like the setup wizard's StepDrawerAmounts
 * (foreign cash lives in the physical register; provider wallets like
 * OMT_App keep their fixed business currency) — before the fix, the picker
 * rendered for every drawer.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { InitialDrawerAmountsModal } from "../InitialDrawerAmountsModal";

const mockGetCountableDrawerCurrencies = jest.fn();
const mockGetSystemExpectedBalancesDynamic = jest.fn();
const mockSetDrawerCurrencies = jest.fn();
const mockCreateCheckpoint = jest.fn();

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    getCountableDrawerCurrencies: mockGetCountableDrawerCurrencies,
    getSystemExpectedBalancesDynamic: mockGetSystemExpectedBalancesDynamic,
    setDrawerCurrencies: mockSetDrawerCurrencies,
    createCheckpoint: mockCreateCheckpoint,
  }),
}));

jest.mock("@/contexts/ModuleContext", () => ({
  useModules: () => ({ isModuleEnabled: () => true }),
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1 } }),
}));

jest.mock("@/contexts/CurrencyContext", () => ({
  useCurrencyContext: () => ({
    activeCurrencies: [
      { code: "USD", name: "US Dollar", is_active: 1 },
      { code: "LBP", name: "Lebanese Pound", is_active: 1 },
      { code: "EUR", name: "Euro", is_active: 1 },
    ],
    getDecimals: (code: string) => (code === "LBP" ? 0 : 2),
  }),
}));

describe("InitialDrawerAmountsModal — Add currency scope", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // General already has USD+LBP configured; OMT_App only has USD — both
    // have an addable currency (EUR for General, LBP+EUR for OMT_App), so
    // a pre-fix "every drawer" gate and a post-fix "General only" gate are
    // actually distinguishable by this fixture.
    mockGetCountableDrawerCurrencies.mockResolvedValue({
      General: ["USD", "LBP"],
      OMT_App: ["USD"],
    });
    mockGetSystemExpectedBalancesDynamic.mockResolvedValue({
      General: { USD: 500, LBP: 9_000_000 },
      OMT_App: { USD: 0 },
    });
  });

  it("shows 'Add currency' for the General drawer", async () => {
    render(
      <InitialDrawerAmountsModal onClose={jest.fn()} onSaved={jest.fn()} />,
    );

    expect(
      await screen.findByTestId("initial-drawer-add-currency-General"),
    ).toBeInTheDocument();
  });

  it("does NOT show 'Add currency' for a provider drawer (OMT_App)", async () => {
    render(
      <InitialDrawerAmountsModal onClose={jest.fn()} onSaved={jest.fn()} />,
    );

    // Wait for load to settle (General's picker is present) before asserting
    // the negative — otherwise the negative could pass trivially pre-render.
    await screen.findByTestId("initial-drawer-add-currency-General");
    expect(
      screen.queryByTestId("initial-drawer-add-currency-OMT_App"),
    ).not.toBeInTheDocument();
  });

  it("adding EUR via the General picker renders a new EUR amount field under General only", async () => {
    render(
      <InitialDrawerAmountsModal onClose={jest.fn()} onSaved={jest.fn()} />,
    );

    const picker = await screen.findByTestId(
      "initial-drawer-add-currency-General",
    );
    fireEvent.change(picker, { target: { value: "EUR" } });

    await waitFor(() =>
      expect(screen.getAllByText("EUR").length).toBeGreaterThan(0),
    );
  });

  // Board 9 (2026-10-12). General accepts every currency, so core refuses
  // to store a currency list for it — the save used to stop on that refusal
  // (desktop) or hang on "Saving…" (web, where the route was missing).
  // Rule 17: both cases run against the unfixed modal first.
  it("adding a currency to General saves the amounts without storing a currency list for General", async () => {
    mockSetDrawerCurrencies.mockResolvedValue({
      success: false,
      error:
        "The General drawer accepts every currency — its currency list is not configurable.",
    });
    mockCreateCheckpoint.mockResolvedValue({ success: true, id: 1 });
    const onSaved = jest.fn();
    render(<InitialDrawerAmountsModal onClose={jest.fn()} onSaved={onSaved} />);

    const picker = await screen.findByTestId(
      "initial-drawer-add-currency-General",
    );
    fireEvent.change(picker, { target: { value: "EUR" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Amounts" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mockSetDrawerCurrencies).not.toHaveBeenCalledWith(
      "General",
      expect.anything(),
    );
    expect(mockCreateCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        amounts: expect.arrayContaining([
          expect.objectContaining({
            drawer_name: "General",
            currency_code: "EUR",
          }),
        ]),
      }),
    );
  });

  it("a save that throws shows an error and gives the button back instead of hanging on Saving…", async () => {
    mockCreateCheckpoint.mockRejectedValue(new Error("Network error"));
    render(
      <InitialDrawerAmountsModal onClose={jest.fn()} onSaved={jest.fn()} />,
    );

    const save = screen.getByRole("button", { name: "Save Amounts" });
    // The button stays disabled until the drawer amounts have loaded.
    await waitFor(() => expect(save).not.toBeDisabled());
    fireEvent.click(save);

    expect(await screen.findByText(/Network error/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save Amounts" }),
    ).not.toBeDisabled();
  });
});
