/** @jest-environment jsdom */
/**
 * FinancialForm (WHISH_APP sale screen) — admins can create a NEW category
 * from the sale screen, not only add items to existing ones (owner decision
 * 2026-10-07). A category is saved with its first item; any name is allowed,
 * but a name matching an existing category ignoring case reuses its spelling.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FinancialForm } from "../FinancialForm";
import type { ServiceItem } from "../../hooks/useMobileServiceItems";
import type { ProviderConfig } from "../../types";

const mockCreateMobileServiceItem = jest.fn();
const mockApi = {
  createMobileServiceItem: mockCreateMobileServiceItem,
  addOMTTransaction: jest.fn(),
  getAllSettings: jest.fn().mockResolvedValue([]),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({
    activeSession: null,
    linkTransaction: jest.fn(),
    addToCart: jest.fn(),
  }),
}));
jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ buyRate: 89000, sellRate: 90000 }),
}));
jest.mock("../../utils/ensureClient", () => ({
  ensureRechargeClient: jest.fn().mockResolvedValue({ ok: true, id: 1 }),
}));
jest.mock("@/shared/components/ClientAutocompleteInput", () => ({
  ClientAutocompleteInput: () => <input data-testid="stub-client-input" />,
}));
jest.mock("@/features/partners/components/PartnerSelector", () => ({
  PartnerSelector: () => null,
}));
jest.mock("@/shared/components/TransactionTimeOverride", () => ({
  TransactionTimeOverride: () => null,
}));
jest.mock("../HistoryModal", () => ({ HistoryModal: () => null }));
jest.mock("@/shared/utils/clientVouchers", () => ({
  fetchClientVouchers: jest.fn().mockResolvedValue([]),
}));
jest.mock("../PaymentSheet", () => ({ PaymentSheet: () => null }));

const ALFA_ITEM: ServiceItem = {
  key: "WHISH_APP/alfa/Prepaid/7.58",
  provider: "WHISH_APP",
  category: "alfa",
  subcategory: "Prepaid",
  label: "7.58",
  catalogCost: 700000,
  catalogSellPrice: 750000,
  sortOrder: 0,
};

const CONFIG: ProviderConfig = {
  key: "WHISH_APP",
  label: "Whish App",
  module: "ipec_katch",
  drawer: "Whish_App",
  formMode: "financial",
  color: "text-red-400",
  bgTint: "bg-red-400/10",
  activeBg: "bg-red-500",
  activeText: "text-white",
  badgeCls: "bg-red-400/10 text-red-400",
  iconKey: "Zap",
  hasSupplier: true,
};

function renderForm(onRefreshItems = jest.fn().mockResolvedValue(undefined)) {
  render(
    <FinancialForm
      activeConfig={CONFIG}
      finTransactions={[]}
      activeProvider="WHISH_APP"
      getCategoriesForProvider={() => ["alfa"]}
      getServiceItems={(_p, category) =>
        category === "alfa" ? [ALFA_ITEM] : []
      }
      methods={[{ code: "CASH", label: "Cash" }]}
      drawerAffectingMethods={[{ code: "CASH", label: "Cash" }]}
      clientName=""
      setClientName={jest.fn()}
      loadFinancialData={jest.fn()}
      formatAmount={(v) => v.toLocaleString()}
      showHistory={false}
      setShowHistory={jest.fn()}
      onRefreshItems={onRefreshItems}
      isAdmin
    />,
  );
  return { onRefreshItems };
}

function inputNextTo(labelText: string): HTMLInputElement {
  const label = screen.getByText(labelText);
  return label.parentElement!.querySelector("input") as HTMLInputElement;
}

function fillNewCategoryForm(category: string, subcategory: string) {
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

describe("FinancialForm — new category from the sale screen", () => {
  beforeEach(() => {
    mockCreateMobileServiceItem
      .mockReset()
      .mockResolvedValue({ success: true, data: { id: 9 } });
  });

  it("creates an item under a brand-new category and refreshes the catalog", async () => {
    const { onRefreshItems } = renderForm();

    fillNewCategoryForm("test", "games");

    await waitFor(() =>
      expect(mockCreateMobileServiceItem).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "WHISH_APP",
          category: "test",
          subcategory: "games",
          label: "Card 1",
          cost_lbp: 100000,
          sell_lbp: 120000,
        }),
      ),
    );
    await waitFor(() => expect(onRefreshItems).toHaveBeenCalled());
  });

  it("reuses an existing category's spelling when the name matches ignoring case", async () => {
    renderForm();

    fillNewCategoryForm("ALFA", "prepaid");

    await waitFor(() =>
      expect(mockCreateMobileServiceItem).toHaveBeenCalledWith(
        expect.objectContaining({ category: "alfa", subcategory: "Prepaid" }),
      ),
    );
  });

  it("does not offer the button to non-admins", () => {
    render(
      <FinancialForm
        activeConfig={CONFIG}
        finTransactions={[]}
        activeProvider="WHISH_APP"
        getCategoriesForProvider={() => ["alfa"]}
        getServiceItems={() => [ALFA_ITEM]}
        methods={[{ code: "CASH", label: "Cash" }]}
        drawerAffectingMethods={[{ code: "CASH", label: "Cash" }]}
        clientName=""
        setClientName={jest.fn()}
        loadFinancialData={jest.fn()}
        formatAmount={(v) => v.toLocaleString()}
        showHistory={false}
        setShowHistory={jest.fn()}
      />,
    );
    expect(screen.queryByTitle("New category")).not.toBeInTheDocument();
  });
});
