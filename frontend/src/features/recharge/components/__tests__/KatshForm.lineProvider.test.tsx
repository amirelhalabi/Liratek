/**
 * LIRA-326 (US2) — KatshForm books every item under ITS OWN provider.
 *
 * KatshForm stays mounted across the Katsh ↔ iPick tabs and its cart mixes
 * both providers. Before LIRA-326 it booked the whole cart under the tab the
 * cashier pressed Pay on (`activeProvider`), so iPick items paid from the
 * Katsh tab were costed against Katsh's balance and supplier — on the walk-in
 * path AND in a customer session.
 *
 * Rule 25: every useApi / useSession mock is ONE module-level object.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RECHARGE_BASKET_MODULE_PROVIDER } from "@liratek/core";
import { KatshForm } from "../KatshForm";
import type {
  ServiceItem,
  ProviderKey,
} from "../../hooks/useMobileServiceItems";
import type { ProviderConfig } from "../../types";

jest.mock("@liratek/core", () => jest.requireActual("@liratek/core"));

const mockAddOMTTransaction = jest
  .fn()
  .mockResolvedValue({ success: true, id: 42 });

const mockApi = {
  addOMTTransaction: mockAddOMTTransaction,
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

const mockAddToCart = jest.fn();
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

jest.mock("../../utils/ensureClient", () => ({
  ensureRechargeClient: jest.fn().mockResolvedValue({ ok: true, id: null }),
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

jest.mock("../PaymentSheet", () => ({
  PaymentSheet: (props: {
    open: boolean;
    totalAmount: number;
    onPaymentChange: (lines: unknown[]) => void;
    onConfirm: () => void;
  }) =>
    props.open ? (
      <div data-testid="stub-payment-sheet">
        <button
          data-testid="stub-pay-cash"
          onClick={() =>
            props.onPaymentChange([
              {
                id: "L1",
                method: "CASH",
                currencyCode: "LBP",
                amount: props.totalAmount,
              },
            ])
          }
        />
        <button data-testid="stub-confirm" onClick={props.onConfirm} />
      </div>
    ) : null,
}));

const KATSH_ITEM: ServiceItem = {
  key: "Katsh/Gaming/Pubg/60 UC",
  provider: "Katsh",
  category: "Gaming",
  subcategory: "Pubg",
  label: "60 UC",
  catalogCost: 82_340,
  catalogSellPrice: 90_000,
  sortOrder: 0,
};
const IPICK_ITEM: ServiceItem = {
  key: "iPick/Gaming/Free Fire/100 Diamonds",
  provider: "iPick",
  category: "Gaming",
  subcategory: "Free Fire",
  label: "100 Diamonds",
  catalogCost: 150_000,
  catalogSellPrice: 180_000,
  sortOrder: 0,
};

function config(key: "Katsh" | "iPick"): ProviderConfig {
  return {
    key,
    label: key,
    module: "ipec_katch",
    drawer: key,
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

const catalogItems = (p: ProviderKey, category: string): ServiceItem[] =>
  category !== "Gaming"
    ? []
    : p === "Katsh"
      ? [KATSH_ITEM]
      : p === "iPick"
        ? [IPICK_ITEM]
        : [];

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

function form(tab: "Katsh" | "iPick") {
  return (
    <QueryClientProvider client={queryClient}>
      <KatshForm
        activeConfig={config(tab)}
        activeProvider={tab}
        getCategoriesForProvider={() => ["Gaming"]}
        getServiceItems={catalogItems}
        methods={[{ code: "CASH", label: "Cash" }]}
        loadFinancialData={jest.fn()}
        formatAmount={(v) => v.toLocaleString()}
        alfaCreditSellRate={100_000}
        exchangeRate={89_500}
        showHistory={false}
        setShowHistory={jest.fn()}
      />
    </QueryClientProvider>
  );
}

type Entry = {
  module: keyof typeof RECHARGE_BASKET_MODULE_PROVIDER;
  amount: number;
  formData: { _batch: boolean; items: Array<Record<string, unknown>> };
};

describe("KatshForm books each item under its own provider (LIRA-326)", () => {
  beforeEach(() => {
    mockAddOMTTransaction.mockClear();
    mockAddToCart.mockClear();
    mockSession.activeSession = null;
  });

  it("an iPick-only cart paid from the Katsh tab books iPick", async () => {
    const { rerender } = render(form("iPick"));
    fireEvent.click(
      (await screen.findAllByText("100 Diamonds", {}, { timeout: 5000 }))[0]!,
    );
    rerender(form("Katsh"));
    await screen.findAllByText("60 UC");

    fireEvent.click(screen.getByRole("button", { name: /Proceed to Pay/i }));
    await screen.findByTestId("stub-payment-sheet");
    fireEvent.click(screen.getByTestId("stub-pay-cash"));
    fireEvent.click(screen.getByTestId("stub-confirm"));
    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    expect(mockAddOMTTransaction.mock.calls[0]![0].provider).toBe("iPick");
  });

  it("in a customer session, a mixed iPick + Katsh cart adds one entry per provider", async () => {
    mockSession.activeSession = { id: 7 };
    const { rerender } = render(form("iPick"));
    fireEvent.click(
      (await screen.findAllByText("100 Diamonds", {}, { timeout: 5000 }))[0]!,
    );
    rerender(form("Katsh"));
    fireEvent.click((await screen.findAllByText("60 UC"))[0]!);
    fireEvent.click(screen.getByRole("button", { name: /Add to Cart/i }));
    await waitFor(() => expect(mockAddToCart).toHaveBeenCalled());
    // Let any further adds land before counting.
    await new Promise((r) => setTimeout(r, 0));

    expect(mockAddToCart).toHaveBeenCalledTimes(2);
    const entries = mockAddToCart.mock.calls.map((c) => c[0] as Entry);
    expect(entries.map((e) => e.module).sort()).toEqual(["ipick", "katsh"]);
    for (const e of entries) {
      expect(e.formData._batch).toBe(true);
      expect(e.amount).toBe(
        e.formData.items.reduce((s, x) => s + (x.amount as number), 0),
      );
      for (const s of e.formData.items)
        expect(s.provider).toBe(RECHARGE_BASKET_MODULE_PROVIDER[e.module]);
    }
  });
});
