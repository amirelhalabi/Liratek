/**
 * LIRA-333 T023 — the "Send on WhatsApp" button shared by the post-sale
 * strip and the sale details window.
 *
 *  - FR-020: the client's "Receive updates via WhatsApp" switch does NOT
 *    hide or disable it — a client with the switch OFF still gets it;
 *  - a sale with no number shows a small inline number field; the
 *    confirming click opens WhatsApp synchronously; an invalid number is
 *    refused with a message;
 *  - a blocked pop-up shows a visible message (FR-018).
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SaleDetail } from "@/features/sales/types/saleDetail";

const mockGetSale = jest.fn();
const mockGetSaleItems = jest.fn();
const mockOpenExternalUrl = jest.fn();
const mockApi = {
  getSale: mockGetSale,
  getSaleItems: mockGetSaleItems,
  openExternalUrl: mockOpenExternalUrl,
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

jest.mock("@/hooks/useShopName", () => ({
  useShopInfo: () => ({
    name: "Corner Shop",
    phone: "",
    location: "",
    logo: "",
    headerText: "",
    warrantyTerms: "",
  }),
}));

import SendOnWhatsAppButton from "../SendOnWhatsAppButton";

function sale(over: Partial<SaleDetail> = {}): SaleDetail {
  return {
    id: 42,
    client_id: 7,
    client_name: "Ali",
    client_phone: "03 123 456",
    total_amount_usd: 10,
    discount_usd: 0,
    final_amount_usd: 10,
    paid_usd: 10,
    paid_lbp: 0,
    change_given_usd: 0,
    change_given_lbp: 0,
    exchange_rate_snapshot: 89_000,
    status: "completed",
    created_at: "2026-10-10 08:15:00",
    sale_phone: "03 123 456",
    linked_client_phone: "03 123 456",
    tender_usd: 10,
    tender_lbp: 0,
    gift_card_usd: 0,
    on_account_usd: 0,
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSaleItems.mockResolvedValue([]);
  mockOpenExternalUrl.mockResolvedValue({ success: true });
});

async function button() {
  const b = await screen.findByRole("button", { name: /send on whatsapp/i });
  await waitFor(() => expect(b).toBeEnabled());
  return b;
}

describe("SendOnWhatsAppButton", () => {
  it("stays enabled for a client whose WhatsApp updates switch is OFF (FR-020)", async () => {
    mockGetSale.mockResolvedValue({ ...sale(), whatsapp_opt_in: 0 });
    render(<SendOnWhatsAppButton saleId={42} />);
    const b = await button();
    fireEvent.click(b);
    expect(mockOpenExternalUrl).toHaveBeenCalledTimes(1);
    expect(mockOpenExternalUrl.mock.calls[0][0].url).toMatch(
      /^https:\/\/wa\.me\/9613123456\?text=/,
    );
  });

  it("is disabled while the sale loads", () => {
    mockGetSale.mockReturnValue(new Promise(() => {}));
    render(<SendOnWhatsAppButton saleId={42} />);
    expect(
      screen.getByRole("button", { name: /send on whatsapp/i }),
    ).toBeDisabled();
  });

  it("asks for a number on a sale without one, refuses an invalid one, opens a valid one", async () => {
    mockGetSale.mockResolvedValue(
      sale({ sale_phone: null, linked_client_phone: null, client_id: null }),
    );
    render(<SendOnWhatsAppButton saleId={42} />);
    fireEvent.click(await button());
    expect(mockOpenExternalUrl).not.toHaveBeenCalled();

    const field = await screen.findByLabelText(/customer's whatsapp number/i);
    fireEvent.change(field, { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));
    expect(mockOpenExternalUrl).not.toHaveBeenCalled();
    expect(screen.getByText(/not a valid phone number/i)).toBeInTheDocument();

    fireEvent.change(field, { target: { value: "+33 6 12 34 56 78" } });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));
    expect(mockOpenExternalUrl).toHaveBeenCalledTimes(1);
    expect(mockOpenExternalUrl.mock.calls[0][0].url).toMatch(
      /^https:\/\/wa\.me\/33612345678\?text=/,
    );
  });

  it("Cancel closes the number field without opening", async () => {
    mockGetSale.mockResolvedValue(
      sale({ sale_phone: null, linked_client_phone: null }),
    );
    render(<SendOnWhatsAppButton saleId={42} />);
    fireEvent.click(await button());
    await screen.findByLabelText(/customer's whatsapp number/i);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(
      screen.queryByLabelText(/customer's whatsapp number/i),
    ).not.toBeInTheDocument();
    expect(mockOpenExternalUrl).not.toHaveBeenCalled();
  });

  it("shows the blocked message when the browser blocks the tab (FR-018)", async () => {
    mockGetSale.mockResolvedValue(sale());
    mockOpenExternalUrl.mockResolvedValue({ success: false, error: "blocked" });
    render(<SendOnWhatsAppButton saleId={42} />);
    fireEvent.click(await button());
    expect(
      await screen.findByText(
        "WhatsApp could not be opened — allow pop-ups and try again",
      ),
    ).toBeInTheDocument();
  });

  it("shows a load failure", async () => {
    mockGetSale.mockRejectedValue(new Error("offline"));
    render(<SendOnWhatsAppButton saleId={42} />);
    expect(
      await screen.findByText(/could not load the receipt/i),
    ).toBeInTheDocument();
  });
});
