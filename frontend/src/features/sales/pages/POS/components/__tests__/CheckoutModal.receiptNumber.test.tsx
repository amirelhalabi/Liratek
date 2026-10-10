/**
 * LIRA-296 (T008) — one receipt number per sale.
 *
 * Bug: checkout printed `RCP-${Date.now()}` (e.g. RCP-1760100000000) while a
 * reprint from the sale's details printed `RCP-${sale.id}` — two numbers for
 * one sale, and the checkout one could never be searched.
 *
 * Fix under test: the receipt number is core's `receiptNumberFor(saleId)`.
 *   - When the sale already has an id (a resumed draft, which keeps its id
 *     when it is completed), checkout prints exactly the number a reprint
 *     prints.
 *   - Before a new sale is saved there is no id yet, so checkout prints NO
 *     number rather than a made-up one that would never match.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { receiptNumberFor } from "@liratek/core";
import CheckoutModal from "../CheckoutModal";

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  const api = {
    getClients: jest.fn().mockResolvedValue([]),
    getAllSettings: jest.fn().mockResolvedValue([]),
  };
  return {
    ...actual,
    useApi: () => api,
    MultiPaymentInput: () => <div data-testid="mock-multi-payment-input" />,
  };
});

jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({ activeSession: null }),
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 90500, buyRate: 90000, isLoading: false }),
}));

jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: [],
    drawerAffectingMethods: [],
    allMethods: [{ id: 1, code: "CASH", label: "Cash", is_active: 1 }],
    loading: false,
    refresh: jest.fn(),
  }),
}));

jest.mock("@/hooks/useShopName", () => ({
  useShopInfo: () => ({ name: "Shop", phone: "", location: "", logo: "" }),
}));

const item = {
  id: 1,
  name: "Widget",
  barcode: "123",
  retail_price: 10,
  quantity: 1,
  category: "",
  cost_price: 0,
  stock_quantity: 5,
  min_stock_level: 0,
  is_active: 1,
} as any;

async function previewText(saleId?: number): Promise<string> {
  render(
    <CheckoutModal
      items={[item]}
      totalAmount={10}
      onComplete={jest.fn()}
      onSaveDraft={jest.fn()}
      onClose={jest.fn()}
      {...(saleId != null ? { saleId } : {})}
    />,
  );
  await screen.findByTestId("mock-multi-payment-input");
  fireEvent.click(screen.getByText("Preview"));
  await screen.findByText("Receipt Preview");
  return document.querySelector("pre")?.textContent ?? "";
}

describe("CheckoutModal — receipt number (LIRA-296)", () => {
  it("prints receiptNumberFor(saleId) — the same number a reprint prints", async () => {
    const text = await previewText(42);
    expect(text).toContain(`#${receiptNumberFor(42)}`);
    expect(text).toContain("RCP-42");
  });

  it("never prints a timestamp number before the sale has an id", async () => {
    const text = await previewText();
    expect(text).not.toMatch(/RCP-\d{6,}/);
    expect(text).not.toContain("RCP-");
  });
});
