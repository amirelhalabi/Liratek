/** @jest-environment jsdom */

/**
 * LIRA-331 (T049-sessions) — the language guard for the session money paths.
 *
 * Switching the app to Arabic must change what the cashier READS, never what
 * is SENT. Each case below builds the payload through the real screen —
 * SessionCheckoutModal for every payment mode it offers (cash, split,
 * customer account, wallet, overpay with change, a payout routed to a
 * wallet, a per-item discount; the Binance cart items go through the real
 * `utils/binanceCart.ts` split inside the modal) and StartSessionModal (with
 * and without a phone) — once in English and once in Arabic, and the two
 * captured payloads must be deep-equal.
 *
 * Not failing-first (guard against future drift): written before the module
 * was converted, and it passed then, as it must.
 */
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { i18n } from "@/i18n/setup";
import { SessionCheckoutModal } from "../SessionCheckoutModal";
import { StartSessionModal } from "../StartSessionModal";
import type { CartItem } from "../../types/cart";

// ── shared mocks ────────────────────────────────────────────────────────────

interface StubLine {
  id: string;
  method: string;
  currencyCode: string;
  amount: number;
}
interface StubTotal {
  amount: number;
  currency: string;
}

const mockCheckout = jest.fn();
const mockStartSession = jest.fn();
const mockGetActiveSessions = jest.fn();

// rule 25: one stable identity for the whole file.
const mockApi = {
  session: {
    checkout: mockCheckout,
    getActiveSessions: mockGetActiveSessions,
  },
  getAllSettings: jest.fn().mockResolvedValue([]),
  getClients: jest.fn().mockResolvedValue([]),
};

let mockActiveSession: {
  id: number;
  customer_name?: string | undefined;
  customer_phone?: string | undefined;
  started_at: string;
  started_by: string;
  is_active: 1;
} | null = null;
let mockCartItems: CartItem[] = [];

/** What the stub payment input reports when "apply" is clicked. */
type PaymentMode = "cash" | "split" | "account" | "wallet" | "overpay" | "none";
let mockPaymentMode: PaymentMode = "cash";

function cartTotalsOf(items: CartItem[]) {
  return items.reduce(
    (totals, item) => {
      if (item.currency === "USD") totals.usd += item.amount;
      else if (item.currency === "LBP") totals.lbp += item.amount;
      else if (item.currency === "USDT") totals.usdt += item.amount;
      return totals;
    },
    { usd: 0, lbp: 0, usdt: 0 },
  );
}

const mockSessionValue = {
  get activeSession() {
    return mockActiveSession;
  },
  get cartItems() {
    return mockCartItems;
  },
  clearCart: jest.fn(),
  getCartTotals: () => cartTotalsOf(mockCartItems),
  refreshActiveSessions: jest.fn().mockResolvedValue(undefined),
  startSession: mockStartSession,
};

jest.mock("../../context/SessionContext", () => ({
  useSession: () => mockSessionValue,
}));

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
  // Stub: reports the lines of `mockPaymentMode` against the totals the real
  // modal hands it, through the real onChange / onReturnChange props.
  MultiPaymentInput: (props: Record<string, unknown>) => {
    const totals = (props.totals as StubTotal[]) ?? [];
    const onChange = props.onChange as (lines: StubLine[]) => void;
    const onReturnChange = props.onReturnChange as (lines: StubLine[]) => void;
    const apply = () => {
      const usd = totals.find((t) => t.currency === "USD")?.amount ?? 0;
      const lbp = totals.find((t) => t.currency === "LBP")?.amount ?? 0;
      const lines: StubLine[] = [];
      const returns: StubLine[] = [];
      const add = (method: string, currencyCode: string, amount: number) =>
        amount > 0 &&
        lines.push({ id: `l${lines.length}`, method, currencyCode, amount });
      if (mockPaymentMode === "cash") {
        add("CASH", "USD", usd);
        add("CASH", "LBP", lbp);
      } else if (mockPaymentMode === "split") {
        add("CASH", "USD", usd - 10);
        add("OMT", "USD", 10);
        add("CASH", "LBP", lbp);
      } else if (mockPaymentMode === "account") {
        add("CUSTOMER_ACCOUNT", "USD", usd);
        add("CUSTOMER_ACCOUNT", "LBP", lbp);
      } else if (mockPaymentMode === "wallet") {
        add("WHISH", "USD", usd);
        add("WHISH", "LBP", lbp);
      } else if (mockPaymentMode === "overpay") {
        add("CASH", "USD", usd + 5);
        add("CASH", "LBP", lbp);
        returns.push({
          id: "r0",
          method: "CASH",
          currencyCode: "USD",
          amount: 5,
        });
      }
      onChange(lines);
      onReturnChange(returns);
    };
    return (
      <button type="button" data-testid="stub-apply-payment" onClick={apply}>
        apply
      </button>
    );
  },
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, username: "tester", role: "admin" } }),
}));

const mockMethods = [
  { code: "CASH", label: "Cash" },
  { code: "OMT", label: "OMT Wallet" },
  { code: "WHISH", label: "Whish Wallet" },
  { code: "BINANCE", label: "Binance" },
  { code: "CUSTOMER_ACCOUNT", label: "Customer Account" },
];
const mockPaymentMethods = {
  methods: mockMethods,
  drawerAffectingMethods: [],
  allMethods: mockMethods,
  loading: false,
  refresh: jest.fn(),
};
jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => mockPaymentMethods,
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 89500, buyRate: 89000, isLoading: false }),
}));

jest.mock("@/hooks/useShopName", () => ({
  useShopInfo: () => ({ name: "Test Shop", phone: "", location: "", logo: "" }),
}));

jest.mock("@/shared/hooks/useModalFocusFix", () => ({
  useModalFocusFix: () => {},
}));

jest.mock("@/shared/utils/clientVouchers", () => ({
  fetchClientVouchers: jest.fn().mockResolvedValue([]),
}));

jest.mock("@/shared/utils/printReceipt", () => ({
  printReceipt: jest.fn().mockResolvedValue(undefined),
}));

// A plain input in place of the autocomplete (its own data loading is not
// part of the session payload).
jest.mock("@/shared/components/ClientAutocompleteInput", () => ({
  ClientAutocompleteInput: (props: {
    id?: string;
    value: string;
    onChange: (v: string) => void;
  }) => (
    <input
      id={props.id}
      data-testid="stub-customer-name"
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
    />
  ),
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

// ── fixtures ────────────────────────────────────────────────────────────────

const SESSION_WITH_PHONE = {
  id: 7,
  customer_name: "Rami Haddad",
  customer_phone: "03123456",
  started_at: "2026-10-17T08:00:00.000Z",
  started_by: "tester",
  is_active: 1 as const,
};

const CHARGE_CART: CartItem[] = [
  {
    id: "pos-1",
    module: "pos",
    label: "POS Sale (2 items)",
    amount: 33,
    currency: "USD",
    formData: {},
    ipcChannel: "sales:process",
  },
  {
    id: "omt-1",
    module: "omt_system",
    label: "OMT SEND",
    amount: 101,
    currency: "USD",
    formData: { commission: 2 },
    ipcChannel: "financial:create",
  },
  {
    id: "mtc-1",
    module: "recharge_mtc",
    label: "MTC Recharge 03123456",
    amount: 450000,
    currency: "LBP",
    formData: { commission: 50000 },
    ipcChannel: "recharge:process",
  },
  {
    id: "bin-send",
    module: "binance_send",
    label: "Binance Send 20 USDT",
    amount: 21,
    currency: "USDT",
    formData: { commission: 1 },
    ipcChannel: "binance:send",
  },
];

const PAYOUT_CART: CartItem[] = [
  {
    id: "pos-2",
    module: "pos",
    label: "POS Sale (1 item)",
    amount: 20,
    currency: "USD",
    formData: {},
    ipcChannel: "sales:process",
  },
  {
    id: "bin-recv",
    module: "binance_receive",
    label: "Binance Receive 50 USDT",
    amount: -49,
    currency: "USDT",
    formData: { commission: 1 },
    ipcChannel: "binance:receive",
  },
];

// ── helpers ─────────────────────────────────────────────────────────────────

async function switchToArabic() {
  const { loadLanguage } = await import("@/i18n/setup");
  await loadLanguage("ar");
  await i18n.changeLanguage("ar");
  expect(i18n.t("sessions:page.title")).toBe("جلسات الزبائن");
}

interface CheckoutCase {
  name: string;
  cart: CartItem[];
  mode: PaymentMode;
  discount?: string;
  payoutUsd?: string;
  /** A leg (method + direction) the mode must produce. */
  expectLeg: { method: string; direction: "IN" | "OUT" };
}

async function captureCheckout(c: CheckoutCase): Promise<unknown> {
  mockCheckout.mockReset();
  mockCheckout.mockResolvedValue({ success: true, itemCount: c.cart.length });
  mockActiveSession = SESSION_WITH_PHONE;
  mockCartItems = c.cart;
  mockPaymentMode = c.mode;

  const { container } = render(
    <SessionCheckoutModal isOpen={true} onClose={() => {}} />,
  );
  // Let the client-lookup effect settle.
  await waitFor(() => expect(mockApi.getClients).toHaveBeenCalled());

  if (c.discount) {
    const discountInput = container.querySelector(
      'input[placeholder="0"]',
    ) as HTMLInputElement;
    fireEvent.change(discountInput, { target: { value: c.discount } });
  }
  if (c.payoutUsd) {
    fireEvent.change(screen.getByTestId("payout-method-select-USD"), {
      target: { value: c.payoutUsd },
    });
  }
  if (c.mode !== "none") {
    fireEvent.click(await screen.findByTestId("stub-apply-payment"));
  }

  const confirm = screen.getByTestId("session-checkout-confirm");
  await waitFor(() => expect(confirm).not.toBeDisabled());
  fireEvent.click(confirm);
  await waitFor(() => expect(mockCheckout).toHaveBeenCalledTimes(1));
  const payload = mockCheckout.mock.calls[0][0];
  cleanup();
  return payload;
}

async function captureStart(
  name: string,
  phone: string,
  notes: string,
): Promise<unknown> {
  mockStartSession.mockReset();
  mockStartSession.mockResolvedValue(undefined);
  mockGetActiveSessions.mockResolvedValue({ success: true, sessions: [] });

  const { container } = render(
    <StartSessionModal isOpen={true} onClose={() => {}} />,
  );
  await waitFor(() => expect(mockGetActiveSessions).toHaveBeenCalled());
  fireEvent.change(screen.getByTestId("stub-customer-name"), {
    target: { value: name },
  });
  fireEvent.change(container.querySelector("#customer-phone") as Element, {
    target: { value: phone },
  });
  fireEvent.change(container.querySelector("#customer-notes") as Element, {
    target: { value: notes },
  });
  const submit = container.querySelector(
    'button[type="submit"]',
  ) as HTMLButtonElement;
  await waitFor(() => expect(submit).not.toBeDisabled());
  fireEvent.submit(container.querySelector("form") as HTMLFormElement);
  await waitFor(() => expect(mockStartSession).toHaveBeenCalledTimes(1));
  const payload = mockStartSession.mock.calls[0][0];
  cleanup();
  return payload;
}

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("en");
});

// ── tests ───────────────────────────────────────────────────────────────────

const CHECKOUT_CASES: CheckoutCase[] = [
  {
    name: "cash",
    cart: CHARGE_CART,
    mode: "cash",
    expectLeg: { method: "CASH", direction: "IN" },
  },
  {
    name: "split (cash + OMT wallet + LBP cash)",
    cart: CHARGE_CART,
    mode: "split",
    expectLeg: { method: "OMT", direction: "IN" },
  },
  {
    name: "customer account (debt)",
    cart: CHARGE_CART,
    mode: "account",
    expectLeg: { method: "CUSTOMER_ACCOUNT", direction: "IN" },
  },
  {
    name: "wallet (Whish)",
    cart: CHARGE_CART,
    mode: "wallet",
    expectLeg: { method: "WHISH", direction: "IN" },
  },
  {
    name: "overpay with change handed back",
    cart: CHARGE_CART,
    mode: "overpay",
    expectLeg: { method: "CASH", direction: "OUT" },
  },
  {
    name: "per-item discount",
    cart: CHARGE_CART,
    mode: "cash",
    discount: "1",
    expectLeg: { method: "CASH", direction: "IN" },
  },
  {
    name: "Binance cash-out payout routed to Whish wallet",
    cart: PAYOUT_CART,
    mode: "cash",
    payoutUsd: "WHISH",
    expectLeg: { method: "WHISH", direction: "OUT" },
  },
  {
    name: "Binance cash-out netted against the charge (nothing to collect)",
    cart: PAYOUT_CART,
    mode: "none",
    expectLeg: { method: "CASH", direction: "OUT" },
  },
];

describe("sessions payloads do not depend on the display language", () => {
  it.each(CHECKOUT_CASES)("checkout — $name", async (c) => {
    await i18n.changeLanguage("en");
    const en = await captureCheckout(c);
    await switchToArabic();
    const ar = await captureCheckout(c);
    expect(ar).toEqual(en);
    // The case really exercised its mode.
    const sent = en as {
      payments: Array<{ method: string; direction: string }>;
      cartItems: Array<{ id: string; formData: Record<string, unknown> }>;
    };
    expect(sent.payments).toContainEqual(expect.objectContaining(c.expectLeg));
    if (c.discount) {
      // The discount input is the first one rendered (the OMT SEND item).
      expect(
        sent.cartItems.find((i) => i.id === "omt-1")?.formData.commission,
      ).toBe(1);
    }
  });

  it("start session — name, phone and notes", async () => {
    await i18n.changeLanguage("en");
    const en = await captureStart("Rami Haddad", "03123456", "Regular");
    await switchToArabic();
    const ar = await captureStart("Rami Haddad", "03123456", "Regular");
    expect(ar).toEqual(en);
    expect(en).toEqual({
      customer_name: "Rami Haddad",
      customer_phone: "03123456",
      customer_notes: "Regular",
    });
  });

  it("start session — name only (no phone, no notes)", async () => {
    await i18n.changeLanguage("en");
    const en = await captureStart("Walk-in Ali", "", "");
    await switchToArabic();
    const ar = await captureStart("Walk-in Ali", "", "");
    expect(ar).toEqual(en);
    expect(en).toEqual({ customer_name: "Walk-in Ali" });
  });
});
