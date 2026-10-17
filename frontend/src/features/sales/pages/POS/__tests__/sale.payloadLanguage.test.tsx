/** @jest-environment jsdom */

/**
 * LIRA-331 (T043, research R9): the POS sends the SAME payload in English and
 * in Arabic. Translation must never reach a payload field (a client name, a
 * session-cart label, a method code), an option value or a comparison.
 *
 * Every mode the page books is walked (rule 28d): a walk-in paid in USD with
 * the change handed back in LBP, an exact sale with a discount, an extra
 * charge, a picked client with the rest on their account (debt sale), a new
 * client typed by name and phone, a phone-only customer, a partner sale, a
 * saved draft, and Add to Session Cart (the session payload is built on the
 * POS page itself, not in the checkout). Each scenario runs at `en` and at
 * `ar` through the real POS page and the real CheckoutModal +
 * MultiPaymentInput; only test ids drive it, never English text. The two
 * captured payloads must be deep-equal, and every completed sale is parsed
 * through the core schema (rule 24).
 *
 * Product search and the cart panel are stubbed (they hold no payload code:
 * POS builds the items with `toSaleItems`), as in POS.sessionCartBuyRate.
 *
 * Rule 17: not failing-first (guard against future drift).
 * Rule 25: `mockApi` is a stable module-level object.
 */

import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { saleProcessSchema } from "@liratek/core";
import { i18n, loadLanguage } from "@/i18n/setup";
import POS from "../index";

const mockProcessSale = jest.fn();
const mockApi = {
  getDrafts: jest.fn().mockResolvedValue([]),
  getClients: jest.fn(),
  getAllSettings: jest.fn().mockResolvedValue([]),
  getRates: jest.fn().mockResolvedValue([]),
  processSale: mockProcessSale,
  deleteDraft: jest.fn().mockResolvedValue({ success: true }),
};
jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return { ...actual, useApi: () => mockApi };
});

const mockAddToSessionCart = jest.fn();
const mockSession: {
  activeSession: null | {
    id: number;
    customer_name: string;
    customer_phone: string;
  };
  linkTransaction: jest.Mock;
  addToCart: jest.Mock;
} = {
  activeSession: null,
  linkTransaction: jest.fn(),
  addToCart: mockAddToSessionCart,
};
jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => mockSession,
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 90_000, buyRate: 89_000, isLoading: false }),
}));
jest.mock("@/shared/utils/localDay", () => ({
  localDay: () => "2026-10-17",
}));
jest.mock("@/features/sales/hooks/useCategoryWarrantyDefaults", () => ({
  useCategorySerialLabels: () => () => "IMEI",
}));

const mockMethods = [
  {
    id: 1,
    code: "CASH",
    label: "Cash",
    drawer_name: "General",
    affects_drawer: 1,
    is_active: 1,
  },
  {
    id: 2,
    code: "CUSTOMER_ACCOUNT",
    label: "Customer Account",
    drawer_name: "General",
    affects_drawer: 0,
    is_active: 1,
  },
];
jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: mockMethods,
    drawerAffectingMethods: mockMethods.filter((m) => m.affects_drawer === 1),
    allMethods: mockMethods,
    loading: false,
    refresh: jest.fn(),
  }),
}));
jest.mock("@/hooks/useShopName", () => ({
  useShopInfo: () => ({ name: "Shop", phone: "", location: "", logo: "" }),
}));

jest.mock("@/features/partners/components/ForPartnerToggle", () => ({
  ForPartnerToggle: (props: {
    checked: boolean;
    onChange: (v: boolean) => void;
    onPartnerChange: (id: number | null) => void;
    testId: string;
  }) => (
    <div>
      <input
        type="checkbox"
        data-testid={props.testId}
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      <button
        data-testid="stub-pick-partner"
        onClick={() => props.onPartnerChange(7)}
      />
    </div>
  ),
  ForPartnerNotice: () => null,
}));

jest.mock("../components/ProductSearch", () => ({
  __esModule: true,
  default: (props: {
    onAddToCart: (p: Record<string, unknown>) => Promise<boolean>;
  }) => (
    <button
      data-testid="stub-add-product"
      onClick={() =>
        void props.onAddToCart({
          id: 7,
          name: "Charger",
          barcode: "CHG-7",
          category: "Accessories",
          retail_price: 14,
          tracks_imei_units: 0,
        })
      }
    />
  ),
}));
jest.mock("../components/Cart", () => ({
  __esModule: true,
  default: (props: {
    items: unknown[];
    onCheckout: () => void;
    onAddToSessionCart: () => void;
  }) => (
    <div>
      <span data-testid="stub-cart-count">{props.items.length}</span>
      <button data-testid="stub-checkout" onClick={props.onCheckout} />
      <button
        data-testid="stub-add-session"
        onClick={props.onAddToSessionCart}
      />
    </div>
  ),
}));
jest.mock("../components/SaleDetailModal", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("../components/SaleCompletedStrip", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/features/inventory/pages/Inventory/ProductForm", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/shared/components/TransactionTimeOverride", () => ({
  TransactionTimeOverride: () => null,
}));
jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

const CLIENT = {
  id: 42,
  full_name: "Rami Haddad",
  phone_number: "70123456",
  notes: null,
  whatsapp_opt_in: 0,
  created_at: "2026-10-01 10:00:00",
};

type Lang = "en" | "ar";

async function setLang(lang: Lang) {
  if (lang === "ar") await loadLanguage("ar");
  await i18n.changeLanguage(lang);
}

async function renderPos() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <POS />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(mockApi.getDrafts).toHaveBeenCalled());
  fireEvent.click(screen.getByTestId("stub-add-product"));
  await waitFor(() =>
    expect(screen.getByTestId("stub-cart-count")).toHaveTextContent("1"),
  );
}

async function openCheckout() {
  await renderPos();
  fireEvent.click(screen.getByTestId("stub-checkout"));
  await screen.findByTestId("checkout-modal");
}

async function firstLine(): Promise<{
  amount: HTMLInputElement;
  method: HTMLSelectElement | null;
}> {
  const amount = await waitFor(() => {
    const el = document.querySelector<HTMLInputElement>(
      '[data-testid^="payment-amount-"]',
    );
    if (!el) throw new Error("no payment-amount input rendered");
    return el;
  });
  const method = document.querySelector<HTMLSelectElement>(
    'select[data-testid^="payment-method-"]',
  );
  return { amount, method };
}

async function payCash(value: string) {
  const { amount, method } = await firstLine();
  if (method && method.value !== "CASH") {
    fireEvent.change(method, { target: { value: "CASH" } });
  }
  fireEvent.change(amount, { target: { value } });
}

function complete() {
  fireEvent.click(screen.getByTestId("checkout-complete-btn"));
}

async function typeCustomer(primary: string, secondary?: string) {
  const field = screen.getByTestId("client-autocomplete-field");
  fireEvent.change(field, { target: { value: primary } });
  if (secondary !== undefined) {
    const inputs = screen
      .getByTestId("checkout-modal")
      .querySelectorAll<HTMLInputElement>('input[type="text"]');
    // The second text input in the customer grid is the name/phone partner.
    fireEvent.change(inputs[1]!, { target: { value: secondary } });
  }
}

interface Scenario {
  name: string;
  /** Which call the payload is captured from. */
  capture: "processSale" | "session";
  /** Payload is a completed sale (parsed through the core schema). */
  completed?: boolean;
  session?: boolean;
  run: () => Promise<void>;
  /** Proves the scenario reached the mode it names. */
  check: (p: Payload) => void;
}

type Payload = Record<string, unknown> & {
  payments?: Array<Record<string, unknown>>;
};
const hasLeg = (p: Payload, method: string) =>
  (p.payments ?? []).some((l) => l.method === method);

const SCENARIOS: Scenario[] = [
  {
    name: "walk-in, $30 USD cash on $14, change handed back in LBP",
    capture: "processSale",
    completed: true,
    run: async () => {
      await openCheckout();
      await payCash("30");
      await screen.findByTestId("return-change");
      fireEvent.click(screen.getByTestId("return-all-lbp"));
      complete();
    },
    check: (p) => {
      expect(p.change_given_lbp).toBeGreaterThan(0);
      expect(p.change_given_usd).toBe(0);
    },
  },
  {
    name: "walk-in, exact cash after a $2 discount",
    capture: "processSale",
    completed: true,
    run: async () => {
      await openCheckout();
      fireEvent.change(screen.getByTestId("checkout-discount-input"), {
        target: { value: "2" },
      });
      await payCash("12");
      complete();
    },
    check: (p) => {
      expect(p.discount).toBe(2);
      expect(p.final_amount).toBe(12);
    },
  },
  {
    name: "an extra charge of $1 on the Discount line",
    capture: "processSale",
    completed: true,
    run: async () => {
      await openCheckout();
      fireEvent.click(screen.getByTestId("discount-mode-extra"));
      fireEvent.change(screen.getByTestId("checkout-discount-input"), {
        target: { value: "1" },
      });
      await payCash("15");
      complete();
    },
    check: (p) => {
      expect(p.extra_usd).toBe(1);
    },
  },
  {
    name: "debt sale: picked client, $5 cash, the rest on their account",
    capture: "processSale",
    completed: true,
    run: async () => {
      await openCheckout();
      await typeCustomer("Rami");
      fireEvent.click(await screen.findByTestId("client-option-42"));
      await payCash("5");
      complete();
    },
    check: (p) => {
      expect(p.client_id).toBe(42);
      expect(hasLeg(p, "CUSTOMER_ACCOUNT")).toBe(true);
    },
  },
  {
    name: "new client typed by name and phone, part paid",
    capture: "processSale",
    completed: true,
    run: async () => {
      await openCheckout();
      await typeCustomer("Nour Saad", "71999888");
      await payCash("4");
      complete();
    },
    check: (p) => {
      expect(p.client_name).toBe("Nour Saad");
      expect(p.client_phone).toBe("71999888");
      expect(hasLeg(p, "CUSTOMER_ACCOUNT")).toBe(true);
    },
  },
  {
    name: "phone-only customer (no name typed), paid in full",
    capture: "processSale",
    completed: true,
    run: async () => {
      await openCheckout();
      await typeCustomer("03555666");
      await payCash("14");
      complete();
    },
    check: (p) => {
      expect(p.client_phone).toBe("03555666");
      // A stored fallback name stays English data in both languages.
      expect(p.client_name).toBe("Client 03555666");
    },
  },
  {
    name: "partner sale (nothing collected)",
    capture: "processSale",
    completed: true,
    run: async () => {
      await openCheckout();
      fireEvent.click(screen.getByTestId("checkout-for-partner-toggle"));
      fireEvent.click(screen.getByTestId("stub-pick-partner"));
      complete();
    },
    check: (p) => {
      expect(p.partnerId).toBe(7);
      expect(p.payments).toEqual([]);
    },
  },
  {
    name: "Save Draft",
    capture: "processSale",
    run: async () => {
      await openCheckout();
      await payCash("10");
      fireEvent.click(screen.getByTestId("checkout-save-draft-btn"));
    },
    check: (p) => {
      expect(p.status).toBe("draft");
    },
  },
  {
    name: "Add to Session Cart",
    capture: "session",
    session: true,
    run: async () => {
      await renderPos();
      fireEvent.click(screen.getByTestId("stub-add-session"));
    },
    check: (p) => {
      // The session label is stored data: English in both languages.
      expect(p.label).toBe("POS: Charger x1");
      expect(p.ipcChannel).toBe("sales:process");
    },
  },
];

async function runIn(lang: Lang, scenario: Scenario): Promise<unknown> {
  jest.clearAllMocks();
  mockApi.getDrafts.mockResolvedValue([]);
  mockApi.getClients.mockResolvedValue([CLIENT]);
  mockApi.getAllSettings.mockResolvedValue([]);
  mockApi.getRates.mockResolvedValue([]);
  mockProcessSale.mockResolvedValue({ success: true, id: 501 });
  mockSession.activeSession = scenario.session
    ? { id: 3, customer_name: "Hadi", customer_phone: "76111222" }
    : null;
  localStorage.clear();
  await setLang(lang);
  await scenario.run();
  let raw: unknown;
  if (scenario.capture === "session") {
    await waitFor(() => expect(mockAddToSessionCart).toHaveBeenCalledTimes(1));
    raw = mockAddToSessionCart.mock.calls[0][0];
  } else {
    await waitFor(() => expect(mockProcessSale).toHaveBeenCalledTimes(1));
    raw = mockProcessSale.mock.calls[0][0];
    if (scenario.completed) saleProcessSchema.parse(raw);
  }
  cleanup();
  return raw;
}

describe("POS — the sale payload is the same in English and Arabic (LIRA-331)", () => {
  afterEach(async () => {
    cleanup();
    mockSession.activeSession = null;
    await i18n.changeLanguage("en");
  });

  it.each(SCENARIOS.map((s) => [s.name, s] as const))(
    "%s",
    async (_name, scenario) => {
      const en = await runIn("en", scenario);
      const ar = await runIn("ar", scenario);
      expect(ar).toEqual(en);
      scenario.check(en as Payload);
    },
  );

  it("the ar run really renders Arabic (the comparison is not English vs English)", async () => {
    mockApi.getClients.mockResolvedValue([]);
    await setLang("ar");
    await openCheckout();
    expect(screen.getByTestId("checkout-complete-btn")).not.toHaveTextContent(
      "Complete Sale",
    );
  });
});
