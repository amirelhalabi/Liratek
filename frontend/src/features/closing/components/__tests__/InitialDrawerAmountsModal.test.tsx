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
});
