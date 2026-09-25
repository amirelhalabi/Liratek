/** @jest-environment jsdom */
/**
 * LIRA-219 (C.3) — `closingDay` is computed ONCE in `handleSave` and reused
 * for the checkpoint's `closing_date`, the daily-stats-snapshot query's
 * `day`, and the printed PDF's `closing_date` line (rule 22) — so the
 * checkpoint record, the profit figure and the printed date can never
 * disagree with each other. This test proves the wiring: the SAME day string
 * reaches both `api.createCheckpoint({closing_date})` and
 * `api.getDailyStatsSnapshot({day})`.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CheckpointModal from "../index";

const mockGetCurrencies = jest.fn();
const mockGetCountableDrawerCurrencies = jest.fn();
const mockGetSystemExpectedBalancesDynamic = jest.fn();
const mockGetActiveCarrierLines = jest.fn();
const mockPartnersGetAll = jest.fn();
const mockCreateCheckpoint = jest.fn();
const mockGetDailyStatsSnapshot = jest.fn();
const mockGeneratePDF = jest.fn();

// STABLE object reference (see Checkpoint.countSheet.test.tsx for why).
const mockApi = {
  getCurrencies: mockGetCurrencies,
  getCountableDrawerCurrencies: mockGetCountableDrawerCurrencies,
  getSystemExpectedBalancesDynamic: mockGetSystemExpectedBalancesDynamic,
  getActiveCarrierLines: mockGetActiveCarrierLines,
  partners: { getAll: mockPartnersGetAll },
  createCheckpoint: mockCreateCheckpoint,
  getDailyStatsSnapshot: mockGetDailyStatsSnapshot,
  generatePDF: mockGeneratePDF,
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

const ACTIVE_CURRENCIES = [
  { id: 1, code: "USD", name: "US Dollar", symbol: "$", is_active: 1 },
  { id: 2, code: "LBP", name: "Lebanese Pound", symbol: "LBP", is_active: 1 },
];

function renderCheckpoint(onClose = jest.fn()) {
  return render(
    <CheckpointModal isOpen drawerName="General" onClose={onClose} />,
  );
}

describe("Checkpoint save — LIRA-219 closingDay reused for closing_date + snapshot day", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrencies.mockResolvedValue(ACTIVE_CURRENCIES);
    mockPartnersGetAll.mockResolvedValue([]);
    mockGetActiveCarrierLines.mockResolvedValue([]);
    mockGetCountableDrawerCurrencies.mockResolvedValue({
      General: ["USD", "LBP"],
    });
    mockGetSystemExpectedBalancesDynamic.mockResolvedValue({
      General: { USD: 100, LBP: 500_000 },
    });
    mockCreateCheckpoint.mockResolvedValue({ success: true, id: 1 });
    mockGetDailyStatsSnapshot.mockResolvedValue({
      salesCount: 0,
      totalSalesUSD: 0,
      totalSalesLBP: 0,
      debtPaymentsUSD: 0,
      debtPaymentsLBP: 0,
      totalExpensesUSD: 0,
      totalExpensesLBP: 0,
      profitDay: "irrelevant-to-this-test",
      profitHidden: true,
    });
    mockGeneratePDF.mockResolvedValue({ success: false });
  });

  it("requests the snapshot with the SAME day it saved the checkpoint's closing_date as", async () => {
    const onClose = jest.fn();
    renderCheckpoint(onClose);

    await screen.findByLabelText("USD");

    const saveButton = screen.getByRole("button", { name: /Save/ });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockCreateCheckpoint).toHaveBeenCalledTimes(1);
      expect(mockGetDailyStatsSnapshot).toHaveBeenCalledTimes(1);
    });

    const checkpointArg = mockCreateCheckpoint.mock.calls[0][0];
    const snapshotArg = mockGetDailyStatsSnapshot.mock.calls[0][0];

    expect(typeof checkpointArg.closing_date).toBe("string");
    expect(checkpointArg.closing_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(snapshotArg).toEqual({ day: checkpointArg.closing_date });
  });
});
