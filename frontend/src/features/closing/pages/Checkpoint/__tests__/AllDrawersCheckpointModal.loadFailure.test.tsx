/** @jest-environment jsdom */
/**
 * Checkpoint — a count sheet that failed to load can't be saved
 * (shop-day test 2026-10-16).
 *
 * Under a rate-limit burst (HTTP 429) the "Checkpoint — all drawers" window
 * showed "Failed to load currencies" with Save STILL enabled, so a cashier
 * could save an empty or wrong checkpoint. Save is now disabled until the
 * currencies, the drawer's currency list and the expected balances have all
 * loaded, and the card offers Retry, which loads them again.
 */
import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import AllDrawersCheckpointModal from "../AllDrawersCheckpointModal";

const mockCreateCheckpoint = jest.fn();

// Rule 25: ONE stable adapter object — every drawer section's hooks call
// useApi() independently.
const mockApi = {
  getCurrencies: jest.fn(),
  getCountableDrawerCurrencies: jest.fn(),
  getSystemExpectedBalancesDynamic: jest.fn(),
  getActiveCarrierLines: jest.fn().mockResolvedValue([]),
  partners: { getAll: jest.fn().mockResolvedValue([]) },
  createCheckpoint: mockCreateCheckpoint,
  getDailyStatsSnapshot: jest.fn().mockResolvedValue({}),
  generatePDF: jest.fn().mockResolvedValue({ success: false }),
  updateDailyClosing: jest.fn().mockResolvedValue({ success: true }),
  getRates: jest
    .fn()
    .mockResolvedValue([
      { to_code: "LBP", market_rate: 89500, buy_rate: 89000, sell_rate: 90000 },
    ]),
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

jest.mock("@/hooks/useShopBase", () => ({
  useShopBase: () => ({
    baseSystem: "OMT",
    partnerSystem: "WHISH",
    loading: false,
  }),
}));

const CURRENCIES = [
  { id: 1, code: "USD", name: "US Dollar", symbol: "$", is_active: 1 },
  { id: 2, code: "LBP", name: "Lebanese Pound", symbol: "LBP", is_active: 1 },
];
const RATE_LIMITED = new Error("Too many requests");

/** Let every load the card started settle (resolve or fail). */
async function settle() {
  await waitFor(() => {
    expect(mockApi.getCurrencies).toHaveBeenCalled();
    expect(mockApi.getCountableDrawerCurrencies).toHaveBeenCalled();
    expect(mockApi.getSystemExpectedBalancesDynamic).toHaveBeenCalled();
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

function renderGeneral() {
  render(
    <AllDrawersCheckpointModal
      isOpen
      drawers={[{ name: "General", countedToday: false }]}
      onClose={jest.fn()}
    />,
  );
  return screen.getByTestId("checkpoint-drawer-General");
}

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.getCurrencies.mockResolvedValue(CURRENCIES);
  mockApi.getCountableDrawerCurrencies.mockResolvedValue({
    General: ["USD", "LBP"],
  });
  mockApi.getSystemExpectedBalancesDynamic.mockResolvedValue({
    General: { USD: 100, LBP: 500_000 },
  });
});

describe("Checkpoint — Save stays off until the sheet has loaded", () => {
  it("currencies failed (429): Save disabled, Retry loads them and enables Save", async () => {
    mockApi.getCurrencies.mockRejectedValueOnce(RATE_LIMITED);
    const general = renderGeneral();
    const save = within(general).getByTestId("checkpoint-save-General");
    await settle();
    expect(save).toBeDisabled();
    const retry = await within(general).findByRole("button", {
      name: /retry/i,
    });

    fireEvent.click(retry);
    await within(general).findByLabelText("USD");
    await waitFor(() => expect(save).toBeEnabled());
  });

  it("expected balances failed: Save disabled with Retry", async () => {
    mockApi.getSystemExpectedBalancesDynamic.mockRejectedValueOnce(
      RATE_LIMITED,
    );
    const general = renderGeneral();
    await settle();
    expect(
      within(general).getByTestId("checkpoint-save-General"),
    ).toBeDisabled();
    await within(general).findByRole("button", { name: /retry/i });

    fireEvent.click(within(general).getByRole("button", { name: /retry/i }));
    await waitFor(() =>
      expect(
        within(general).getByTestId("checkpoint-save-General"),
      ).toBeEnabled(),
    );
    expect(mockApi.getSystemExpectedBalancesDynamic).toHaveBeenCalledTimes(2);
  });

  it("the drawer's currency list failed: Save disabled with Retry", async () => {
    mockApi.getCountableDrawerCurrencies.mockRejectedValueOnce(RATE_LIMITED);
    const general = renderGeneral();
    await settle();
    expect(
      within(general).getByTestId("checkpoint-save-General"),
    ).toBeDisabled();
    await within(general).findByRole("button", { name: /retry/i });

    fireEvent.click(within(general).getByRole("button", { name: /retry/i }));
    await waitFor(() =>
      expect(
        within(general).getByTestId("checkpoint-save-General"),
      ).toBeEnabled(),
    );
    expect(mockApi.getCountableDrawerCurrencies).toHaveBeenCalledTimes(2);
  });
});
