/** @jest-environment jsdom */
/**
 * LIRA-333 T026 — the sale details window gets "Send on WhatsApp" next to
 * Print (FR-002), and its Print now renders from the ONE receipt
 * description, so the paper and the message agree (FR-006, FR-008):
 *  - shown for a completed sale, hidden for a draft (FR-003);
 *  - Print shows the "On Account" line and reads the tender, not `paid_*`;
 *  - an old sale uses its saved rate, not today's (US2-3);
 *  - after the customer's phone is edited, the corrected phone is used
 *    (US2-2);
 *  - a refunded sale sends the same text as its reprint (US2-4).
 *
 * The `useApi` mock returns ONE stable object (rule 25).
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SaleDetailModal from "../SaleDetailModal";
import type { SaleDetail } from "@/features/sales/types/saleDetail";

const mockPrintReceipt = jest.fn();
jest.mock("@/shared/utils/printReceipt", () => ({
  printReceipt: (opts: { text: string }) => mockPrintReceipt(opts),
}));

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
  openExternalUrl: jest.fn(),
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
  useShopInfo: () => ({
    name: "Test Shop",
    phone: "",
    location: "",
    logo: "",
    headerText: "",
    warrantyTerms: "",
  }),
}));

jest.mock("@/shared/hooks/useModalFocusFix", () => ({
  useModalFocusFix: () => {},
}));

function sale(over: Partial<SaleDetail> = {}): SaleDetail {
  return {
    id: 4,
    client_id: null,
    client_name: "Walk-in Ali",
    client_phone: "03 123 456",
    total_amount_usd: 60,
    discount_usd: 0,
    final_amount_usd: 60,
    // a later repayment raised paid_usd to the full 60
    paid_usd: 60,
    paid_lbp: 0,
    change_given_usd: 0,
    change_given_lbp: 0,
    exchange_rate_snapshot: 50_000,
    status: "completed",
    created_at: "2026-09-01 10:00:00",
    sale_phone: "03 123 456",
    linked_client_phone: null,
    tender_usd: 20,
    tender_lbp: 0,
    gift_card_usd: 0,
    on_account_usd: 40,
    ...over,
  };
}

const ITEMS = [
  {
    id: 1,
    sale_id: 4,
    product_id: 1,
    quantity: 1,
    sold_price_usd: 60,
    name: "Speaker",
    barcode: "",
    refunded_quantity: 0,
    is_refunded: 0,
    warranty_until: null,
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.getSaleItems.mockResolvedValue(ITEMS);
  mockApi.getAllSettings.mockResolvedValue([]);
  mockApi.openExternalUrl.mockResolvedValue({ success: true });
});

async function renderModal(s: SaleDetail) {
  mockApi.getSale.mockResolvedValue(s);
  render(<SaleDetailModal saleId={s.id} onClose={jest.fn()} />);
  await screen.findByText("Speaker");
}

async function sendButton() {
  const b = await screen.findByRole("button", { name: /send on whatsapp/i });
  await waitFor(() => expect(b).toBeEnabled());
  return b;
}

function sentText(): string {
  const url = mockApi.openExternalUrl.mock.calls[0][0].url as string;
  return decodeURIComponent(url.split("?text=")[1]);
}

async function printedText(): Promise<string> {
  fireEvent.click(screen.getByRole("button", { name: /^print$/i }));
  await waitFor(() => expect(mockPrintReceipt).toHaveBeenCalled());
  return mockPrintReceipt.mock.calls[0][0].text as string;
}

describe("SaleDetailModal — Send on WhatsApp (LIRA-333)", () => {
  it("shows the button next to Print for a completed sale", async () => {
    await renderModal(sale());
    expect(await sendButton()).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^print$/i }),
    ).toBeInTheDocument();
  });

  it("hides it for a draft (FR-003)", async () => {
    await renderModal(sale({ status: "draft" }));
    expect(
      screen.queryByRole("button", { name: /send on whatsapp/i }),
    ).not.toBeInTheDocument();
  });

  it("Print shows the account part on its own line and the tender as paid (FR-006/FR-008)", async () => {
    await renderModal(sale());
    const text = await printedText();
    expect(text).toMatch(/On Account:\s+\$40\.00/);
    expect(text).toMatch(/Paid USD:\s+\$20\.00/);
    expect(text).not.toMatch(/Paid USD:\s+\$60\.00/);
  });

  it("the message and the reprint carry the same figures, at the saved rate (US2-3)", async () => {
    await renderModal(sale());
    fireEvent.click(await sendButton());
    const msg = sentText();
    const paper = await printedText();
    const lbp = (60 * 50_000).toLocaleString();
    expect(msg).toContain(`Total in LBP: ${lbp} LBP`);
    expect(paper).toContain(`${lbp} LBP`);
    expect(msg).toContain("On account: $40.00");
    expect(msg).toContain("Paid USD: $20.00");
    expect(msg).toContain("Receipt: RCP-4");
  });

  it("a refunded sale sends the same text as its reprint (US2-4)", async () => {
    await renderModal(sale({ status: "refunded" }));
    fireEvent.click(await sendButton());
    expect(sentText()).toContain("*Total: $60.00*");
    expect(await printedText()).toMatch(/TOTAL:\s+\$60\.00/);
  });

  it("after the customer phone is edited, the corrected phone is used (US2-2)", async () => {
    await renderModal(sale());
    mockApi.updateSaleMetadata.mockResolvedValue({ success: true });
    mockApi.getSale.mockResolvedValue(sale({ sale_phone: "76 901 610" }));

    fireEvent.click(screen.getByTitle(/edit customer/i));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(mockApi.updateSaleMetadata).toHaveBeenCalled());
    // the sender re-reads the sale after the edit
    await waitFor(() =>
      expect(mockApi.getSale.mock.calls.length).toBeGreaterThanOrEqual(4),
    );
    fireEvent.click(await sendButton());
    await waitFor(() => expect(mockApi.openExternalUrl).toHaveBeenCalled());
    const url = mockApi.openExternalUrl.mock.calls.at(-1)![0].url as string;
    expect(url).toMatch(/^https:\/\/wa\.me\/96176901610\?/);
  });
});
