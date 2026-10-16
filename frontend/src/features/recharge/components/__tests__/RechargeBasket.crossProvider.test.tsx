/**
 * LIRA-326 T011 — one Mobile Recharge basket across providers.
 *
 *  - picks survive switching provider tabs (KatshForm ↔ FinancialForm unmount);
 *  - a 2-provider basket pays ONCE through `rechargeBasketCheckout`, one
 *    `_batch` entry per provider, every sub-item under its own provider
 *    (schema-parsed STRICT, rule 24);
 *  - an iPick-only cart paid from the Katsh tab books iPick, never Katsh
 *    (today's mis-booking);
 *  - in a customer session, a mixed iPick + Katsh cart adds one session cart
 *    entry PER provider.
 *
 * LIRA-327 adds:
 *  - bills live in the basket: they survive tab switches, count on their own
 *    tab's badge, are booked under the tab they were added on, and ride a
 *    mixed basket's one payment as their own BILL entry;
 *  - "For Partner" is basket-wide: on in one tab = on in every basket tab,
 *    with a confirm when the basket already has items; one submit books every
 *    provider's partner sales through `rechargePartnerOrder`.
 *
 * Rule 25: every useApi / useSession mock is ONE module-level object.
 */
import { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  rechargeBasketCheckoutSchema,
  rechargePartnerOrderSchema,
  RECHARGE_BASKET_MODULE_PROVIDER,
  type RechargeBasketModule,
} from "@liratek/core";
import { KatshForm } from "../KatshForm";
import { FinancialForm } from "../FinancialForm";
import {
  RechargeBasketProvider,
  useRechargeBasketCounts,
} from "../../context/RechargeBasketContext";
import type { PaymentSheetItem } from "../PaymentSheet";
import type {
  ServiceItem,
  ProviderKey,
} from "../../hooks/useMobileServiceItems";
import type { ProviderConfig } from "../../types";

jest.mock("@liratek/core", () => jest.requireActual("@liratek/core"));

const mockAddOMTTransaction = jest
  .fn()
  .mockResolvedValue({ success: true, id: 42 });
const mockRechargeBasketCheckout = jest
  .fn()
  .mockResolvedValue({ success: true, sessionId: 9 });

const mockRechargePartnerOrder = jest
  .fn()
  .mockResolvedValue({ success: true, ids: [1, 2] });

const mockApi = {
  addOMTTransaction: mockAddOMTTransaction,
  rechargeBasketCheckout: mockRechargeBasketCheckout,
  rechargePartnerOrder: mockRechargePartnerOrder,
  getAllSettings: jest.fn().mockResolvedValue([]),
  getActiveMobileServiceItems: jest.fn().mockResolvedValue([]),
  getPrimaryCarrierLine: jest
    .fn()
    .mockResolvedValue({ success: true, data: null }),
  createMobileServiceItem: jest.fn().mockResolvedValue({ success: true }),
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

const mockAuthValue = { user: { id: 5 } };
jest.mock("@/features/auth/context/AuthContext", () => ({
  useOptionalAuth: () => mockAuthValue,
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ buyRate: 89_000, sellRate: 89_500 }),
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
  PartnerSelector: (props: {
    selectedPartnerId: number | null;
    onSelect: (id: number | null) => void;
  }) => (
    <button
      data-testid="stub-pick-partner"
      data-selected={String(props.selectedPartnerId)}
      onClick={() => props.onSelect(7)}
    />
  ),
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

/** Last props the (open) PaymentSheet received. */
const sheet: {
  items?: PaymentSheetItem[] | undefined;
  totals?: Array<{ amount: number; currency: string }> | undefined;
  totalAmount?: number;
} = {};
jest.mock("../PaymentSheet", () => ({
  PaymentSheet: (props: {
    open: boolean;
    items?: PaymentSheetItem[];
    totals?: Array<{ amount: number; currency: string }>;
    totalAmount: number;
    totalAmountCurrency?: string;
    onPaymentChange: (lines: unknown[]) => void;
    onConfirm: () => void;
  }) => {
    if (!props.open) return null;
    sheet.items = props.items;
    sheet.totals = props.totals;
    sheet.totalAmount = props.totalAmount;
    return (
      <div data-testid="stub-payment-sheet">
        <button
          data-testid="stub-pay-cash"
          onClick={() =>
            props.onPaymentChange([
              {
                id: "L1",
                method: "CASH",
                currencyCode: props.totalAmountCurrency ?? "LBP",
                amount: props.totalAmount,
              },
            ])
          }
        />
        <button data-testid="stub-confirm" onClick={props.onConfirm} />
      </div>
    );
  },
}));

// ── Fixtures ────────────────────────────────────────────────────────────────

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
const WHISH_ITEM: ServiceItem = {
  key: "WHISH_APP/Gaming/PlayStation LEB/PSN $10 - LEBANON",
  provider: "WHISH_APP",
  category: "Gaming",
  subcategory: "PlayStation LEB",
  label: "PSN $10 - LEBANON",
  catalogCost: 897_000,
  catalogSellPrice: 900_000,
  sortOrder: 0,
};

function config(key: "Katsh" | "iPick" | "WHISH_APP"): ProviderConfig {
  return {
    key,
    label: key === "WHISH_APP" ? "Whish App" : key,
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
        : p === "WHISH_APP"
          ? [WHISH_ITEM]
          : [];

type Tab = "Katsh" | "iPick" | "WHISH_APP";

/** The provider tabs' count pills (the page reads the same hook). */
function Counts() {
  const counts = useRechargeBasketCounts();
  return <div data-testid="tab-counts">{JSON.stringify(counts)}</div>;
}

/** The Recharge page's shape: KatshForm stays mounted across Katsh ↔ iPick,
 *  Whish App swaps in FinancialForm (KatshForm unmounts). */
function Page({ withProvider = true }: { withProvider?: boolean }) {
  const [tab, setTab] = useState<Tab>("Katsh");
  const body = (
    <>
      <button onClick={() => setTab("Katsh")}>tab-Katsh</button>
      <button onClick={() => setTab("iPick")}>tab-iPick</button>
      <button onClick={() => setTab("WHISH_APP")}>tab-WHISH_APP</button>
      {withProvider && <Counts />}
      {tab === "WHISH_APP" ? (
        <FinancialForm
          activeConfig={config("WHISH_APP")}
          finTransactions={[]}
          activeProvider="WHISH_APP"
          getCategoriesForProvider={() => ["Gaming"]}
          getServiceItems={catalogItems}
          methods={[{ code: "CASH", label: "Cash" }]}
          drawerAffectingMethods={[{ code: "CASH", label: "Cash" }]}
          clientName=""
          setClientName={jest.fn()}
          loadFinancialData={jest.fn()}
          formatAmount={(v) => v.toLocaleString()}
          showHistory={false}
          setShowHistory={jest.fn()}
        />
      ) : (
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
      )}
    </>
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>
      {withProvider ? (
        <RechargeBasketProvider>{body}</RechargeBasketProvider>
      ) : (
        body
      )}
    </QueryClientProvider>
  );
}

async function pick(label: string) {
  fireEvent.click((await screen.findAllByText(label))[0]!);
}
function go(tab: Tab) {
  fireEvent.click(screen.getByText(`tab-${tab}`));
}

type Entry = {
  module: RechargeBasketModule;
  amount: number;
  currency: string;
  formData: { _batch: boolean; items: Array<Record<string, unknown>> };
};

describe("Mobile Recharge basket across providers (LIRA-326)", () => {
  beforeEach(() => {
    mockAddOMTTransaction.mockClear();
    mockRechargeBasketCheckout.mockClear();
    mockRechargePartnerOrder.mockClear();
    mockAddToCart.mockClear();
    mockSession.activeSession = null;
    delete sheet.items;
    delete sheet.totals;
  });

  it("keeps picks when switching Katsh → Whish App → back", async () => {
    render(<Page />);
    await pick("60 UC");
    expect(await screen.findByText("1 items")).toBeInTheDocument();

    go("WHISH_APP");
    await pick("PSN $10 - LEBANON");
    expect(await screen.findByText("1 items")).toBeInTheDocument();

    go("Katsh");
    // The Katsh pick is still there (and still counts on its own tab).
    expect(await screen.findByText("1 items")).toBeInTheDocument();
  });

  it("pays a Katsh + Whish App basket ONCE: one entry per provider, schema-parsed", async () => {
    render(<Page />);
    await pick("60 UC");
    go("WHISH_APP");
    await pick("PSN $10 - LEBANON");
    go("Katsh");
    await screen.findByText("1 items");

    fireEvent.click(screen.getByRole("button", { name: /Proceed to Pay/i }));
    await screen.findByTestId("stub-payment-sheet");
    // The window lists BOTH providers' items.
    expect(sheet.items?.map((i) => i.key).sort()).toEqual(
      [KATSH_ITEM.key, WHISH_ITEM.key].sort(),
    );
    expect(sheet.totalAmount).toBe(990_000);

    fireEvent.click(screen.getByTestId("stub-pay-cash"));
    fireEvent.click(screen.getByTestId("stub-confirm"));
    await waitFor(() =>
      expect(mockRechargeBasketCheckout).toHaveBeenCalledTimes(1),
    );
    expect(mockAddOMTTransaction).not.toHaveBeenCalled();

    const parsed = rechargeBasketCheckoutSchema
      .strict()
      .parse(mockRechargeBasketCheckout.mock.calls[0]![0]);
    const entries = parsed.cartItems as Entry[];
    expect(entries.map((e) => e.module).sort()).toEqual(["katsh", "whish_app"]);
    for (const e of entries) {
      expect(e.formData._batch).toBe(true);
      for (const s of e.formData.items)
        expect(s.provider).toBe(RECHARGE_BASKET_MODULE_PROVIDER[e.module]);
    }
    expect(parsed.userId).toBe(5);

    // Paid: the whole basket is emptied, on every tab.
    await waitFor(() => expect(screen.queryByText("1 items")).toBeNull());
    go("WHISH_APP");
    await screen.findByText("PSN $10 - LEBANON");
    expect(screen.queryByText("1 items")).toBeNull();
  });

  // ── LIRA-327: bills live in the basket ────────────────────────────────

  async function addBill(amount: string) {
    const input = (await screen.findAllByPlaceholderText("0"))[0]!;
    fireEvent.change(input, { target: { value: amount } });
    fireEvent.click(screen.getByRole("button", { name: /^Add Bill$/ }));
  }

  it("a bill added on Katsh and paid from the iPick tab is booked under Katsh", async () => {
    render(<Page />);
    await screen.findAllByText("60 UC");
    await addBill("50000");
    await screen.findByText(/Pending:/);

    go("iPick");
    await screen.findAllByText("100 Diamonds");
    fireEvent.click(screen.getByRole("button", { name: /Proceed to Pay/i }));
    await screen.findByTestId("stub-payment-sheet");
    expect(sheet.items?.map((i) => [i.name, i.provider])).toEqual([
      ["Bill", "KATSH"],
    ]);
    fireEvent.click(screen.getByTestId("stub-pay-cash"));
    fireEvent.click(screen.getByTestId("stub-confirm"));
    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    expect(mockAddOMTTransaction.mock.calls[0]![0]).toMatchObject({
      provider: "Katsh",
      serviceType: "BILL",
      amount: 50_000,
      currency: "LBP",
    });
  });

  it("a bill survives switching to Whish App and back, and counts on its own tab", async () => {
    render(<Page />);
    await screen.findAllByText("60 UC");
    await addBill("50000");
    await screen.findByText(/Pending:/);

    go("WHISH_APP");
    await screen.findByText("PSN $10 - LEBANON");
    expect(JSON.parse(screen.getByTestId("tab-counts").textContent!)).toEqual({
      Katsh: 1,
    });

    go("Katsh");
    expect(await screen.findByText(/Pending: 50,000 LBP/)).toBeInTheDocument();
  });

  it("pays a Katsh bill + a Whish App card ONCE: the bill rides as its own Katsh BILL entry", async () => {
    render(<Page />);
    go("WHISH_APP");
    await pick("PSN $10 - LEBANON");
    go("Katsh");
    await screen.findAllByText("60 UC");
    await addBill("50000");
    await screen.findByText(/Pending:/);

    // Paid from the Whish App tab: the window lists the bill under Katsh.
    go("WHISH_APP");
    await screen.findByText("PSN $10 - LEBANON");
    fireEvent.click(screen.getByRole("button", { name: /Proceed to Pay/i }));
    await screen.findByTestId("stub-payment-sheet");
    expect(sheet.items?.map((i) => [i.name, i.provider]).sort()).toEqual(
      [
        ["Bill", "KATSH"],
        [WHISH_ITEM.label, "WHISH"],
      ].sort(),
    );
    expect(sheet.totalAmount).toBe(950_000);

    fireEvent.click(screen.getByTestId("stub-pay-cash"));
    fireEvent.click(screen.getByTestId("stub-confirm"));
    await waitFor(() =>
      expect(mockRechargeBasketCheckout).toHaveBeenCalledTimes(1),
    );
    expect(mockAddOMTTransaction).not.toHaveBeenCalled();

    const parsed = rechargeBasketCheckoutSchema
      .strict()
      .parse(mockRechargeBasketCheckout.mock.calls[0]![0]);
    const entries = parsed.cartItems as Array<{
      module: string;
      amount: number;
      currency: string;
      formData: Record<string, unknown>;
    }>;
    const bill = entries.find((e) => e.formData.serviceType === "BILL");
    expect(bill).toMatchObject({
      module: "katsh",
      amount: 50_000,
      currency: "LBP",
      formData: {
        provider: "Katsh",
        serviceType: "BILL",
        amount: 50_000,
        cost: 50_000,
        price: 50_000,
        currency: "LBP",
        commission: 0,
      },
    });
    expect(bill!.formData._batch).toBeUndefined();
    expect(entries.filter((e) => e !== bill).map((e) => e.module)).toEqual([
      "whish_app",
    ]);

    // Paid: the bill is gone too.
    await waitFor(() =>
      expect(JSON.parse(screen.getByTestId("tab-counts").textContent!)).toEqual(
        {},
      ),
    );
  });

  // ── LIRA-327: For Partner is basket-wide ───────────────────────────────

  it("For Partner turned on in Katsh stays on in Whish App, after a confirm; one submit books every provider", async () => {
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
    render(<Page />);
    await pick("60 UC");
    go("WHISH_APP");
    await pick("PSN $10 - LEBANON");
    go("Katsh");
    await screen.findAllByText("60 UC");

    fireEvent.click(screen.getByTestId("katsh-for-partner-toggle"));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy.mock.calls[0]![0]).toMatch(/Make all 2 items/);
    fireEvent.click(screen.getByTestId("stub-pick-partner"));

    go("WHISH_APP");
    await screen.findByText("PSN $10 - LEBANON");
    expect(screen.getByTestId("financial-for-partner-toggle")).toBeChecked();
    expect(screen.getByTestId("stub-pick-partner").dataset.selected).toBe("7");

    fireEvent.click(screen.getByRole("button", { name: /Submit to Partner/i }));
    await waitFor(() =>
      expect(mockRechargePartnerOrder).toHaveBeenCalledTimes(1),
    );
    expect(mockAddOMTTransaction).not.toHaveBeenCalled();
    const order = rechargePartnerOrderSchema
      .strict()
      .parse(mockRechargePartnerOrder.mock.calls[0]![0]);
    expect(order.partnerId).toBe(7);
    expect(order.userId).toBe(5);
    expect(
      order.sales.map((s) => [s.provider, s.serviceType, s.amount, s.cost]),
    ).toEqual([
      ["Katsh", "SEND", 90_000, 82_340],
      ["WHISH_APP", "SEND", 900_000, 897_000],
    ]);
    for (const sale of order.sales) {
      expect(sale.payments).toEqual([]);
      expect(sale.partnerId).toBeUndefined();
    }

    // Submitted: the basket is empty and For Partner is off again.
    await waitFor(() =>
      expect(
        screen.getByTestId("financial-for-partner-toggle"),
      ).not.toBeChecked(),
    );
    expect(JSON.parse(screen.getByTestId("tab-counts").textContent!)).toEqual(
      {},
    );
    confirmSpy.mockRestore();
  });

  it("cancelling the confirm leaves For Partner off; an empty basket needs no confirm", async () => {
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(false);
    render(<Page />);
    await screen.findAllByText("60 UC");
    // Empty basket: no question asked.
    fireEvent.click(screen.getByTestId("katsh-for-partner-toggle"));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId("katsh-for-partner-toggle")).toBeChecked();
    fireEvent.click(screen.getByTestId("katsh-for-partner-toggle"));

    await pick("60 UC");
    fireEvent.click(screen.getByTestId("katsh-for-partner-toggle"));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("katsh-for-partner-toggle")).not.toBeChecked();
    confirmSpy.mockRestore();
  });
});
