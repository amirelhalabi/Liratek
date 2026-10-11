/** @jest-environment jsdom */
/**
 * LIRA-309 (US1) — the Phone Lines page: two groups (Shop lines / For sale),
 * a status chip per line from the one shared rule (for-sale 3 days, shop 7),
 * and saving a for-sale line's details through `saveResaleLine`.
 *
 * Written before the page existed; first run failed with "Cannot find
 * module '../index'".
 */
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { saveResaleLineSchema } from "@liratek/core";
import type { CarrierLineEntity } from "@liratek/ui";
import PhoneLines from "../index";
import { localDay } from "@/shared/utils/localDay";

function inDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return localDay(d);
}

const mockGetAdminCarrierLines = jest.fn();
const mockGetResaleLines = jest.fn();
const mockSaveResaleLine = jest.fn();
// A STABLE object reference (rule 25).
const mockApi = {
  getAdminCarrierLines: mockGetAdminCarrierLines,
  createCarrierLine: jest.fn(),
  updateCarrierLine: jest.fn(),
  archiveCarrierLine: jest.fn(),
  toggleCarrierLineActive: jest.fn(),
  setPrimaryCarrierLine: jest.fn(),
  getResaleLines: mockGetResaleLines,
  saveResaleLine: mockSaveResaleLine,
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

const SHOP_LINE: CarrierLineEntity = {
  id: 1,
  carrier: "mtc",
  phone_number: "03111111",
  label: "Shop 1",
  credits: 40,
  validity_expires_at: inDays(6),
  days_owed: 0,
  notes: null,
  is_active: 1,
  is_primary: 1,
  created_at: "",
  updated_at: "",
};

function forSale(over: Record<string, unknown>) {
  return {
    product_id: 10,
    phone_number: "03555101",
    name: "MTC line 03 555 101",
    category: "Phone Lines",
    cost_price_usd: 15,
    selling_price_usd: 25,
    stock_quantity: 1,
    is_unsold: 1,
    resale_line_id: 1,
    carrier: "mtc",
    credits: 0,
    validity_expires_at: inDays(2),
    ...over,
  };
}

describe("PhoneLines page (LIRA-309)", () => {
  beforeEach(() => {
    mockGetAdminCarrierLines.mockReset().mockResolvedValue([SHOP_LINE]);
    mockGetResaleLines.mockReset().mockResolvedValue([
      forSale({}),
      forSale({
        product_id: 11,
        phone_number: "70444202",
        name: "Alfa line 70 444 202",
        carrier: "alfa",
        validity_expires_at: inDays(10),
      }),
      forSale({
        product_id: 12,
        phone_number: "03555103",
        name: "Old line",
        resale_line_id: null,
        carrier: null,
        validity_expires_at: null,
      }),
    ]);
    mockSaveResaleLine.mockReset().mockResolvedValue({ success: true });
  });

  it("shows the For sale group with a status per line (3-day window)", async () => {
    render(<PhoneLines />);
    const row = await screen.findByTestId("resale-line-10");
    expect(within(row).getByTestId("line-status").dataset.status).toBe("EXPIRING");
    expect(within(row).getByText(/Expires in 2 days/)).toBeTruthy();

    const later = screen.getByTestId("resale-line-11");
    expect(within(later).getByTestId("line-status").dataset.status).toBe("OK");

    const old = screen.getByTestId("resale-line-12");
    expect(within(old).getByText("No expiry set")).toBeTruthy();
  });

  it("shows the Shop lines group with the 7-day window", async () => {
    render(<PhoneLines />);
    fireEvent.click(await screen.findByRole("tab", { name: /Shop lines/ }));
    await screen.findByText("03111111");
    const chip = screen.getByTestId("line-status");
    // 6 days left is inside the shop line's 7-day window.
    expect(chip.dataset.status).toBe("EXPIRING");
  });

  it("saves a for-sale line's details with the schema's field names", async () => {
    render(<PhoneLines />);
    const row = await screen.findByTestId("resale-line-12");
    fireEvent.click(within(row).getByRole("button", { name: /Edit/ }));

    fireEvent.change(screen.getByLabelText("Carrier"), { target: { value: "alfa" } });
    fireEvent.change(screen.getByLabelText("Expiry date"), {
      target: { value: "2026-12-01" },
    });
    fireEvent.change(screen.getByLabelText("Credit ($)"), { target: { value: "2.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save line" }));

    await waitFor(() => expect(mockSaveResaleLine).toHaveBeenCalledTimes(1));
    const sent = mockSaveResaleLine.mock.calls[0][0];
    // Field names come from the schema (rule 24): parsing must not drop any.
    expect(saveResaleLineSchema.parse(sent)).toEqual(sent);
    expect(sent).toEqual(
      saveResaleLineSchema.parse({
        product_id: 12,
        carrier: "alfa",
        validity_expires_at: "2026-12-01",
        credits: 2.5,
      }),
    );
  });

  it("never guesses the carrier: a line with none must have one chosen", async () => {
    render(<PhoneLines />);
    const row = await screen.findByTestId("resale-line-12");
    fireEvent.click(within(row).getByRole("button", { name: /Edit/ }));
    expect((screen.getByLabelText("Carrier") as HTMLSelectElement).value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Save line" }));
    expect(await screen.findByText("Choose the line's carrier (MTC or Alfa).")).toBeTruthy();
    expect(mockSaveResaleLine).not.toHaveBeenCalled();
  });

  it("asks the server for sold lines when the Sold filter is on", async () => {
    render(<PhoneLines />);
    await screen.findByTestId("resale-line-10");
    fireEvent.click(screen.getByRole("checkbox", { name: /Show sold/ }));
    await waitFor(() =>
      expect(mockGetResaleLines).toHaveBeenLastCalledWith({ include_sold: true }),
    );
  });
});
