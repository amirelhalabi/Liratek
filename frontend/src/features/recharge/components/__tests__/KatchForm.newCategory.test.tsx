/** @jest-environment jsdom */
/**
 * KatchForm (iPick / Katsh sale screen) — admins can create a NEW category
 * from the sale screen (owner decision 2026-10-07). Same contract as
 * FinancialForm.newCategory.test.tsx: saved with its first item, any name,
 * existing spelling reused on a case-insensitive match.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { KatchForm } from "../KatchForm";
import type {
  ServiceItem,
  ProviderKey,
} from "../../hooks/useMobileServiceItems";
import type { ProviderConfig } from "../../types";

jest.mock("@liratek/core", () => jest.requireActual("@liratek/core"));

const mockCreateMobileServiceItem = jest.fn();
const mockApi = {
  createMobileServiceItem: mockCreateMobileServiceItem,
  getRates: jest.fn().mockResolvedValue([]),
  getAllSettings: jest.fn().mockResolvedValue([]),
  getActiveMobileServiceItems: jest.fn().mockResolvedValue([]),
  getPrimaryCarrierLine: jest
    .fn()
    .mockResolvedValue({ success: true, data: null }),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({
    activeSession: null,
    allActiveSessions: [],
    allTodaySessions: [],
    sessionTransactions: [],
  }),
}));

jest.mock("@/assets/logos/alfa.svg?react", () => ({
  __esModule: true,
  default: () => <svg data-testid="alfa-logo" />,
}));
jest.mock("@/assets/logos/mtc.svg?react", () => ({
  __esModule: true,
  default: () => <svg data-testid="mtc-logo" />,
}));

const GAMING_ITEM: ServiceItem = {
  key: "iPick/Gaming/Pubg direct/60",
  provider: "iPick",
  category: "Gaming",
  subcategory: "Pubg direct",
  label: "60 UC",
  catalogCost: 82340,
  catalogSellPrice: 0,
  sortOrder: 0,
};

const CONFIG: ProviderConfig = {
  key: "iPick",
  label: "iPick",
  module: "ipec_katch",
  drawer: "iPick",
  formMode: "financial",
  color: "text-sky-400",
  bgTint: "bg-sky-400/10",
  activeBg: "bg-sky-500",
  activeText: "text-white",
  badgeCls: "bg-sky-400/10 text-sky-400",
  iconKey: "Zap",
  hasSupplier: true,
};

function renderForm() {
  const onRefreshItems = jest.fn().mockResolvedValue(undefined);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <KatchForm
        activeConfig={CONFIG}
        activeProvider={"iPick" as ProviderKey}
        getCategoriesForProvider={() => ["Gaming"]}
        getServiceItems={(_p, category) =>
          category === "Gaming" ? [GAMING_ITEM] : []
        }
        methods={[{ code: "CASH", label: "Cash" }]}
        loadFinancialData={jest.fn()}
        formatAmount={(v: number) => v.toLocaleString()}
        alfaCreditSellRate={100}
        alfaCreditCostRate={0.0445}
        exchangeRate={89500}
        showHistory={false}
        setShowHistory={jest.fn()}
        onRefreshItems={onRefreshItems}
        isAdmin
      />
    </QueryClientProvider>,
  );
  return { onRefreshItems };
}

function inputNextTo(labelText: string): HTMLInputElement {
  const label = screen.getByText(labelText);
  return label.parentElement!.querySelector("input") as HTMLInputElement;
}

async function fillNewCategoryForm(category: string, subcategory: string) {
  // The card grid shows "Loading items..." until the catalog pricing loads.
  await screen.findByText("60 UC");
  fireEvent.click(screen.getByTitle("New category"));
  fireEvent.change(inputNextTo("Category"), { target: { value: category } });
  fireEvent.change(inputNextTo("Subcategory"), {
    target: { value: subcategory },
  });
  fireEvent.change(inputNextTo("Label"), { target: { value: "Card 1" } });
  fireEvent.change(inputNextTo("Cost"), { target: { value: "100000" } });
  fireEvent.change(inputNextTo("Sell"), { target: { value: "120000" } });
  fireEvent.click(screen.getByText("Add"));
}

describe("KatchForm — new category from the sale screen", () => {
  beforeEach(() => {
    mockCreateMobileServiceItem
      .mockReset()
      .mockResolvedValue({ success: true, data: { id: 9 } });
  });

  it("creates an item under a brand-new category and refreshes the catalog", async () => {
    const { onRefreshItems } = renderForm();

    await fillNewCategoryForm("test", "games");

    await waitFor(() =>
      expect(mockCreateMobileServiceItem).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "iPick",
          category: "test",
          subcategory: "games",
          label: "Card 1",
        }),
      ),
    );
    await waitFor(() => expect(onRefreshItems).toHaveBeenCalled());
  });

  it("reuses an existing category's spelling when the name matches ignoring case", async () => {
    renderForm();

    await fillNewCategoryForm("gaming", "pubg DIRECT");

    await waitFor(() =>
      expect(mockCreateMobileServiceItem).toHaveBeenCalledWith(
        expect.objectContaining({
          category: "Gaming",
          subcategory: "Pubg direct",
        }),
      ),
    );
  });
});
