/** @jest-environment jsdom */
/**
 * LIRA-252 item E — the MTC/Alfa panel warns when the carrier drawer no longer
 * equals the sum of its active SIM lines' credits (RechargeRepository §0.1's
 * invariant). New drift is already refused server-side (items B/C); this
 * surfaces legacy drift so the shop fixes it with a checkpoint.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { CarrierLinesPanel } from "../CarrierLinesPanel";
import type { CarrierLineEntity } from "@liratek/ui";

const mockGetActiveCarrierLines = jest.fn();
const mockApi = {
  getActiveCarrierLines: mockGetActiveCarrierLines,
  updateCarrierLineBalance: jest.fn(),
  createCarrierLine: jest.fn(),
  recordCarrierLineUsage: jest.fn(),
  getPendingCarrierLineOwedDeliveries: jest
    .fn()
    .mockResolvedValue({ success: true, data: [] }),
  markCarrierLineOwedDeliverySent: jest.fn(),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

function line(id: number, credits: number): CarrierLineEntity {
  return {
    id,
    carrier: "mtc",
    phone_number: `0311111${id}`,
    label: null,
    credits,
    validity_expires_at: null,
    days_owed: 0,
    notes: null,
    is_active: 1,
    is_primary: id === 1 ? 1 : 0,
    created_at: "2026-10-01 00:00:00",
    updated_at: "2026-10-01 00:00:00",
  };
}

describe("CarrierLinesPanel — drawer vs SIM lines mismatch warning (LIRA-252 E)", () => {
  beforeEach(() => {
    mockGetActiveCarrierLines
      .mockReset()
      .mockResolvedValue([line(1, 300), line(2, 200)]);
  });

  it("warns when the drawer differs from the sum of the active lines, naming both amounts", async () => {
    render(<CarrierLinesPanel carrier="mtc" drawerUsd={10000} />);

    const warning = await screen.findByTestId("carrier-drawer-mismatch");
    expect(warning).toHaveTextContent("$10,000.00");
    expect(warning).toHaveTextContent("$500.00");
    expect(warning).toHaveTextContent(/checkpoint/i);
  });

  it("shows no warning when the drawer equals the sum (within a cent)", async () => {
    render(<CarrierLinesPanel carrier="mtc" drawerUsd={500.004} />);

    await waitFor(() =>
      expect(mockGetActiveCarrierLines).toHaveBeenCalledWith("mtc"),
    );
    await screen.findByText("03111111");
    expect(
      screen.queryByTestId("carrier-drawer-mismatch"),
    ).not.toBeInTheDocument();
  });

  it("shows no warning while the drawer balance is unknown", async () => {
    render(<CarrierLinesPanel carrier="mtc" />);

    await screen.findByText("03111111");
    expect(
      screen.queryByTestId("carrier-drawer-mismatch"),
    ).not.toBeInTheDocument();
  });
});
