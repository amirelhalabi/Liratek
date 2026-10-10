/** @jest-environment jsdom */
/**
 * LIRA-289 T049 — the drawer count screen lists the sales recorded on that
 * drawer since its last count (spec FR-010). Uses the dual-transport adapter
 * (useApi); the mock returns a STABLE reference (rule 25).
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SinceLastCountList } from "../SinceLastCountList";

const mockGet = jest.fn();
const mockApi = { getTransactionsSinceLastCount: mockGet };
jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

beforeEach(() => mockGet.mockReset());

describe("SinceLastCountList", () => {
  it("asks for this drawer only and shows how many sales came in since the last count", async () => {
    mockGet.mockResolvedValue([
      {
        drawer: "Whish_App",
        lastCountAt: "2026-10-09 18:00:00",
        transactions: [
          { id: 7, type: "FINANCIAL_SERVICE", summary: "WHISH_APP SEND", client_id: 3, client_name: "Hassan", amount_usd: 50, amount_lbp: 0, created_at: "2026-10-09 21:30:00", drawer_amounts: { USD: -50 } },
          { id: 8, type: "FINANCIAL_SERVICE", summary: "OMT_APP SEND", client_id: null, client_name: null, amount_usd: 20, amount_lbp: 0, created_at: "2026-10-09 21:40:00", drawer_amounts: { USD: 20 } },
        ],
      },
    ]);
    render(<SinceLastCountList drawer="Whish_App" />);
    expect(await screen.findByText("2 sales since the last count")).toBeTruthy();
    expect(mockGet).toHaveBeenCalledWith(["Whish_App"]);
    fireEvent.click(screen.getByRole("button", { name: /2 sales since the last count/ }));
    expect(screen.getByText(/Hassan/)).toBeTruthy();
    expect(screen.getByText("-$50")).toBeTruthy();
  });

  it("says so when nothing came in, and shows nothing when the list cannot load (e.g. staff)", async () => {
    mockGet.mockResolvedValueOnce([{ drawer: "OMT_App", lastCountAt: null, transactions: [] }]);
    const { unmount } = render(<SinceLastCountList drawer="OMT_App" />);
    expect(await screen.findByText("No sales since the last count")).toBeTruthy();
    unmount();

    mockGet.mockResolvedValueOnce(null);
    const { container } = render(<SinceLastCountList drawer="OMT_App" />);
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
    expect(container.textContent).toBe("");
  });
});
