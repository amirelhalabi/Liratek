/**
 * Shop-day 2026-10-16 (session 97, Samir Aoun 70998811): inside a customer
 * session every "Add to Cart" fired POST /api/clients for the session
 * customer — who was registered when the session started — and got a 409
 * DUPLICATE_PHONE each time. The session owns the customer (the server stamps
 * the session client on every basket item at checkout), so adding to the
 * session cart must make NO client-create call.
 *
 * Rule 25: every useApi / useSession mock is ONE module-level object.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
const mockSession = {
  activeSession: {
    id: 97,
    customer_name: "Samir Aoun",
    customer_phone: "70998811",
  },
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

// The REAL ensureRechargeClient runs; only the client-create call it would
// make is replaced, so the test sees whether add-to-cart reaches it.
const mockCreateClient = jest.fn().mockResolvedValue({
  success: false,
  error: "Phone number already registered",
});
jest.mock("@/api/backendApi", () => ({
  ...jest.requireActual("@/api/backendApi"),
  createClient: (...args: unknown[]) => mockCreateClient(...args),
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

describe("KatshForm in a customer session", () => {
  it("adding to the session cart makes no client-create call", async () => {
    render(form("Katsh"));
    fireEvent.click(
      (await screen.findAllByText("60 UC", {}, { timeout: 5000 }))[0]!,
    );
    fireEvent.click(screen.getByRole("button", { name: /Add to Cart/i }));
    await waitFor(() => expect(mockAddToCart).toHaveBeenCalledTimes(1));

    expect(mockCreateClient).not.toHaveBeenCalled();
    // The cart entry carries no client id: checkout stamps the session's.
    const entry = mockAddToCart.mock.calls[0]![0] as {
      module: string;
      formData: { items: Array<Record<string, unknown>> };
    };
    expect(entry.module).toBe("katsh");
    expect(entry.formData.items[0]!.clientId ?? null).toBeNull();
  });
});
