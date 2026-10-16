/** @jest-environment jsdom */
/**
 * InitialDrawerAmountsModal — a failed load says so and offers Retry
 * (shop-day test 2026-10-16, 429 rate-limit burst).
 *
 * The drawers/balances load had no error handling: on a failed request the
 * window stayed empty with Save greyed out and no message — the only way
 * out was "Skip for now". It now says the drawers could not be loaded and
 * offers Retry; Save stays off until they load.
 *
 * Rule 25: `useApi` returns ONE stable object.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { InitialDrawerAmountsModal } from "../InitialDrawerAmountsModal";

const mockApi = {
  getCountableDrawerCurrencies: jest.fn(),
  getSystemExpectedBalancesDynamic: jest.fn(),
  setDrawerCurrencies: jest.fn(),
  createCheckpoint: jest.fn(),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
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
    ],
    getDecimals: (code: string) => (code === "LBP" ? 0 : 2),
  }),
}));

describe("InitialDrawerAmountsModal — load failure", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApi.getCountableDrawerCurrencies.mockResolvedValue({
      General: ["USD", "LBP"],
    });
    mockApi.getSystemExpectedBalancesDynamic.mockResolvedValue({
      General: { USD: 0, LBP: 0 },
    });
  });

  it("shows the failure with Retry; Retry loads the drawers and enables Save", async () => {
    mockApi.getSystemExpectedBalancesDynamic.mockRejectedValueOnce(
      new Error("Too many requests"),
    );
    render(
      <InitialDrawerAmountsModal onClose={jest.fn()} onSaved={jest.fn()} />,
    );
    const retry = await screen.findByRole("button", { name: /retry/i });
    expect(screen.getByRole("button", { name: "Save Amounts" })).toBeDisabled();

    fireEvent.click(retry);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Save Amounts" }),
      ).toBeEnabled(),
    );
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  });
});
