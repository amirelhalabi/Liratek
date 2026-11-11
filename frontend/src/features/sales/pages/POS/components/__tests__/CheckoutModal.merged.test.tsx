/**
 * CheckoutModal — 2 per-ticket test files merged into one suite
 * (2026-11-11, owner decision: one module boot instead of 2).
 *
 * Each former file is one describe block below, named after it; its own
 * header comment (including its rule-17 failing-first history) is kept at the
 * top of its block, and its test bodies are unchanged. Every former file
 * declared exactly the same jest.mock set and shared mock setup, which is
 * kept once at the top. Each block starts with resetBetweenFiles(), which
 * puts the shared mocks back to how a fresh file would see them, so no block
 * depends on state left by the block above it.
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

function resetBetweenFiles() {
  jest.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  jest.useRealTimers();
}

describe("CheckoutModal.receiptNumber (LIRA-296)", () => {
  beforeAll(resetBetweenFiles);

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
});

describe("CheckoutModal.serialLabel (LIRA-296)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-296 P3 (T047, FR-015) — the checkout receipt's serial line says what
   * the product's category calls it ("Serial: …" for a laptop, "IMEI: …" for
   * a phone). POS hands the modal the category lookup; without one (older
   * callers) a tracked line keeps "IMEI".
   */

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
      const text = await previewText((c) =>
        c === "Laptops" ? "Serial" : "IMEI",
      );
      expect(text).toContain("Serial: SN-001");
      expect(text).not.toContain("IMEI: SN-001");
    });

    it("without a lookup, a tracked line keeps 'IMEI:'", async () => {
      const text = await previewText();
      expect(text).toContain("IMEI: SN-001");
    });
  });
});
