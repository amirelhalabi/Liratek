/** @jest-environment jsdom */
/**
 * LIRA-309 phase 5 (T047) — the recharge panel for a line held for sale.
 * Three sources (Days / Shop-line credit / Card); a live preview of the new
 * cost and price; ONE payload whose field names come from the schema
 * (rule 24); only cards and shop lines of the line's own carrier offered.
 *
 * Written before the component existed; first run failed with "Cannot find
 * module '../ResaleLineRechargePanel'".
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { rechargeResaleLineSchema, type ResaleLineRow } from "@liratek/core";
import { ResaleLineRechargePanel } from "../ResaleLineRechargePanel";

const mockRecharge = jest.fn();
const mockGetLines = jest.fn();
const mockGetItems = jest.fn();
const mockApi = {
  rechargeResaleLine: mockRecharge,
  getAllActiveCarrierLines: mockGetLines,
  getActiveMobileServiceItems: mockGetItems,
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 89000, buyRate: 89000, isLoading: false }),
}));

const LINE: ResaleLineRow = {
  product_id: 7,
  phone_number: "70444202",
  name: "Alfa line 70 444 202",
  category: "Phone Lines",
  cost_price_usd: 15,
  selling_price_usd: 25,
  stock_quantity: 1,
  is_unsold: 1,
  resale_line_id: 1,
  carrier: "alfa",
  credits: 0,
  validity_expires_at: "2026-10-15",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetLines.mockResolvedValue([
    { id: 4, carrier: "alfa", phone_number: "03222875", is_primary: 1, is_active: 1, credits: 20 },
    { id: 3, carrier: "mtc", phone_number: "03111875", is_primary: 1, is_active: 1, credits: 5 },
  ]);
  mockGetItems.mockResolvedValue([
    { id: 11, provider: "iPick", category: "alfa", subcategory: "Prepaid", label: "7.58", cost_lbp: 770000, credits: 7.58, validity_days: 30, is_active: 1 },
    { id: 12, provider: "iPick", category: "mtc", subcategory: "Prepaid", label: "4.5", cost_lbp: 466000, credits: 4.5, validity_days: 30, is_active: 1 },
    { id: 13, provider: "Katsh", category: "Gaming", subcategory: "PUBG", label: "60 UC", cost_lbp: 100000, credits: null, validity_days: null, is_active: 1 },
    // LIRA-338 — Whish App MTC/Alfa cards are offered too.
    { id: 14, provider: "WHISH_APP", category: "alfa", subcategory: "Prepaid", label: "15.15", cost_lbp: 1511601, credits: 15.15, validity_days: 60, is_active: 1 },
  ]);
  mockRecharge.mockResolvedValue({
    success: true,
    data: { transaction_id: 1, recharge_id: 1, cost_usd: 3, line: { cost_usd: 18, price_usd: 28, validity_expires_at: "2026-11-14", credits: 0 } },
  });
});

describe("ResaleLineRechargePanel (LIRA-309)", () => {
  it("Days: previews $15 → $18 / $25 → $28 and sends the schema payload", async () => {
    const onDone = jest.fn();
    render(<ResaleLineRechargePanel line={LINE} onDone={onDone} onCancel={jest.fn()} />);
    await screen.findByRole("option", { name: /03222875/ });
    fireEvent.change(screen.getByLabelText("Days"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Days cost ($)"), { target: { value: "3" } });
    expect(screen.getByTestId("recharge-preview").textContent).toContain("$15.00 → $18.00");
    expect(screen.getByTestId("recharge-preview").textContent).toContain("$25.00 → $28.00");

    fireEvent.click(screen.getByRole("button", { name: "Recharge line" }));
    await waitFor(() => expect(mockRecharge).toHaveBeenCalledTimes(1));
    const sent = mockRecharge.mock.calls[0][0];
    expect(rechargeResaleLineSchema.parse(sent)).toEqual(sent);
    expect(sent).toMatchObject({ product_id: 7, source: "DAYS", days: 30, days_cost_usd: 3, source_carrier_line_id: 4 });
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("offers only this carrier's shop lines and iPick/Katsh cards", async () => {
    render(<ResaleLineRechargePanel line={LINE} onDone={jest.fn()} onCancel={jest.fn()} />);
    await screen.findByRole("option", { name: /03222875/ });
    expect(screen.queryByRole("option", { name: /03111875/ })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Card" }));
    expect(await screen.findByRole("option", { name: /7\.58/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /4\.5/ })).toBeNull();
    expect(screen.queryByRole("option", { name: /60 UC/ })).toBeNull();
  });

  it("Card: sends the picked card and previews cost ÷ rate", async () => {
    render(<ResaleLineRechargePanel line={LINE} onDone={jest.fn()} onCancel={jest.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Card" }));
    await screen.findByRole("option", { name: /7\.58/ });
    fireEvent.change(screen.getByLabelText("Card"), { target: { value: "11" } });
    // 770,000 / 89,000 = $8.65
    expect(screen.getByTestId("recharge-preview").textContent).toContain("$15.00 → $23.65");
    fireEvent.click(screen.getByRole("button", { name: "Recharge line" }));
    await waitFor(() => expect(mockRecharge).toHaveBeenCalledTimes(1));
    expect(mockRecharge.mock.calls[0][0]).toMatchObject({ source: "CARD", mobile_service_item_id: 11, exchange_rate: 89000 });
  });

  it("shows the server's refusal and does not close", async () => {
    mockRecharge.mockResolvedValue({ success: false, error: "Shop line 03222875 has only 5 days left." });
    const onDone = jest.fn();
    render(<ResaleLineRechargePanel line={LINE} onDone={onDone} onCancel={jest.fn()} />);
    await screen.findByRole("option", { name: /03222875/ });
    fireEvent.change(screen.getByLabelText("Days"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Days cost ($)"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Recharge line" }));
    expect(await screen.findByText("Shop line 03222875 has only 5 days left.")).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });

  // LIRA-338 — NOT proven failing-first (written after the change).
  it("Card: Whish App MTC/Alfa cards are listed with the iPick/Katsh ones", async () => {
    render(<ResaleLineRechargePanel line={LINE} onDone={jest.fn()} onCancel={jest.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Card" }));
    expect(await screen.findByRole("option", { name: /Whish App Alfa 15\.15/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /iPick Alfa 7\.58/ })).toBeTruthy();
  });
});
