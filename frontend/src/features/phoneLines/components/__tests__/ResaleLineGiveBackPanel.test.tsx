/** @jest-environment jsdom */
/**
 * LIRA-337 — the "Give credit back" panel for a line held for sale.
 * The preview comes from core's `planLineGiveBack` (the same function the
 * server saves with); ONE payload whose field names come from the schema
 * (rule 24); only shop lines of the line's own carrier are offered.
 *
 * Written before the component existed (rule 17).
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { giveBackResaleLineSchema, type ResaleLineRow } from "@liratek/core";
import { ResaleLineGiveBackPanel } from "../ResaleLineGiveBackPanel";

const mockGiveBack = jest.fn();
const mockGetLines = jest.fn();
const mockGetSettings = jest.fn();
const mockApi = {
  giveBackResaleLineCredit: mockGiveBack,
  getAllActiveCarrierLines: mockGetLines,
  getAllSettings: mockGetSettings,
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 89500, buyRate: 89500, isLoading: false }),
}));

const LINE: ResaleLineRow = {
  product_id: 7,
  phone_number: "70444202",
  name: "Alfa line 70 444 202",
  category: "Phone Lines",
  cost_price_usd: 20,
  selling_price_usd: 25,
  stock_quantity: 1,
  is_unsold: 1,
  resale_line_id: 1,
  carrier: "alfa",
  credits: 15,
  validity_expires_at: "2026-11-15",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetLines.mockResolvedValue([
    { id: 4, carrier: "alfa", phone_number: "03222875", is_primary: 1, is_active: 1, credits: 20 },
    { id: 3, carrier: "mtc", phone_number: "03111875", is_primary: 1, is_active: 1, credits: 5 },
  ]);
  mockGetSettings.mockResolvedValue([
    { key_name: "alfa_credit_sell_rate_lbp", value: "100000" },
    { key_name: "alfa_credit_cost_lbp", value: "89500" },
  ]);
  mockGiveBack.mockResolvedValue({
    success: true,
    data: {
      transaction_id: 1,
      give_back_id: 1,
      credits_sent: 5.68,
      sms_fee_usd: 0.32,
      price_drop_usd: 6.7,
      cost_drop_usd: 5.68,
      line: { credits: 9, price_usd: 18.3, cost_usd: 14.32 },
    },
  });
});

async function ready() {
  await screen.findByRole("option", { name: /03222875/ });
  await waitFor(() =>
    expect((screen.getByLabelText("Credit price (LBP per $1)") as HTMLInputElement).value).toBe("100,000"),
  );
}

describe("ResaleLineGiveBackPanel (LIRA-337)", () => {
  it("worked example: previews the transfer, fee, price and cost, then sends the schema payload", async () => {
    const onDone = jest.fn();
    render(<ResaleLineGiveBackPanel line={LINE} onDone={onDone} onCancel={jest.fn()} />);
    await ready();
    fireEvent.change(screen.getByLabelText("Credit the buyer keeps ($)"), { target: { value: "9" } });

    const preview = screen.getByTestId("give-back-preview").textContent ?? "";
    expect(preview).toContain("Send $5.68 + SMS fee $0.32 → the line keeps $9.00.");
    expect(preview).toContain("Price $25.00 → $18.30 · Cost $20.00 → $14.32");

    fireEvent.click(screen.getByRole("button", { name: "Give credit back" }));
    await waitFor(() => expect(mockGiveBack).toHaveBeenCalledTimes(1));
    const sent = mockGiveBack.mock.calls[0][0];
    expect(giveBackResaleLineSchema.parse(sent)).toEqual(sent);
    expect(sent).toMatchObject({
      product_id: 7,
      credits_kept: 9,
      carrier_line_id: 4,
      credit_sell_price_lbp: 100000,
      exchange_rate: 89500,
    });
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("offers only this carrier's shop lines", async () => {
    render(<ResaleLineGiveBackPanel line={LINE} onDone={jest.fn()} onCancel={jest.fn()} />);
    await ready();
    expect(screen.queryByRole("option", { name: /03111875/ })).toBeNull();
  });

  it("a typed credit price changes the price drop", async () => {
    render(<ResaleLineGiveBackPanel line={LINE} onDone={jest.fn()} onCancel={jest.fn()} />);
    await ready();
    fireEvent.change(screen.getByLabelText("Credit the buyer keeps ($)"), { target: { value: "9" } });
    fireEvent.change(screen.getByLabelText("Credit price (LBP per $1)"), { target: { value: "85000" } });
    expect(screen.getByTestId("give-back-preview").textContent).toContain("Price $25.00 → $19.30");
  });

  it("shows the planner's refusal and sends nothing", async () => {
    render(<ResaleLineGiveBackPanel line={LINE} onDone={jest.fn()} onCancel={jest.fn()} />);
    await ready();
    fireEvent.change(screen.getByLabelText("Credit the buyer keeps ($)"), { target: { value: "15" } });
    expect(screen.getByTestId("give-back-preview").textContent).toContain(
      "The buyer must keep less credit than the line has.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Give credit back" }));
    expect(mockGiveBack).not.toHaveBeenCalled();
  });

  it("shows the server's refusal and does not close", async () => {
    mockGiveBack.mockResolvedValue({ success: false, error: "Refund the sale of this line first." });
    const onDone = jest.fn();
    render(<ResaleLineGiveBackPanel line={LINE} onDone={onDone} onCancel={jest.fn()} />);
    await ready();
    fireEvent.change(screen.getByLabelText("Credit the buyer keeps ($)"), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "Give credit back" }));
    expect(await screen.findByText("Refund the sale of this line first.")).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });
});
