/**
 * KatshForm → PaymentSheet picked-items list (2026-10-16).
 *
 * The payment window lists what was picked on the card grid (iPick / Katsh):
 * one entry per cart line plus one per pending bill. Each entry's unit price
 * must be the price ACTUALLY charged — for an Only Days line that is the
 * Only Days price, not the shelf price — so the listed line totals add up to
 * the amount the sheet charges (before discount / extra).
 *
 * Group labels are read from `cardGroupLabel` (rule 14), never hand-typed.
 */

import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { KatshForm } from "../KatshForm";
import { cardGroupLabel } from "../../utils/cardGroupLabel";
import type { PaymentSheetItem } from "../PaymentSheet";
import type {
  ServiceItem,
  ProviderKey,
} from "../../hooks/useMobileServiceItems";
import type { ProviderConfig } from "../../types";

jest.mock("@liratek/core", () => jest.requireActual("@liratek/core"));

const mockCatalogRows: Array<{
  id: number;
  sell_days_lbp: number | null;
  sell_credit_lbp: number | null;
}> = [];

// Rule 25: ONE module-level object, so useApi() returns a stable identity.
const mockApi = {
  getRates: jest
    .fn()
    .mockResolvedValue([
      { to_code: "LBP", market_rate: 89500, buy_rate: 89000, sell_rate: 89500 },
    ]),
  getAllSettings: jest.fn().mockResolvedValue([]),
  getActiveMobileServiceItems: jest
    .fn()
    .mockImplementation(() => Promise.resolve(mockCatalogRows)),
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
    linkTransaction: jest.fn(),
    addToCart: jest.fn(),
  }),
}));

jest.mock("@/assets/logos/alfa.svg?react", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/assets/logos/mtc.svg?react", () => ({
  __esModule: true,
  default: () => null,
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
jest.mock("../HistoryModal", () => ({
  HistoryModal: () => null,
}));
jest.mock("@/shared/utils/clientVouchers", () => ({
  fetchClientVouchers: jest.fn().mockResolvedValue([]),
}));

/** Last props the PaymentSheet received. */
const sheet: {
  items?: PaymentSheetItem[] | undefined;
  totalAmount?: number;
  totalAmountCurrency?: string | undefined;
} = {};
jest.mock("../PaymentSheet", () => ({
  PaymentSheet: (props: {
    open: boolean;
    items?: PaymentSheetItem[];
    totalAmount: number;
    totalAmountCurrency?: string;
  }) => {
    sheet.items = props.items;
    sheet.totalAmount = props.totalAmount;
    sheet.totalAmountCurrency = props.totalAmountCurrency;
    return props.open ? <div data-testid="stub-payment-sheet" /> : null;
  },
}));

// ── Fixtures ────────────────────────────────────────────────────────────────

const GAMING_ITEM: ServiceItem = {
  key: "Katsh/Gaming/Pubg direct/60",
  provider: "Katsh",
  category: "Gaming",
  subcategory: "Pubg direct",
  label: "60 UC",
  catalogCost: 82_340,
  catalogSellPrice: 90_000,
  sortOrder: 0,
};

/** credits=10 → maxReturnableCredits 9.00; default return = 9 → kept 0, so
 *  the Only Days price is exactly sell_days_lbp (250,000). */
const DAYS_ITEM: ServiceItem = {
  key: "iPick/mtc/Prepaid/10",
  id: 201,
  provider: "iPick",
  category: "mtc",
  subcategory: "Prepaid",
  label: "10",
  catalogCost: 1_000_000,
  catalogSellPrice: 1_200_000,
  sortOrder: 0,
  credits: 10,
  validityDays: 30,
  days_cost_lbp: 700_000,
};

function configFor(provider: "Katsh" | "iPick"): ProviderConfig {
  return {
    key: provider,
    label: provider,
    module: "ipec_katch",
    drawer: provider,
    formMode: "financial",
    color: "text-slate-400",
    bgTint: "bg-slate-400/10",
    activeBg: "bg-slate-500",
    activeText: "text-white",
    badgeCls: "bg-slate-400/10 text-slate-400",
    iconKey: "Zap",
    hasSupplier: true,
  };
}

function renderWith(item: ServiceItem) {
  const provider = item.provider as "Katsh" | "iPick";
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <KatshForm
        activeConfig={configFor(provider)}
        activeProvider={provider}
        getCategoriesForProvider={() => [item.category]}
        getServiceItems={(p: ProviderKey, category: string) =>
          p === provider && category === item.category ? [item] : []
        }
        methods={[{ code: "CASH", label: "Cash" }]}
        loadFinancialData={jest.fn()}
        formatAmount={(v: number) => v.toLocaleString()}
        alfaCreditSellRate={100_000}
        alfaCreditCostRate={0.0445}
        exchangeRate={89_500}
        showHistory={false}
        setShowHistory={jest.fn()}
      />
    </QueryClientProvider>,
  );
}

async function openSheet() {
  fireEvent.click(screen.getByRole("button", { name: /Proceed to Pay/i }));
  await screen.findByTestId("stub-payment-sheet");
}

function lineSum(items: PaymentSheetItem[]): number {
  return items.reduce((s, it) => s + it.unitPrice * it.quantity, 0);
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("KatshForm → PaymentSheet items", () => {
  beforeEach(() => {
    mockCatalogRows.length = 0;
    delete sheet.items;
    delete sheet.totalAmount;
  });

  it("lists a normal item ×2 at its sell price, and the lines add up to the sheet total", async () => {
    renderWith(GAMING_ITEM);
    await screen.findByText(GAMING_ITEM.label);
    fireEvent.click(screen.getByText(GAMING_ITEM.label)); // qty 1
    fireEvent.click(screen.getByRole("button", { name: "+" })); // qty 2
    await openSheet();

    expect(sheet.items).toHaveLength(1);
    const [line] = sheet.items as PaymentSheetItem[];
    expect(line).toMatchObject({
      name: GAMING_ITEM.label,
      group: cardGroupLabel(GAMING_ITEM),
      provider: "KATSH",
      quantity: 2,
      unitPrice: GAMING_ITEM.catalogSellPrice,
      currency: "LBP",
    });
    expect(line.note).toBeUndefined();
    expect(sheet.totalAmountCurrency).toBe("LBP");
    expect(lineSum(sheet.items as PaymentSheetItem[])).toBe(sheet.totalAmount);
  });

  it("an Only Days line carries the Only Days price and the note", async () => {
    mockCatalogRows.push({
      id: 201,
      sell_days_lbp: 250_000,
      sell_credit_lbp: 120_000,
    });
    renderWith(DAYS_ITEM);
    await screen.findByText(DAYS_ITEM.label);
    fireEvent.click(screen.getByText(DAYS_ITEM.label));
    fireEvent.click(
      await screen.findByRole("checkbox", { name: /Only Days/i }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("textbox", { name: "Only-Days price" }),
      ).toHaveValue("250,000"),
    );
    await openSheet();

    expect(sheet.items).toHaveLength(1);
    expect((sheet.items as PaymentSheetItem[])[0]).toMatchObject({
      name: DAYS_ITEM.label,
      group: cardGroupLabel(DAYS_ITEM),
      provider: "IPICK",
      quantity: 1,
      unitPrice: 250_000,
      currency: "LBP",
      note: "Only days",
    });
    expect(sheet.totalAmount).toBe(250_000);
    expect(lineSum(sheet.items as PaymentSheetItem[])).toBe(sheet.totalAmount);
  });

  it("a pending bill is listed as its own entry with no image", async () => {
    renderWith(GAMING_ITEM);
    await screen.findByText(GAMING_ITEM.label);
    fireEvent.click(screen.getByText(GAMING_ITEM.label));

    const billCard = screen.getByText("BILL").closest("div.bg-slate-800");
    expect(billCard).not.toBeNull();
    const input = within(billCard as HTMLElement).getByPlaceholderText("0");
    fireEvent.change(input, { target: { value: "500000" } });
    fireEvent.click(
      within(billCard as HTMLElement).getByRole("button", {
        name: /Add Bill/i,
      }),
    );
    await openSheet();

    const items = sheet.items as PaymentSheetItem[];
    expect(items).toHaveLength(2);
    expect(items[1]).toMatchObject({
      name: "Bill",
      quantity: 1,
      unitPrice: 500_000,
      currency: "LBP",
    });
    expect(items[1].image).toBeUndefined();
    expect(lineSum(items)).toBe(sheet.totalAmount);
  });
});
