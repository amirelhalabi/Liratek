/** @jest-environment jsdom */
/**
 * Mobile Recharge — the shop-lines chip in the top row and the modal it opens.
 * The chip summarises the carrier's lines (main line number only — never a
 * balance — "+N" more, a warning dot); everything the old inline panel showed
 * and did now lives in the modal.
 */

import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { CarrierLinesPanel } from "../CarrierLinesPanel";
import type {
  CarrierLineEntity,
  CarrierLineOwedDeliveryEntity,
} from "@liratek/ui";

const mockGetActiveCarrierLines = jest.fn();
const mockRecordCarrierLineUsage = jest.fn();
const mockGetPendingCarrierLineOwedDeliveries = jest.fn();
// Stable module-level identity (rule 25).
const mockApi = {
  getActiveCarrierLines: mockGetActiveCarrierLines,
  updateCarrierLineBalance: jest.fn(),
  createCarrierLine: jest.fn(),
  recordCarrierLineUsage: mockRecordCarrierLineUsage,
  getPendingCarrierLineOwedDeliveries: mockGetPendingCarrierLineOwedDeliveries,
  markCarrierLineOwedDeliverySent: jest.fn(),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function line(
  id: number,
  overrides: Partial<CarrierLineEntity> = {},
): CarrierLineEntity {
  return {
    id,
    carrier: "mtc",
    phone_number: `0311187${id}`,
    label: null,
    credits: 10,
    validity_expires_at: todayPlus(30),
    days_owed: 0,
    notes: null,
    is_active: 1,
    is_primary: 0,
    created_at: "2026-10-01 00:00:00",
    updated_at: "2026-10-01 00:00:00",
    ...overrides,
  };
}

function delivery(id: number, lineId: number): CarrierLineOwedDeliveryEntity {
  return {
    id,
    carrier_line_id: lineId,
    transaction_id: 1,
    client_id: null,
    client_name: "Jean",
    days_owed: 5,
    status: "PENDING",
    sent_at: null,
    sent_by: null,
    created_at: "2026-10-01 00:00:00",
    updated_at: "2026-10-01 00:00:00",
  } as CarrierLineOwedDeliveryEntity;
}

const chip = () => screen.findByTestId("carrier-lines-chip-mtc");
const warningDot = () => screen.queryByTestId("carrier-lines-chip-warning");

describe("CarrierLinesPanel — selected-line chip + chevron picker (LIRA-328)", () => {
  beforeEach(() => {
    mockGetActiveCarrierLines.mockReset();
    mockRecordCarrierLineUsage.mockReset();
    mockGetPendingCarrierLineOwedDeliveries
      .mockReset()
      .mockResolvedValue({ success: true, data: [] });
  });

  it("shows the PRIMARY line by default, with its credit", async () => {
    mockGetActiveCarrierLines.mockResolvedValue([
      line(1, { credits: 50 }),
      line(2, { is_primary: 1, credits: -15.8 }),
    ]);
    render(<CarrierLinesPanel carrier="mtc" />);
    const c = await chip();
    expect(c).toHaveTextContent("03111872");
    expect(c).not.toHaveTextContent("03111871");
    expect(screen.getByTestId("carrier-lines-chip-credits")).toHaveTextContent(
      "$-15.8",
    );
  });

  it("shows the picked line when the page passes one", async () => {
    mockGetActiveCarrierLines.mockResolvedValue([
      line(1, { is_primary: 1, credits: 5 }),
      line(2, { credits: 10 }),
    ]);
    render(<CarrierLinesPanel carrier="mtc" selectedLineId={2} />);
    expect(await chip()).toHaveTextContent("03111872");
    expect(screen.getByTestId("carrier-lines-chip-credits")).toHaveTextContent(
      "$10",
    );
  });

  it("the chevron lists every line; picking one reports it (the primary reports null)", async () => {
    mockGetActiveCarrierLines.mockResolvedValue([
      line(1, { is_primary: 1 }),
      line(2),
      line(3),
    ]);
    const onPick = jest.fn();
    render(<CarrierLinesPanel carrier="mtc" onSelectedLineChange={onPick} />);
    await chip();
    fireEvent.click(screen.getByTestId("carrier-lines-picker-mtc"));
    const list = await screen.findByTestId("carrier-lines-picker-list-mtc");
    for (const id of [1, 2, 3]) {
      expect(
        within(list).getByTestId(`carrier-lines-picker-option-${id}`),
      ).toBeInTheDocument();
    }
    // No "Manage lines" entry and no settings button (owner, 2026-10-16).
    expect(screen.queryByTestId("carrier-lines-manage-mtc")).toBeNull();
    fireEvent.click(within(list).getByTestId("carrier-lines-picker-option-3"));
    expect(onPick).toHaveBeenLastCalledWith(3);
    fireEvent.click(screen.getByTestId("carrier-lines-picker-mtc"));
    fireEvent.click(
      await screen.findByTestId("carrier-lines-picker-option-1"),
    );
    expect(onPick).toHaveBeenLastCalledWith(null);
  });

  it("forgets a picked line that is no longer active", async () => {
    mockGetActiveCarrierLines.mockResolvedValue([line(1, { is_primary: 1 })]);
    const onPick = jest.fn();
    render(
      <CarrierLinesPanel
        carrier="mtc"
        selectedLineId={99}
        onSelectedLineChange={onPick}
      />,
    );
    expect(await chip()).toHaveTextContent("03111871");
    await waitFor(() => expect(onPick).toHaveBeenCalledWith(null));
  });

  it("clicking the number opens Record usage for that line straight away", async () => {
    mockGetActiveCarrierLines.mockResolvedValue([
      line(1, { is_primary: 1, credits: 5 }),
      line(2, { credits: 10 }),
    ]);
    mockRecordCarrierLineUsage.mockResolvedValue({
      success: true,
      data: { expenseId: 1, transactionId: 2, creditsUsed: 4, newCredits: 6 },
    });
    render(<CarrierLinesPanel carrier="mtc" selectedLineId={2} />);
    fireEvent.click(await chip());
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Record usage — MTC 03111872");
    expect(
      within(dialog).getByTestId("carrier-line-usage-form-2"),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("carrier-line-usage-new-balance"), {
      target: { value: "6" },
    });
    fireEvent.click(screen.getByTestId("carrier-line-usage-submit"));
    await waitFor(() =>
      expect(mockRecordCarrierLineUsage).toHaveBeenCalledWith({
        carrierLineId: 2,
        newCredits: 6,
        expectedCurrentCredits: 10,
      }),
    );
  });

  describe("warning dot", () => {
    it("is absent when every line is healthy and nothing is owed", async () => {
      mockGetActiveCarrierLines.mockResolvedValue([line(1, { credits: 10 })]);
      render(<CarrierLinesPanel carrier="mtc" drawerUsd={10} />);
      await chip();
      expect(warningDot()).not.toBeInTheDocument();
    });

    it("shows when a NON-selected line has expired", async () => {
      mockGetActiveCarrierLines.mockResolvedValue([
        line(1, { is_primary: 1 }),
        line(2, { validity_expires_at: todayPlus(-2) }),
      ]);
      render(<CarrierLinesPanel carrier="mtc" />);
      await chip();
      expect(warningDot()).toBeInTheDocument();
    });

    it("shows when the drawer disagrees with the lines' total", async () => {
      mockGetActiveCarrierLines.mockResolvedValue([line(1, { credits: 10 })]);
      render(<CarrierLinesPanel carrier="mtc" drawerUsd={25} />);
      await chip();
      expect(warningDot()).toBeInTheDocument();
    });

    it("shows when days are still owed to a customer on this carrier", async () => {
      mockGetActiveCarrierLines.mockResolvedValue([line(1)]);
      mockGetPendingCarrierLineOwedDeliveries.mockResolvedValue({
        success: true,
        data: [delivery(7, 1)],
      });
      render(<CarrierLinesPanel carrier="mtc" />);
      await chip();
      await waitFor(() => expect(warningDot()).toBeInTheDocument());
    });
  });

  it("with no lines: an '+ Add MTC line' chip that opens the add-line form", async () => {
    mockGetActiveCarrierLines.mockResolvedValue([]);
    render(<CarrierLinesPanel carrier="mtc" />);
    const c = await chip();
    expect(c).toHaveTextContent("+ Add MTC line");
    fireEvent.click(c);
    expect(
      within(await screen.findByRole("dialog")).getByTestId(
        "add-carrier-line-form-mtc",
      ),
    ).toBeInTheDocument();
  });
});
