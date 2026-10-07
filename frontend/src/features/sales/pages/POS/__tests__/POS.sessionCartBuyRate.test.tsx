/**
 * POS — a cart added to an active session carries the BUY rate (owner
 * decision 2026-10-07).
 *
 * The session checkout replays this `formData` verbatim into `sales:process`,
 * so `exchange_rate` here is the rate the sale is saved at — while the
 * session checkout itself pays at the buy rate (`SessionCheckoutModal` reads
 * `useSellRate().buyRate`). POS used `useExchangeRate("USD","LBP")`, which is
 * the SELL rate, so the item was saved at one rate and paid at another.
 *
 * Rates avoid the hooks' 89,000/89,500 fallbacks so a pass proves the DB row
 * was read; no rate hook is mocked.
 *
 * Rule 17: written before the fix; the red run is in the task report.
 * Rule 25: the `useApi` mock returns ONE stable object.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import POS from "../index";

const mockApi = {
  getRates: jest.fn().mockResolvedValue([
    {
      to_code: "LBP",
      market_rate: 89000,
      buy_rate: 88000,
      sell_rate: 90000,
      is_stronger: 0,
    },
  ]),
  getDrafts: jest.fn().mockResolvedValue([]),
  getClients: jest.fn().mockResolvedValue([]),
  getAllSettings: jest.fn().mockResolvedValue([]),
};

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return { ...actual, useApi: () => mockApi };
});

const mockAddToSessionCart = jest.fn();
const mockSession = {
  activeSession: {
    id: 1,
    customer_name: "Walk-in",
    customer_phone: "",
  },
  linkTransaction: jest.fn(),
  addToCart: mockAddToSessionCart,
};
jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => mockSession,
}));

jest.mock("../components/ProductSearch", () => ({
  __esModule: true,
  default: (props: {
    onAddToCart: (
      p: Record<string, unknown>,
      unit?: { id: number; imei: string },
    ) => Promise<boolean>;
  }) => (
    <button
      onClick={() =>
        void props.onAddToCart(
          { id: 7, name: "Charger", retail_price: 10, tracks_imei_units: 0 },
          { id: 5, imei: "IMEI-5" },
        )
      }
    >
      Add Product
    </button>
  ),
}));

jest.mock("../components/Cart", () => ({
  __esModule: true,
  default: (props: { items: unknown[]; onAddToSessionCart: () => void }) => (
    <div>
      <span data-testid="cart-count">{props.items.length}</span>
      <button onClick={props.onAddToSessionCart}>Add To Session</button>
    </div>
  ),
}));

jest.mock("../components/SaleDetailModal", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/features/inventory/pages/Inventory/ProductForm", () => ({
  __esModule: true,
  default: () => null,
}));

describe("POS — session cart item carries the buy rate", () => {
  it("formData.exchange_rate is the buy rate (88,000), not the sell rate", async () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <POS />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(mockApi.getRates).toHaveBeenCalled());
    // Flush the rate-load promise into state.
    await waitFor(() => expect(mockApi.getDrafts).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));

    fireEvent.click(screen.getByText("Add Product"));
    await waitFor(() =>
      expect(screen.getByTestId("cart-count")).toHaveTextContent("1"),
    );
    fireEvent.click(screen.getByText("Add To Session"));

    expect(mockAddToSessionCart).toHaveBeenCalledTimes(1);
    const entry = mockAddToSessionCart.mock.calls[0][0] as {
      amount: number;
      formData: { exchange_rate: number };
    };
    expect(entry.amount).toBe(10);
    expect(entry.formData.exchange_rate).toBe(88000);
  });
});
