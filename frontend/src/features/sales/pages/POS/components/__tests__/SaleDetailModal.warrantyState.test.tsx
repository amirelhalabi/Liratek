/** @jest-environment jsdom */
/**
 * LIRA-296 (T016, user story 2) — every sale line that carries a warranty
 * shows its state, not only phone lines:
 *   - "Covered until <date>" / "Expired on <date>" / "Void";
 *   - a unit override (LIRA-143) wins over the stamped date;
 *   - a partly refunded line adds "· 1 of 3 refunded" and stays covered;
 *   - a line without a warranty shows nothing.
 * "Today" is the browser's own day (rule 27), never the UTC day.
 *
 * The `useApi` mock returns ONE stable object (rule 25).
 */
import { render, screen, fireEvent } from "@testing-library/react";
import SaleDetailModal from "../SaleDetailModal";

const mockApi = {
  getSale: jest.fn(),
  getSaleItems: jest.fn(),
  getSaleRefundPreview: jest.fn(),
  refundSale: jest.fn(),
  refundSaleItem: jest.fn(),
  updateSaleMetadata: jest.fn(),
  getAllSettings: jest.fn().mockResolvedValue([]),
  getSessionItemRefundPreview: jest.fn(),
  refundSessionBasketItem: jest.fn(),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

jest.mock("@/api/backendApi", () => ({
  getProductUnitsForSaleItems: jest.fn().mockResolvedValue([]),
}));

jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    drawerAffectingMethods: [{ code: "CASH", label: "Cash" }],
  }),
}));

jest.mock("@/hooks/useShopName", () => ({
  useShopInfo: () => ({ name: "Test Shop", phone: "", location: "", logo: "" }),
}));

jest.mock("@/shared/hooks/useModalFocusFix", () => ({
  useModalFocusFix: () => {},
}));

const SALE = {
  id: 4,
  client_id: null,
  client_name: "Walk-in Customer",
  client_phone: null,
  total_amount_usd: 60,
  discount_usd: 0,
  final_amount_usd: 60,
  paid_usd: 60,
  paid_lbp: 0,
  change_given_usd: 0,
  change_given_lbp: 0,
  exchange_rate_snapshot: 90000,
  status: "completed",
  created_at: "2026-09-01 10:00:00",
};

const line = (over: Record<string, unknown>) => ({
  sale_id: 4,
  product_id: 1,
  quantity: 1,
  sold_price_usd: 10,
  barcode: "",
  refunded_quantity: 0,
  is_refunded: 0,
  warranty_until: null,
  ...over,
});

beforeEach(() => {
  jest.useFakeTimers({ advanceTimers: true });
  // 2026-10-10 local noon.
  jest.setSystemTime(new Date(2026, 9, 10, 12, 0, 0));
  mockApi.getSale.mockResolvedValue(SALE);
  mockApi.getSaleItems.mockResolvedValue([
    line({ id: 1, name: "Charger", warranty_until: "2026-12-01" }),
    line({ id: 2, name: "Old Speaker", warranty_until: "2026-10-01" }),
    line({
      id: 3,
      name: "Earbuds",
      quantity: 3,
      refunded_quantity: 1,
      warranty_until: "2026-12-01",
    }),
    line({
      id: 4,
      name: "Cable",
      quantity: 2,
      refunded_quantity: 2,
      warranty_until: "2026-12-01",
    }),
    line({
      id: 5,
      name: "Phone",
      warranty_until: "2026-09-15",
      warranty_override_until: "2027-03-01",
    }),
    line({ id: 6, name: "Sticker" }),
  ]);
});

afterEach(() => jest.useRealTimers());

async function renderModal() {
  render(<SaleDetailModal saleId={4} onClose={jest.fn()} />);
  await screen.findByText("Charger");
}

describe("SaleDetailModal — warranty state on every line (LIRA-296)", () => {
  it("a covered line reads 'Covered until <date>'", async () => {
    await renderModal();
    expect(
      screen.getAllByText("Covered until 2026-12-01")[0],
    ).toBeInTheDocument();
  });

  it("an expired line reads 'Expired on <date>'", async () => {
    await renderModal();
    expect(screen.getByText("Expired on 2026-10-01")).toBeInTheDocument();
  });

  it("a partly refunded line stays covered and says how many were refunded", async () => {
    await renderModal();
    expect(
      screen.getByText("Covered until 2026-12-01 · 1 of 3 refunded"),
    ).toBeInTheDocument();
  });

  it("a fully refunded line reads 'Void'", async () => {
    await renderModal();
    expect(screen.getByText("Void")).toBeInTheDocument();
  });

  it("a unit override wins over the stamped date", async () => {
    await renderModal();
    expect(screen.getByText("Covered until 2027-03-01")).toBeInTheDocument();
    expect(screen.queryByText(/2026-09-15/)).not.toBeInTheDocument();
  });

  it("a line without a warranty shows nothing", async () => {
    await renderModal();
    const sticker = screen.getByText("Sticker").closest("div.flex-1");
    expect(sticker?.textContent).not.toMatch(/Covered|Expired|Void|Warranty/);
  });

  it("uses the browser's day: covered on the last day itself", async () => {
    jest.setSystemTime(new Date(2026, 11, 1, 23, 30, 0)); // 2026-12-01 23:30 local
    await renderModal();
    expect(screen.getAllByText(/Covered until 2026-12-01/).length).toBe(2);
  });
});

// LIRA-296 P2 (T040) — a covered line offers "Warranty claim" right from
// the sale (ClaimModal is mocked; its own behaviour has its own test).
jest.mock("@/features/warranty/components/ClaimModal", () => ({
  ClaimModal: (p: { target: { saleItemId: number; state: string } }) => (
    <div data-testid="claim-modal">
      claim {p.target.saleItemId} {p.target.state}
    </div>
  ),
}));

describe("SaleDetailModal — start a warranty claim (LIRA-296 P2)", () => {
  it("a covered line opens the claim form; a void or warranty-less line does not offer it", async () => {
    await renderModal();
    const buttons = screen.getAllByRole("button", { name: "Warranty claim" });
    // Charger, Earbuds (partly refunded), Phone (override) and the expired
    // Old Speaker (admin may honour it) — not the void Cable, not the Sticker.
    expect(buttons).toHaveLength(4);
    fireEvent.click(buttons[0]!);
    expect(await screen.findByTestId("claim-modal")).toHaveTextContent(
      "claim 1 COVERED",
    );
  });
});
