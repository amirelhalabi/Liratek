/**
 * Owner report 2026-10-29 (Cornertech): a price edited in Settings → Mobile
 * services never reached a recharge screen that was already open on another
 * till. The catalog loaded once at sign-in and only the editing screen called
 * refresh(), so the till kept selling at the old prices until it was
 * reloaded. The server already pushes a "mobile_service_items changed"
 * invalidation after every write; nothing listened.
 *
 * An open screen must pick the change up: on the server's invalidation, and
 * when the cashier comes back to the tab. Rule 25: one module-level api mock.
 */
import { render, screen, waitFor, act } from "@testing-library/react";

const mockApi = {
  countMobileServiceItems: jest.fn(),
  seedMobileServiceItems: jest.fn(),
  getActiveMobileServiceItems: jest.fn(),
  getItemCosts: jest.fn(),
  getVoucherImages: jest.fn(),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

const stableAuth = { isAuthenticated: true };
jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => stableAuth,
}));

type Handler = (payload: unknown) => void;
const invalidationHandlers = new Map<string, Handler[]>();
jest.mock("@/api/realtime", () => ({
  subscribeToInvalidation: (entity: string, handler: Handler) => {
    const list = invalidationHandlers.get(entity) ?? [];
    list.push(handler);
    invalidationHandlers.set(entity, list);
    return () => {
      invalidationHandlers.set(
        entity,
        (invalidationHandlers.get(entity) ?? []).filter((h) => h !== handler),
      );
    };
  },
}));

import {
  MobileServiceItemsProvider,
  useMobileServiceItemsContext,
} from "../MobileServiceItemsContext";

const item = (sell: number) => ({
  id: 11386,
  provider: "Katsh",
  category: "internet",
  subcategory: "Mobi",
  label: "OS 80GB Free night",
  cost_lbp: sell === 700_000 ? 597_000 : 690_000,
  sell_lbp: sell,
  sort_order: 50,
  is_active: 1,
});

function Probe() {
  const { items } = useMobileServiceItemsContext();
  const it = items.find((i) => i.id === 11386);
  return <div data-testid="price">{it ? it.catalogSellPrice : "none"}</div>;
}

function renderProvider() {
  render(
    <MobileServiceItemsProvider>
      <Probe />
    </MobileServiceItemsProvider>,
  );
}

describe("MobileServiceItemsContext — an open screen picks up price edits", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    invalidationHandlers.clear();
    mockApi.countMobileServiceItems.mockResolvedValue({
      success: true,
      data: 1,
    });
    mockApi.getActiveMobileServiceItems.mockResolvedValue([item(760_000)]);
    mockApi.getItemCosts.mockResolvedValue([]);
    mockApi.getVoucherImages.mockResolvedValue([]);
  });

  it("refreshes when the server says mobile service items changed", async () => {
    renderProvider();
    await waitFor(() =>
      expect(screen.getByTestId("price").textContent).toBe("760000"),
    );

    // Another till edits the price in Settings.
    mockApi.getActiveMobileServiceItems.mockResolvedValue([item(700_000)]);
    await act(async () => {
      for (const h of invalidationHandlers.get("mobile_service_items") ?? [])
        h({ entity: "mobile_service_items" });
    });

    await waitFor(() =>
      expect(screen.getByTestId("price").textContent).toBe("700000"),
    );
  });

  it("refreshes when the cashier comes back to the tab", async () => {
    renderProvider();
    await waitFor(() =>
      expect(screen.getByTestId("price").textContent).toBe("760000"),
    );

    mockApi.getActiveMobileServiceItems.mockResolvedValue([item(700_000)]);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() =>
      expect(screen.getByTestId("price").textContent).toBe("700000"),
    );
  });
});
