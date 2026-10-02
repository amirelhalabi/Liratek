/** @jest-environment jsdom */
/**
 * LIRA-252 item A — Checkpoint page, MTC/Alfa per-line credits.
 *
 * Owner decision A: MTC/Alfa credits are entered PER ACTIVE LINE — one
 * credits input per line, the drawer is always their SUM, and there is no
 * free-typed MTC/Alfa drawer amount. A carrier with no active line shows an
 * inline "add a line" prompt instead of a bare amount field. The server
 * (`ClosingRepository.createCheckpoint`, LIRA-252 item C, already shipped)
 * now refuses a non-zero MTC/Alfa amount with no `carrier_lines` behind it —
 * these tests guard that the UI never constructs that refused shape.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CheckpointModal from "../index";

const mockGetCurrencies = jest.fn();
const mockGetCountableDrawerCurrencies = jest.fn();
const mockGetSystemExpectedBalancesDynamic = jest.fn();
const mockGetActiveCarrierLines = jest.fn();
const mockCreateCarrierLine = jest.fn();
const mockPartnersGetAll = jest.fn();
const mockCreateCheckpoint = jest.fn();

// STABLE object reference (rule 25) — several hooks call useApi()
// independently; a fresh literal per call would re-trigger their load
// effects forever.
const mockApi = {
  getCurrencies: mockGetCurrencies,
  getCountableDrawerCurrencies: mockGetCountableDrawerCurrencies,
  getSystemExpectedBalancesDynamic: mockGetSystemExpectedBalancesDynamic,
  getActiveCarrierLines: mockGetActiveCarrierLines,
  createCarrierLine: mockCreateCarrierLine,
  partners: { getAll: mockPartnersGetAll },
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

const ACTIVE_CURRENCIES = [
  { id: 1, code: "USD", name: "US Dollar", symbol: "$", is_active: 1 },
];

function renderMtcCheckpoint() {
  return render(
    <CheckpointModal isOpen drawerName="MTC" onClose={jest.fn()} />,
  );
}

describe("Checkpoint — MTC/Alfa per-line credits (LIRA-252 item A)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrencies.mockResolvedValue(ACTIVE_CURRENCIES);
    mockPartnersGetAll.mockResolvedValue([]);
    mockGetCountableDrawerCurrencies.mockResolvedValue({ MTC: ["USD"] });
    mockGetSystemExpectedBalancesDynamic.mockResolvedValue({
      MTC: { USD: 500 },
    });
    mockCreateCheckpoint.mockResolvedValue({ success: true, id: 1 });
  });

  it("shows the add-a-line prompt and disables Save when the carrier has no active line", async () => {
    mockGetActiveCarrierLines.mockResolvedValue([]);
    renderMtcCheckpoint();

    expect(
      await screen.findByTestId("checkpoint-add-line-MTC"),
    ).toBeInTheDocument();
    // No bare currency field for MTC's USD exists anywhere on this screen.
    expect(screen.queryByLabelText("USD")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Credits")).not.toBeInTheDocument();

    const saveButton = screen.getByRole("button", { name: /Save/ });
    expect(saveButton).toBeDisabled();
  });

  it("adding a line calls createCarrierLine, then shows it as a counted row (never a bare amount)", async () => {
    mockGetActiveCarrierLines.mockResolvedValueOnce([]);
    mockCreateCarrierLine.mockResolvedValue({
      success: true,
      data: { id: 7, carrier: "mtc", phone_number: "03123456", credits: 25 },
    });
    mockGetActiveCarrierLines.mockResolvedValueOnce([
      {
        id: 7,
        carrier: "mtc",
        phone_number: "03123456",
        label: null,
        credits: 25,
        validity_expires_at: null,
        is_primary: 1,
      },
    ]);

    renderMtcCheckpoint();
    await screen.findByTestId("checkpoint-add-line-MTC");

    fireEvent.change(screen.getByTestId("checkpoint-add-line-phone-MTC"), {
      target: { value: "03123456" },
    });
    fireEvent.change(screen.getByTestId("checkpoint-add-line-credits-MTC"), {
      target: { value: "25" },
    });
    fireEvent.click(screen.getByTestId("checkpoint-add-line-submit-MTC"));

    expect(mockCreateCarrierLine).toHaveBeenCalledWith({
      carrier: "mtc",
      phone_number: "03123456",
      credits: 25,
    });

    await waitFor(() => {
      expect(screen.getByText(/03123456/)).toBeInTheDocument();
    });
    expect(screen.getByLabelText("Credits")).toHaveValue("25");
  });

  it("renders one Credits row per active line and sums them into Save's carrier_lines payload, never a bare MTC amount", async () => {
    mockGetActiveCarrierLines.mockResolvedValue([
      {
        id: 1,
        carrier: "mtc",
        phone_number: "03111111",
        label: null,
        credits: 300,
        validity_expires_at: null,
        is_primary: 1,
      },
      {
        id: 2,
        carrier: "mtc",
        phone_number: "03222222",
        label: null,
        credits: 200,
        validity_expires_at: null,
        is_primary: 0,
      },
    ]);

    renderMtcCheckpoint();

    const creditsInputs = await screen.findAllByLabelText("Credits");
    expect(creditsInputs).toHaveLength(2);

    // Counted total of 500 matches expected — Save button reads "Balanced".
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Save Checkpoint — Balanced/ }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Save/ }));

    await waitFor(() => expect(mockCreateCheckpoint).toHaveBeenCalled());
    const payload = mockCreateCheckpoint.mock.calls[0][0];

    expect(payload.carrier_lines).toEqual(
      expect.arrayContaining([
        {
          carrier_line_id: 1,
          counted_credits: 300,
          counted_expires_at: null,
        },
        {
          carrier_line_id: 2,
          counted_credits: 200,
          counted_expires_at: null,
        },
      ]),
    );
    // The invariant under test: no bare MTC USD row ever reaches the server.
    expect(
      payload.amounts.some(
        (a: { drawer_name: string; currency_code: string }) =>
          a.drawer_name === "MTC" && a.currency_code === "USD",
      ),
    ).toBe(false);
  });
});
