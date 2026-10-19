/** @jest-environment jsdom */
/**
 * LIRA-338 — "Charge to shop line" lets the cashier pick the line: any active
 * shop line of the card's carrier (main line pre-picked) or a line held for
 * sale. A shop line uses the self-charge; a line for sale uses the LIRA-309
 * CARD recharge (its cost and price go up). Payload names come from the
 * schemas (rule 24).
 *
 * Written before the component existed (rule 17).
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { rechargeResaleLineSchema } from "@liratek/core";
import { ChargeLineModal } from "../ChargeLineModal";
import type { ServiceItem } from "../../hooks/useMobileServiceItems";

const mockSelfCharge = jest.fn();
const mockRechargeResale = jest.fn();
const mockGetLines = jest.fn();
const mockGetResale = jest.fn();
const mockApi = {
  selfChargeTelecomItem: mockSelfCharge,
  rechargeResaleLine: mockRechargeResale,
  getAllActiveCarrierLines: mockGetLines,
  getResaleLines: mockGetResale,
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 89000, buyRate: 89000, isLoading: false }),
}));

const ITEM: ServiceItem = {
  id: 11,
  key: "whish-alfa-7.58",
  provider: "WHISH_APP",
  category: "alfa",
  subcategory: "Prepaid",
  label: "7.58",
  catalogCost: 765007,
  catalogSellPrice: 800000,
  sortOrder: 0,
  credits: 7.58,
  validityDays: 30,
};

function inDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetLines.mockResolvedValue([
    { id: 4, carrier: "alfa", phone_number: "03222875", label: null, is_primary: 1, is_active: 1, credits: 20, validity_expires_at: inDays(45), days_owed: 0 },
    { id: 5, carrier: "alfa", phone_number: "03444111", label: null, is_primary: 0, is_active: 1, credits: 3.5, validity_expires_at: inDays(2), days_owed: 0 },
    { id: 6, carrier: "alfa", phone_number: "03555000", label: null, is_primary: 0, is_active: 0, credits: 0, validity_expires_at: null, days_owed: 0 },
    { id: 3, carrier: "mtc", phone_number: "03111875", label: null, is_primary: 1, is_active: 1, credits: 5, validity_expires_at: inDays(45), days_owed: 0 },
  ]);
  mockGetResale.mockResolvedValue([
    { product_id: 7, phone_number: "70444202", name: "Alfa line", category: "Phone Lines", cost_price_usd: 15, selling_price_usd: 25, stock_quantity: 1, is_unsold: 1, resale_line_id: 1, carrier: "alfa", credits: 0, validity_expires_at: inDays(2) },
    { product_id: 8, phone_number: "70999999", name: "Lost line", category: "Phone Lines", cost_price_usd: 15, selling_price_usd: 25, stock_quantity: 1, is_unsold: 1, resale_line_id: 2, carrier: "alfa", credits: 0, validity_expires_at: inDays(-30) },
    { product_id: 9, phone_number: "76123123", name: "MTC line", category: "Phone Lines", cost_price_usd: 15, selling_price_usd: 25, stock_quantity: 1, is_unsold: 1, resale_line_id: 3, carrier: "mtc", credits: 0, validity_expires_at: inDays(20) },
  ]);
  mockSelfCharge.mockResolvedValue({
    success: true,
    data: { transactionId: 1, carrierLineId: 5, costLbp: 765007, creditsAdded: 7.58, validityDaysAdded: 30 },
  });
  mockRechargeResale.mockResolvedValue({
    success: true,
    data: { transaction_id: 2, recharge_id: 1, cost_usd: 8.6, line: { cost_usd: 23.6, price_usd: 33.6, validity_expires_at: inDays(32), credits: 7.58 } },
  });
});

async function open(onCharged = jest.fn()) {
  render(<ChargeLineModal item={ITEM} onClose={jest.fn()} onCharged={onCharged} />);
  await screen.findByLabelText(/03222875/);
  return onCharged;
}

describe("ChargeLineModal (LIRA-338)", () => {
  it("lists active lines of the card's carrier: shop lines (main pre-picked) and unsold, not-lost lines for sale", async () => {
    await open();
    expect((screen.getByLabelText(/03222875/) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByLabelText(/03444111/)).toBeTruthy();
    expect(screen.getByLabelText(/70444202/)).toBeTruthy();
    expect(screen.queryByLabelText(/03555000/)).toBeNull(); // turned off
    expect(screen.queryByLabelText(/03111875/)).toBeNull(); // other carrier
    expect(screen.queryByLabelText(/70999999/)).toBeNull(); // lost
    expect(screen.queryByLabelText(/76123123/)).toBeNull(); // other carrier
  });

  it("a picked shop line is charged through the self-charge with that line", async () => {
    const onCharged = await open();
    fireEvent.click(screen.getByLabelText(/03444111/));
    fireEvent.click(screen.getByTestId("katsh-self-charge-confirm"));
    await waitFor(() => expect(mockSelfCharge).toHaveBeenCalledTimes(1));
    expect(mockSelfCharge.mock.calls[0][0]).toMatchObject({ mobileServiceItemId: 11, carrierLineId: 5 });
    expect(mockRechargeResale).not.toHaveBeenCalled();
    expect(await screen.findByText("Charged successfully.")).toBeTruthy();
    expect(onCharged).toHaveBeenCalled();
  });

  it("a picked line for sale is recharged with the card; the preview shows its new cost and price", async () => {
    await open();
    fireEvent.click(screen.getByLabelText(/70444202/));
    // 765,007 / 89,000 = $8.60
    expect(screen.getByTestId("charge-line-for-sale-preview").textContent).toContain("$15.00 → $23.60");
    expect(screen.getByTestId("charge-line-for-sale-preview").textContent).toContain("$25.00 → $33.60");
    fireEvent.click(screen.getByTestId("katsh-self-charge-confirm"));
    await waitFor(() => expect(mockRechargeResale).toHaveBeenCalledTimes(1));
    const sent = mockRechargeResale.mock.calls[0][0];
    expect(rechargeResaleLineSchema.parse(sent)).toEqual(sent);
    expect(sent).toMatchObject({ product_id: 7, source: "CARD", mobile_service_item_id: 11, exchange_rate: 89000 });
    expect(mockSelfCharge).not.toHaveBeenCalled();
  });

  it("shows the server's refusal and stays open", async () => {
    mockSelfCharge.mockResolvedValue({ success: false, error: "Shop line 03222875 is turned off." });
    await open();
    fireEvent.click(screen.getByTestId("katsh-self-charge-confirm"));
    expect(await screen.findByText("Shop line 03222875 is turned off.")).toBeTruthy();
  });

  // Added 2026-10-19 on the owner's "did you test every case?" — NOT proven
  // failing-first (rule 17): the warnings were moved here from KatshForm.
  describe("warnings for the picked shop line (LIRA-157 rule, same as the server)", () => {
    const withMain = (overrides: Record<string, unknown>) =>
      mockGetLines.mockResolvedValue([
        { id: 4, carrier: "alfa", phone_number: "03222875", label: null, is_primary: 1, is_active: 1, credits: 20, days_owed: 0, ...overrides },
      ]);

    it("a burned line: warning shown and Charge disabled", async () => {
      withMain({ validity_expires_at: inDays(-10) });
      await open();
      expect(await screen.findByTestId("self-charge-burned-warning")).toBeTruthy();
      expect(screen.getByTestId("katsh-self-charge-confirm")).toBeDisabled();
    });

    it("a line in its grace days: the new validity starts today", async () => {
      withMain({ validity_expires_at: inDays(-2) });
      await open();
      expect(await screen.findByTestId("self-charge-grace-warning")).toBeTruthy();
      expect(screen.getByTestId("katsh-self-charge-confirm")).toBeEnabled();
    });

    it("a line near the 365-day ceiling: only part of the days apply", async () => {
      withMain({ validity_expires_at: inDays(350) });
      await open();
      expect(await screen.findByTestId("self-charge-capped-warning")).toBeTruthy();
    });

    it("a line with days sold ahead: part of the days pay that off first", async () => {
      withMain({ validity_expires_at: inDays(45), days_owed: 10 });
      await open();
      expect(await screen.findByTestId("self-charge-owed-payoff-notice")).toBeTruthy();
    });
  });

  it("no active shop line and no line for sale: says so and Charge stays disabled", async () => {
    mockGetLines.mockResolvedValue([]);
    mockGetResale.mockResolvedValue([]);
    render(<ChargeLineModal item={ITEM} onClose={jest.fn()} onCharged={jest.fn()} />);
    expect(
      await screen.findByText("No active ALFA line — add one in Settings → Carrier Lines first."),
    ).toBeTruthy();
    expect(screen.getByTestId("katsh-self-charge-confirm")).toBeDisabled();
  });

  it("an MTC card lists only MTC lines", async () => {
    render(
      <ChargeLineModal item={{ ...ITEM, category: "mtc" }} onClose={jest.fn()} onCharged={jest.fn()} />,
    );
    expect(await screen.findByLabelText(/03111875/)).toBeTruthy();
    expect((screen.getByLabelText(/03111875/) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByLabelText(/76123123/)).toBeTruthy();
    expect(screen.queryByLabelText(/03222875/)).toBeNull();
    expect(screen.queryByLabelText(/70444202/)).toBeNull();
  });
});
