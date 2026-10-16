/** @jest-environment jsdom */
/**
 * LIRA-324 — FinancialForm in USD mode (Whish App → Bills, LBP | USD switch).
 *
 * In USD mode the grid shows only items with a USD price (never the MTC /
 * Alfa Prepaid cards), shows dollar prices, and books the sale in USD: the
 * walk-in payload carries `currency: "USD"`, the USD cost / price, and the
 * checkout total on its USD side. Without the prop the form stays LBP.
 *
 * Field names are checked by parsing the real payload through the core
 * schema (rule 24). Written before the change (rule 17).
 */

import { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createFinancialServiceSchema } from "@liratek/core";
import { FinancialForm } from "../FinancialForm";
import type { ServiceItem } from "../../hooks/useMobileServiceItems";
import type { ProviderConfig } from "../../types";
import type { CatalogCurrency } from "@liratek/core";
import type { PaymentSheetItem } from "../PaymentSheet";
import { cardGroupLabel } from "../../utils/cardGroupLabel";

const mockAddOMTTransaction = jest
  .fn()
  .mockResolvedValue({ success: true, id: 1 });

// rule 25: one stable object for every useApi() call
const mockApi = {
  addOMTTransaction: mockAddOMTTransaction,
  getAllSettings: jest.fn().mockResolvedValue([]),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

const mockAddToCart = jest.fn().mockResolvedValue(undefined);
// Mutable so one test can open a customer session (rule 25: stable object).
const mockSession: { activeSession: { id: number } | null } = {
  activeSession: null,
};
const mockSessionValue = {
  get activeSession() {
    return mockSession.activeSession;
  },
  linkTransaction: jest.fn(),
  addToCart: mockAddToCart,
};
jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => mockSessionValue,
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ buyRate: 89000, sellRate: 90000 }),
}));

jest.mock("../../utils/ensureClient", () => ({
  ensureRechargeClient: jest.fn().mockResolvedValue({ ok: true, id: 411 }),
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

const sheetProps: {
  totalAmountCurrency?: string | undefined;
  currency?: string | undefined;
  totalAmount?: number | undefined;
  items?: PaymentSheetItem[] | undefined;
} = {};
jest.mock("../PaymentSheet", () => ({
  PaymentSheet: (props: {
    open: boolean;
    totalAmountCurrency?: string;
    currency?: string;
    totalAmount: number;
    items?: PaymentSheetItem[];
    onPaymentChange: (lines: unknown[]) => void;
    onConfirm: () => void;
  }) => {
    sheetProps.totalAmountCurrency = props.totalAmountCurrency;
    sheetProps.currency = props.currency;
    sheetProps.totalAmount = props.totalAmount;
    sheetProps.items = props.items;
    return props.open ? (
      <div data-testid="stub-payment-sheet">
        <button
          data-testid="stub-pay-usd"
          onClick={() =>
            props.onPaymentChange([
              { id: "L1", method: "CASH", currencyCode: "USD", amount: 10 },
            ])
          }
        />
        <button data-testid="stub-confirm" onClick={props.onConfirm} />
      </div>
    ) : null;
  },
}));

// ── Fixtures ────────────────────────────────────────────────────────────────
const BOTH: ServiceItem = {
  key: "WHISH_APP/Gaming/PlayStation LEB/PSN $10 - LEBANON",
  provider: "WHISH_APP",
  category: "Gaming",
  subcategory: "PlayStation LEB",
  label: "PSN $10 - LEBANON",
  catalogCost: 897000,
  catalogSellPrice: 900000,
  catalogCostUsd: 9.5,
  catalogSellPriceUsd: 10,
  sortOrder: 0,
};
const LBP_ONLY: ServiceItem = {
  key: "WHISH_APP/Gaming/Genshin Impact/GENSHIN IMPACT $5",
  provider: "WHISH_APP",
  category: "Gaming",
  subcategory: "Genshin Impact",
  label: "GENSHIN IMPACT $5",
  catalogCost: 449000,
  catalogSellPrice: 449000,
  sortOrder: 1,
};
const USD_ONLY: ServiceItem = {
  key: "WHISH_APP/Gaming/Razer Gold/RAZER $1",
  provider: "WHISH_APP",
  category: "Gaming",
  subcategory: "Razer Gold",
  label: "RAZER $1",
  catalogCost: 0,
  catalogSellPrice: 0,
  catalogCostUsd: 1,
  catalogSellPriceUsd: 1,
  sortOrder: 2,
};
const PREPAID: ServiceItem = {
  key: "WHISH_APP/mtc/Prepaid/7.58",
  provider: "WHISH_APP",
  category: "mtc",
  subcategory: "Prepaid",
  label: "7.58",
  catalogCost: 765007,
  catalogSellPrice: 800000,
  catalogCostUsd: 8.64,
  catalogSellPriceUsd: 8.64,
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

function renderForm(
  currency?: "LBP" | "USD",
  onCurrencyChange?: (next: CatalogCurrency) => void,
) {
  return render(
    <FinancialForm
      {...(onCurrencyChange ? { onCurrencyChange } : {})}
      activeConfig={CONFIG}
      finTransactions={[]}
      activeProvider="WHISH_APP"
      getCategoriesForProvider={() => ["Gaming", "mtc"]}
      getServiceItems={(_p, category) =>
        category === "Gaming"
          ? [BOTH, LBP_ONLY, USD_ONLY]
          : category === "mtc"
            ? [PREPAID]
            : []
      }
      methods={[{ code: "CASH", label: "Cash" }]}
      drawerAffectingMethods={[{ code: "CASH", label: "Cash" }]}
      clientName="amir halabi"
      setClientName={jest.fn()}
      loadFinancialData={jest.fn()}
      formatAmount={(v) => v.toLocaleString()}
      showHistory={false}
      setShowHistory={jest.fn()}
      {...(currency ? { currency } : {})}
    />,
  );
}

async function sellOne(label: string) {
  fireEvent.click(screen.getByText(label));
  fireEvent.click(screen.getByRole("button", { name: /Proceed to Pay/i }));
  await screen.findByTestId("stub-payment-sheet");
  fireEvent.click(screen.getByTestId("stub-pay-usd"));
  fireEvent.click(screen.getByTestId("stub-confirm"));
  await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalled());
  return mockAddOMTTransaction.mock.calls[0][0];
}

describe("FinancialForm — USD mode (LIRA-324)", () => {
  beforeEach(() => {
    mockAddOMTTransaction.mockClear();
    mockAddToCart.mockClear();
    mockSession.activeSession = null;
  });

  it("shows only items with a USD price, never a Prepaid card, with dollar prices", () => {
    renderForm("USD");
    expect(screen.getByText("PSN $10 - LEBANON")).toBeInTheDocument();
    expect(screen.getByText("RAZER $1")).toBeInTheDocument();
    expect(screen.queryByText("GENSHIN IMPACT $5")).not.toBeInTheDocument();
    expect(screen.queryByText("7.58")).not.toBeInTheDocument();
    expect(screen.getAllByText("$10.00").length).toBeGreaterThan(0);
    expect(screen.queryByText(/LBP/)).not.toBeInTheDocument();
  });

  it("books the sale in USD: USD price and cost, USD checkout total, USD payment sheet", async () => {
    renderForm("USD");
    const payload = await sellOne("PSN $10 - LEBANON");
    const parsed = createFinancialServiceSchema.parse(payload);
    expect(parsed.currency).toBe("USD");
    expect(parsed.amount).toBe(10);
    expect(parsed.cost).toBe(9.5);
    expect(parsed.checkoutTotal).toEqual({ usd: 10, lbp: 0 });
    expect(sheetProps.totalAmountCurrency).toBe("USD");
    expect(sheetProps.currency).toBe("USD");
  });

  it("stays LBP without the prop: LBP items, LBP payload, USD-only items hidden", async () => {
    renderForm();
    expect(screen.queryByText("RAZER $1")).not.toBeInTheDocument();
    expect(screen.getByText("GENSHIN IMPACT $5")).toBeInTheDocument();
    const payload = await sellOne("PSN $10 - LEBANON");
    const parsed = createFinancialServiceSchema.parse(payload);
    expect(parsed.currency).toBe("LBP");
    expect(parsed.amount).toBe(900000);
    expect(parsed.cost).toBe(897000);
    expect(parsed.checkoutTotal).toEqual({ usd: 0, lbp: 900000 });
  });

  it("adds a USD entry to an open customer session (basket never mixes currencies)", async () => {
    mockSession.activeSession = { id: 7 };
    renderForm("USD");
    fireEvent.click(screen.getByText("PSN $10 - LEBANON"));
    fireEvent.click(screen.getByRole("button", { name: /Add to Cart/i }));
    await waitFor(() => expect(mockAddToCart).toHaveBeenCalled());
    const entry = mockAddToCart.mock.calls[0][0];
    expect(entry.currency).toBe("USD");
    expect(entry.amount).toBe(10);
    for (const sub of entry.formData.items) {
      expect(sub.currency).toBe("USD");
      expect(sub.amount).toBe(10);
      expect(sub.cost).toBe(9.5);
    }
    expect(mockAddOMTTransaction).not.toHaveBeenCalled();
  });

  it("keeps the shared items in the same order in both modes", () => {
    const shown = () =>
      screen
        .getAllByText(/^(PSN \$10 - LEBANON|RAZER \$1|GENSHIN IMPACT \$5)$/)
        .map((el) => el.textContent);
    const { unmount } = renderForm("LBP");
    const lbp = shown().filter((t) => t === "PSN $10 - LEBANON");
    unmount();
    renderForm("USD");
    const usd = shown();
    expect(usd).toEqual(["PSN $10 - LEBANON", "RAZER $1"]);
    expect(usd.filter((t) => t === "PSN $10 - LEBANON")).toEqual(lbp);
  });

  describe("switching currency (LBP | USD)", () => {
    /** The page holds the currency; the form asks before dropping a basket. */
    function Harness({ onChange }: { onChange: jest.Mock }) {
      const [currency, setCurrency] = useState<CatalogCurrency>("LBP");
      return renderFormElement(currency, (next) => {
        onChange(next);
        setCurrency(next);
      });
    }
    function renderFormElement(
      currency: CatalogCurrency,
      onCurrencyChange: (next: CatalogCurrency) => void,
    ) {
      return (
        <FinancialForm
          activeConfig={CONFIG}
          finTransactions={[]}
          activeProvider="WHISH_APP"
          getCategoriesForProvider={() => ["Gaming"]}
          getServiceItems={() => [BOTH, LBP_ONLY, USD_ONLY]}
          methods={[{ code: "CASH", label: "Cash" }]}
          drawerAffectingMethods={[{ code: "CASH", label: "Cash" }]}
          clientName=""
          setClientName={jest.fn()}
          loadFinancialData={jest.fn()}
          formatAmount={(v) => v.toLocaleString()}
          showHistory={false}
          setShowHistory={jest.fn()}
          currency={currency}
          onCurrencyChange={onCurrencyChange}
        />
      );
    }
    const proceed = () =>
      screen.getByRole("button", { name: /Proceed to Pay/i });
    const usd = () => screen.getByRole("radio", { name: "USD" });

    it("shows no switch when the page does not ask for one", () => {
      renderForm("LBP");
      expect(screen.queryByRole("radiogroup", { name: "Currency" })).toBeNull();
    });

    it("switches straight away when nothing is selected", () => {
      const onChange = jest.fn();
      render(<Harness onChange={onChange} />);
      fireEvent.click(usd());
      expect(onChange).toHaveBeenCalledWith("USD");
      expect(screen.queryByTestId("confirm-modal")).toBeNull();
      expect(screen.getByText("RAZER $1")).toBeInTheDocument();
    });

    it("with items selected, asks first: Cancel keeps the currency and the selection", () => {
      const onChange = jest.fn();
      render(<Harness onChange={onChange} />);
      fireEvent.click(screen.getByText("PSN $10 - LEBANON"));
      expect(proceed()).toBeEnabled();
      fireEvent.click(usd());
      expect(screen.getByTestId("confirm-modal")).toBeInTheDocument();
      expect(onChange).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.queryByTestId("confirm-modal")).toBeNull();
      expect(onChange).not.toHaveBeenCalled();
      expect(screen.getByText("GENSHIN IMPACT $5")).toBeInTheDocument();
      expect(proceed()).toBeEnabled();
    });

    it("with items selected, Continue clears the selection and switches", () => {
      const onChange = jest.fn();
      render(<Harness onChange={onChange} />);
      fireEvent.click(screen.getByText("PSN $10 - LEBANON"));
      fireEvent.click(usd());
      fireEvent.click(
        screen.getByRole("button", { name: /Clear and switch/i }),
      );
      expect(onChange).toHaveBeenCalledWith("USD");
      expect(screen.getByText("RAZER $1")).toBeInTheDocument();
      expect(proceed()).toBeDisabled();
    });
  });

  describe("picked items in the payment window", () => {
    /** Pick `label`, raise it to `qty` with the card's "+", open the sheet. */
    async function pickAndOpen(label: string, qty: number) {
      fireEvent.click(screen.getByText(label));
      for (let n = 1; n < qty; n++) {
        fireEvent.click(screen.getByRole("button", { name: "+" }));
      }
      fireEvent.click(screen.getByRole("button", { name: /Proceed to Pay/i }));
      await screen.findByTestId("stub-payment-sheet");
    }
    const lineSum = (items: PaymentSheetItem[]) =>
      items.reduce((sum, it) => sum + it.unitPrice * it.quantity, 0);

    it("lists each cart line with its group, quantity and LBP unit price", async () => {
      renderForm();
      await pickAndOpen("PSN $10 - LEBANON", 2);
      const items = sheetProps.items ?? [];
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        key: BOTH.key,
        name: "PSN $10 - LEBANON",
        group: cardGroupLabel(BOTH),
        provider: "WHISH",
        quantity: 2,
        unitPrice: 900000,
        currency: "LBP",
      });
      expect(lineSum(items)).toBe(sheetProps.totalAmount);
      expect(sheetProps.totalAmount).toBe(1800000);
    });

    it("in USD mode lists the USD unit price and currency", async () => {
      renderForm("USD");
      await pickAndOpen("PSN $10 - LEBANON", 2);
      const items = sheetProps.items ?? [];
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        name: "PSN $10 - LEBANON",
        group: "PlayStation LEB",
        quantity: 2,
        unitPrice: 10,
        currency: "USD",
      });
      expect(lineSum(items)).toBe(sheetProps.totalAmount);
      expect(sheetProps.totalAmount).toBe(20);
    });

    it("two different lines add up to the sheet's total", async () => {
      renderForm("USD");
      fireEvent.click(screen.getByText("RAZER $1"));
      await pickAndOpen("PSN $10 - LEBANON", 1);
      const items = sheetProps.items ?? [];
      expect(items.map((it) => it.name).sort()).toEqual([
        "PSN $10 - LEBANON",
        "RAZER $1",
      ]);
      expect(lineSum(items)).toBe(11);
      expect(sheetProps.totalAmount).toBe(11);
    });
  });
});
