/** @jest-environment jsdom */
/**
 * LIRA-331 — the LIRA-333 WhatsApp controls in Arabic: the button, the
 * number field, the post-sale strip and their messages follow the screen
 * language, while the WhatsApp MESSAGE itself stays English (owner
 * decision): the link opened carries the same English receipt text in both
 * languages.
 *
 * Rule 25: `mockApi` is a stable module-level object.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { i18n, loadLanguage } from "@/i18n/setup";
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
import SaleCompletedStrip from "../../pages/POS/components/SaleCompletedStrip";

const SALE = {
  id: 42,
  client_id: null,
  client_name: "Ali",
  client_phone: null,
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
  sale_phone: null,
  linked_client_phone: null,
  tender_usd: 10,
  tender_lbp: 0,
} as unknown as SaleDetail;

async function setLang(lang: "en" | "ar") {
  if (lang === "ar") await loadLanguage("ar");
  await i18n.changeLanguage(lang);
}

/** Opens WhatsApp for a typed number and returns the link it opened. */
async function sendTo(lang: "en" | "ar"): Promise<string> {
  mockOpenExternalUrl.mockClear();
  await setLang(lang);
  const { unmount } = render(<SendOnWhatsAppButton saleId={42} />);
  const button = screen.getByRole("button", {
    name: lang === "ar" ? "إرسال على واتساب" : "Send on WhatsApp",
  });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "03 123 456" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: lang === "ar" ? "إرسال" : "Send" }),
  );
  await waitFor(() => expect(mockOpenExternalUrl).toHaveBeenCalledTimes(1));
  unmount();
  return (mockOpenExternalUrl.mock.calls[0][0] as { url: string }).url;
}

describe("WhatsApp controls in Arabic (LIRA-331)", () => {
  beforeEach(() => {
    mockGetSale.mockResolvedValue(SALE);
    mockGetSaleItems.mockResolvedValue([]);
    mockOpenExternalUrl.mockResolvedValue({ success: true });
  });
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("the button, the number field and its error are Arabic", async () => {
    await setLang("ar");
    render(<SendOnWhatsAppButton saleId={42} />);
    const button = screen.getByRole("button", { name: "إرسال على واتساب" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    const field = screen.getByLabelText("رقم واتساب الزبون");
    fireEvent.change(field, { target: { value: "12" } });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "هذا ليس رقم هاتف صحيحاً — تحقّق منه وحاول مجدداً",
    );
    expect(screen.getByRole("button", { name: "إلغاء" })).toBeInTheDocument();
  });

  it("the post-sale strip is Arabic", async () => {
    await setLang("ar");
    render(<SaleCompletedStrip saleId={42} onClose={jest.fn()} />);
    expect(screen.getByRole("status", { name: "تمّ البيع" })).toHaveTextContent(
      "RCP-42",
    );
    expect(screen.getByRole("button", { name: "إغلاق" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /طباعة/ })).toBeInTheDocument();
  });

  it("the WhatsApp message stays English: the same link in both languages", async () => {
    const en = await sendTo("en");
    const ar = await sendTo("ar");
    expect(ar).toBe(en);
    expect(decodeURIComponent(en)).toContain("Corner Shop");
  });
});
