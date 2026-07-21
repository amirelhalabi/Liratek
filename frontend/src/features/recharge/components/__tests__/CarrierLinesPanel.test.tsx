/** @jest-environment jsdom */
/**
 * CarrierLinesPanel (LIRA W6.a) — compact per-carrier panel: credits +
 * days-remaining, inline quick-update (credits and/or a new expiry).
 * Informational only — no drawer legs, no checkout/closing involvement.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CarrierLinesPanel } from "../CarrierLinesPanel";
import type { CarrierLineEntity } from "@liratek/ui";

const mockGetActiveCarrierLines = jest.fn();
const mockUpdateCarrierLineBalance = jest.fn();
// A STABLE object reference — CarrierLinesPanel's load() is a useCallback
// depending on [api, carrier]; a factory that returns a fresh object literal
// on every useApi() call would re-trigger the effect on every render.
const mockApi = {
  getActiveCarrierLines: mockGetActiveCarrierLines,
  updateCarrierLineBalance: mockUpdateCarrierLineBalance,
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

// Mirrors the component's own addDaysToToday() exactly (local Y/M/D, no
// UTC/ISO conversion — a local vs UTC mismatch would flip the date near
// midnight in non-UTC timezones, see docs memory: db-timestamp conventions).
function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const LINE: CarrierLineEntity = {
  id: 1,
  carrier: "mtc",
  phone_number: "03111111",
  label: "Shop Line 1",
  credits: 5,
  validity_expires_at: todayPlus(10),
  notes: null,
  is_active: 1,
  created_at: "2026-07-01 00:00:00",
  updated_at: "2026-07-01 00:00:00",
};

describe("CarrierLinesPanel", () => {
  beforeEach(() => {
    mockGetActiveCarrierLines.mockReset().mockResolvedValue([LINE]);
    mockUpdateCarrierLineBalance
      .mockReset()
      .mockResolvedValue({ success: true, data: LINE });
  });

  it("renders nothing while there are no active lines", async () => {
    mockGetActiveCarrierLines.mockResolvedValue([]);
    const { container } = render(<CarrierLinesPanel carrier="mtc" />);
    await waitFor(() => expect(mockGetActiveCarrierLines).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the line's label, credits, and days-remaining", async () => {
    render(<CarrierLinesPanel carrier="mtc" />);
    expect(mockGetActiveCarrierLines).toHaveBeenCalledWith("mtc");
    expect(await screen.findByText("Shop Line 1")).toBeInTheDocument();
    expect(await screen.findByText("$5")).toBeInTheDocument();
    expect(await screen.findByText("10d left")).toBeInTheDocument();
  });

  it("quick-update: 'days from today' resolves to a date and persists credits + validity_expires_at", async () => {
    render(<CarrierLinesPanel carrier="mtc" />);
    fireEvent.click(await screen.findByTestId("carrier-line-1"));

    const daysInput = screen.getByPlaceholderText("30");
    fireEvent.change(daysInput, { target: { value: "15" } });

    const creditsInputs = screen.getAllByRole("spinbutton");
    const creditsInput = creditsInputs[0]!;
    fireEvent.change(creditsInput, { target: { value: "22.5" } });

    fireEvent.click(screen.getByText("Save"));

    await waitFor(() =>
      expect(mockUpdateCarrierLineBalance).toHaveBeenCalledWith(1, {
        credits: 22.5,
        validity_expires_at: todayPlus(15),
      }),
    );
  });
});
