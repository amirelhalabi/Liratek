/**
 * LIRA-296 P3 (T047, FR-015) — the checkout receipt's serial line says what
 * the product's category calls it ("Serial: …" for a laptop, "IMEI: …" for
 * a phone). POS hands the modal the category lookup; without one (older
 * callers) a tracked line keeps "IMEI".
 */
import { render, screen, fireEvent } from "@testing-library/react";
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

const laptop = {
  id: 1,
  name: "ThinkPad",
  barcode: "123",
  retail_price: 600,
  quantity: 1,
  category: "Laptops",
  tracks_imei_units: 1,
  imei: "SN-001",
  cost_price: 0,
  stock_quantity: 5,
  min_stock_level: 0,
  is_active: 1,
} as any;

async function previewText(
  serialLabelOf?: (c: string | null | undefined) => "IMEI" | "Serial",
): Promise<string> {
  render(
    <CheckoutModal
      items={[laptop]}
      totalAmount={600}
      onComplete={jest.fn()}
      onSaveDraft={jest.fn()}
      onClose={jest.fn()}
      {...(serialLabelOf ? { serialLabelOf } : {})}
    />,
  );
  await screen.findByTestId("mock-multi-payment-input");
  fireEvent.click(screen.getByText("Preview"));
  await screen.findByText("Receipt Preview");
  return document.querySelector("pre")?.textContent ?? "";
}

describe("CheckoutModal — the receipt's serial line uses the category label (LIRA-296 P3)", () => {
  it("prints 'Serial:' when the category calls it Serial", async () => {
    const text = await previewText((c) => (c === "Laptops" ? "Serial" : "IMEI"));
    expect(text).toContain("Serial: SN-001");
    expect(text).not.toContain("IMEI: SN-001");
  });

  it("without a lookup, a tracked line keeps 'IMEI:'", async () => {
    const text = await previewText();
    expect(text).toContain("IMEI: SN-001");
  });
});
