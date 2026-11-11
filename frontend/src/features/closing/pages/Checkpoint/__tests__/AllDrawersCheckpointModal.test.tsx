/**
 * AllDrawersCheckpointModal — 2 per-ticket test files merged into one suite
 * (2026-11-11, owner decision: one module boot instead of 2).
 *
 * Each former file is one describe block below, named after it; its own
 * header comment (including its rule-17 failing-first history) is kept at the
 * top of its block, and its test bodies are unchanged. Every former file
 * declared exactly the same jest.mock set and shared mock setup, which is
 * kept once at the top. Each block starts with resetBetweenFiles(), which
 * puts the shared mocks back to how a fresh file would see them, so no block
 * depends on state left by the block above it.
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

function resetBetweenFiles() {
  jest.clearAllMocks();
  (mockCreateCheckpoint as unknown as jest.Mock).mockReset();
  (mockApi.getCurrencies as unknown as jest.Mock).mockReset();
  (mockApi.getCountableDrawerCurrencies as unknown as jest.Mock).mockReset();
  (
    mockApi.getSystemExpectedBalancesDynamic as unknown as jest.Mock
  ).mockReset();
  (mockApi.getActiveCarrierLines as unknown as jest.Mock).mockReset();
  (mockApi.getActiveCarrierLines as unknown as jest.Mock).mockResolvedValue([]);
  (mockApi.partners.getAll as unknown as jest.Mock).mockReset();
  (mockApi.partners.getAll as unknown as jest.Mock).mockResolvedValue([]);
  (mockApi.getDailyStatsSnapshot as unknown as jest.Mock).mockReset();
  (mockApi.getDailyStatsSnapshot as unknown as jest.Mock).mockResolvedValue({});
  (mockApi.generatePDF as unknown as jest.Mock).mockReset();
  (mockApi.generatePDF as unknown as jest.Mock).mockResolvedValue({
    success: false,
  });
  (mockApi.updateDailyClosing as unknown as jest.Mock).mockReset();
  (mockApi.updateDailyClosing as unknown as jest.Mock).mockResolvedValue({
    success: true,
  });
  (mockApi.getRates as unknown as jest.Mock).mockReset();
  (mockApi.getRates as unknown as jest.Mock).mockResolvedValue([
    { to_code: "LBP", market_rate: 89500, buy_rate: 89000, sell_rate: 90000 },
  ]);
  localStorage.clear();
  sessionStorage.clear();
  jest.useRealTimers();
}

describe("AllDrawersCheckpointModal.loadFailure", () => {
  beforeAll(resetBetweenFiles);

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
});

describe("AllDrawersCheckpointModal", () => {
  beforeAll(resetBetweenFiles);

  /**
   * The after-sign-in "Checkpoint — all drawers" window (owner decision
   * 2026-10-07): every visible drawer in ONE window, each with its own count
   * fields and its OWN Save, which saves ONLY that drawer through the same
   * `createCheckpoint` call the single-drawer window uses. A saved drawer stays
   * in the list as counted; the window stays open until the owner closes it.
   * Drawers already counted today are marked and can be re-counted.
   */

  const DRAWERS = [
    { name: "General", countedToday: false },
    { name: "OMT_System", countedToday: false },
    { name: "Whish_App", countedToday: true },
  ];

  function renderWindow(onClose = jest.fn()) {
    render(
      <AllDrawersCheckpointModal isOpen drawers={DRAWERS} onClose={onClose} />,
    );
    return onClose;
  }

  const card = (name: string) =>
    screen.getByTestId(`checkpoint-drawer-${name}`);

  beforeEach(() => {
    jest.clearAllMocks();
    mockApi.getCurrencies.mockResolvedValue([
      { id: 1, code: "USD", name: "US Dollar", symbol: "$", is_active: 1 },
      {
        id: 2,
        code: "LBP",
        name: "Lebanese Pound",
        symbol: "LBP",
        is_active: 1,
      },
    ]);
    mockApi.getCountableDrawerCurrencies.mockResolvedValue({
      General: ["USD", "LBP"],
      OMT_System: ["USD", "LBP"],
      Whish_App: ["USD"],
    });
    mockApi.getSystemExpectedBalancesDynamic.mockResolvedValue({
      General: { USD: 100, LBP: 500_000 },
      OMT_System: { USD: 40, LBP: 0 },
      Whish_App: { USD: 7 },
    });
    mockCreateCheckpoint.mockResolvedValue({ success: true, id: 9 });
  });

  describe("Checkpoint — all drawers window", () => {
    it("lists every drawer it is given, in order, each as its own card", async () => {
      renderWindow();
      expect(
        screen.getByRole("heading", { name: /^Checkpoint — all drawers/ }),
      ).toBeInTheDocument();
      const ids = screen
        .getAllByTestId(/^checkpoint-drawer-/)
        .map((el) => el.getAttribute("data-testid"));
      expect(ids).toEqual([
        "checkpoint-drawer-General",
        "checkpoint-drawer-OMT_System",
        "checkpoint-drawer-Whish_App",
      ]);
      // Uncounted drawers show their own fields and their own Save button.
      expect(
        await within(card("General")).findByLabelText("USD"),
      ).toBeInTheDocument();
      expect(
        await within(card("OMT_System")).findByLabelText("USD"),
      ).toBeInTheDocument();
      expect(
        within(card("General")).getByTestId("checkpoint-save-General"),
      ).toBeInTheDocument();
      expect(
        within(card("OMT_System")).getByTestId("checkpoint-save-OMT_System"),
      ).toBeInTheDocument();
    });

    it("a drawer counted today is marked, has no fields, and can be re-counted", async () => {
      renderWindow();
      const whish = card("Whish_App");
      expect(within(whish).getByText(/Counted today/)).toBeInTheDocument();
      expect(within(whish).queryByLabelText("USD")).toBeNull();
      fireEvent.click(within(whish).getByRole("button", { name: /Re-count/ }));
      expect(
        await within(card("Whish_App")).findByLabelText("USD"),
      ).toBeInTheDocument();
    });

    it("saving ONE drawer saves only that drawer, marks it counted, and keeps the window open", async () => {
      const onClose = renderWindow();
      const omt = card("OMT_System");
      const usd = await within(omt).findByLabelText("USD");
      await waitFor(() => expect((usd as HTMLInputElement).value).toBe("40"));
      fireEvent.change(usd, { target: { value: "35" } });

      fireEvent.click(within(omt).getByTestId("checkpoint-save-OMT_System"));

      await waitFor(() =>
        expect(mockCreateCheckpoint).toHaveBeenCalledTimes(1),
      );
      const payload = mockCreateCheckpoint.mock.calls[0][0];
      expect(payload.drawer_name).toBe("OMT_System");
      expect(payload.amounts.length).toBeGreaterThan(0);
      for (const a of payload.amounts) expect(a.drawer_name).toBe("OMT_System");
      expect(payload.amounts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            currency_code: "USD",
            expected_amount: 40,
            physical_amount: 35,
          }),
        ]),
      );

      await waitFor(() =>
        expect(
          within(card("OMT_System")).getByText(/Counted today/),
        ).toBeInTheDocument(),
      );
      // The others are untouched and still countable; the window stays open.
      expect(within(card("General")).getByLabelText("USD")).toBeInTheDocument();
      expect(within(card("General")).queryByText(/Counted today/)).toBeNull();
      expect(
        screen.getByRole("heading", { name: /^Checkpoint — all drawers/ }),
      ).toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
    });

    it("a failed save keeps that drawer open with the error, nothing marked counted", async () => {
      mockCreateCheckpoint.mockResolvedValue({ success: false, error: "Nope" });
      renderWindow();
      const general = card("General");
      await within(general).findByLabelText("USD");
      const save = within(general).getByTestId("checkpoint-save-General");
      // Save is off until the sheet has fully loaded (shop-day 2026-10-16).
      await waitFor(() => expect(save).toBeEnabled());
      fireEvent.click(save);
      expect(
        await within(card("General")).findByText("Nope"),
      ).toBeInTheDocument();
      expect(within(card("General")).queryByText(/Counted today/)).toBeNull();
    });

    it("closing with nothing changed closes straight away", async () => {
      const onClose = renderWindow();
      await within(card("General")).findByLabelText("USD");
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
