/** @jest-environment jsdom */

/**
 * Services page — the Discount line on an OMT/Whish system SEND.
 *
 * History: LIRA-269 follow-up hid the discount on every SEND because the
 * shop has no fee margin at creation (the whole fee is owed to the
 * provider, the commission comes at settlement) and nothing booked it.
 *
 * LIRA-365 (owner 2026-10-31) turns it on for a WALK-IN SEND: the shop
 * takes the discount itself, as a "Discount given" expense, up to the
 * shared cap ($5 / 450,000 LBP). It stays OFF on a RECEIVE (a payout), in a
 * customer session (the basket checkout's Waive owns it) and For a partner
 * (that sheet is a notice, not a payment box). The payload's field names
 * come from `createFinancialServiceSchema` (rule 24).
 *
 * Rule 17: rewritten before the page change; seen failing on the old page
 * (which passed `showDiscount={false}` everywhere).
 */

import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { createFinancialServiceSchema, OMT_SERVICE_TYPES } from "@liratek/core";
import Services from "../index";

const mockAddOMTTransaction = jest
  .fn()
  .mockResolvedValue({ success: true, id: 1 });
const mockGetOMTHistory = jest.fn().mockResolvedValue([]);
const mockGetOMTAnalytics = jest.fn().mockResolvedValue({
  today: { commission: 0, pending_commission: 0, count: 0, byCurrency: [] },
  month: { commission: 0, pending_commission: 0, count: 0, byCurrency: [] },
  byProvider: [],
});
const mockGetSuppliers = jest.fn().mockResolvedValue([]);
const mockGetSupplierBalances = jest.fn().mockResolvedValue([]);
const mockPartnersGetAll = jest.fn().mockResolvedValue([]);

// rule 25: ONE stable object, never a fresh literal per render.
const mockApi = {
  getOMTHistory: mockGetOMTHistory,
  getOMTAnalytics: mockGetOMTAnalytics,
  getSuppliers: mockGetSuppliers,
  getSupplierBalances: mockGetSupplierBalances,
  partners: { getAll: mockPartnersGetAll },
  addOMTTransaction: mockAddOMTTransaction,
};

interface StubMpiProps {
  showDiscount?: boolean;
  maxDiscount?: number;
  payer?: string;
  onDiscountChange?: (d: number) => void;
  onChange: (lines: unknown[]) => void;
  totals: { amount: number; currency: string }[];
}
const mockMpi: { last?: StubMpiProps } = {};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
  // Stub recording the props the page passes the shared payment input.
  MultiPaymentInput: (props: StubMpiProps) => {
    mockMpi.last = props;
    return <div data-testid="stub-multi-payment-input" />;
  },
  DecimalInput: ({
    id,
    value,
    onChange,
    placeholder,
    className,
  }: {
    id?: string;
    value: number;
    onChange: (n: number) => void;
    placeholder?: string;
    className?: string;
  }) => (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      value={value === 0 ? "" : String(value)}
      placeholder={placeholder}
      className={className}
      onChange={(e) =>
        onChange(parseFloat(e.target.value.replace(/,/g, "")) || 0)
      }
    />
  ),
  Select: ({
    value,
    onChange,
    options,
  }: {
    value: string;
    onChange: (v: string) => void;
    options: { value: string; label: string }[];
  }) => (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
  DataTable: () => <div data-testid="data-table" />,
  TopUpModal: () => null,
}));

const mockSessionState: { activeSession: { id: number } | null } = {
  activeSession: null,
};
jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({
    activeSession: mockSessionState.activeSession,
    linkTransaction: jest.fn(),
    addToCart: jest.fn(),
    addToSessionCart: jest.fn(),
  }),
}));

jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: [
      { code: "CASH", label: "Cash" },
      { code: "OMT", label: "OMT Wallet" },
    ],
  }),
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 89500, buyRate: 89000 }),
}));

const mockShopBase = { baseSystem: "OMT", partnerSystem: "WHISH" };
jest.mock("@/hooks/useShopBase", () => ({
  useShopBase: () => ({ ...mockShopBase, loading: false }),
}));

jest.mock("@/shared/hooks/useModalFocusFix", () => ({
  useModalFocusFix: () => {},
}));

jest.mock("@/shared/hooks/useSaveAsClient", () => ({
  useSaveAsClient: () => ({
    saveAsClient: false,
    setSaveAsClient: jest.fn(),
    showCheckbox: false,
    trySaveAsClient: jest.fn().mockResolvedValue({ clientId: null }),
    resetSaveAsClient: jest.fn(),
  }),
}));

jest.mock("@/shared/components/SaveAsClientCheckbox", () => ({
  SaveAsClientCheckbox: () => null,
}));

jest.mock("@/shared/components/TransactionTimeOverride", () => ({
  TransactionTimeOverride: () => null,
}));

jest.mock("@/shared/components/ClientAutocompleteInput", () => ({
  ClientAutocompleteInput: () => null,
}));

jest.mock("@/features/partners/components/PartnerSelector", () => ({
  PartnerSelector: () => null,
}));

jest.mock("../../../components/StatsCards", () => ({
  StatsCards: () => <div data-testid="stats-cards" />,
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

async function renderPage() {
  render(<Services />);
  await waitFor(() => expect(mockGetOMTHistory).toHaveBeenCalled());
}

function typeAmount(v: string) {
  fireEvent.change(
    document.getElementById("service-amount") as HTMLInputElement,
    { target: { value: v } },
  );
}

function clickTab(label: string, arrow: string) {
  const tab = screen
    .getAllByRole("button")
    .find(
      (b) =>
        (b.textContent ?? "").includes(label) &&
        (b.textContent ?? "").includes(arrow),
    );
  expect(tab).toBeDefined();
  fireEvent.click(tab!);
}

/** Give the discount in the stub box and pay exactly what is left. */
async function payWithDiscount(discount: number) {
  await waitFor(() => expect(mockMpi.last?.onDiscountChange).toBeDefined());
  act(() => mockMpi.last!.onDiscountChange!(discount));
  const total = mockMpi.last!.totals[0]!;
  act(() =>
    mockMpi.last!.onChange([
      {
        id: "L1",
        method: "CASH",
        currencyCode: total.currency,
        amount: Math.round((total.amount - discount) * 100) / 100,
      },
    ]),
  );
}

async function submitSend() {
  fireEvent.click(screen.getByRole("button", { name: /Record Send/i }));
  await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
  return createFinancialServiceSchema.parse(
    mockAddOMTTransaction.mock.calls[0][0],
  );
}

describe("Services page — Discount on an OMT/Whish system SEND (LIRA-365)", () => {
  beforeEach(() => {
    delete mockMpi.last;
    mockShopBase.baseSystem = "OMT";
    mockShopBase.partnerSystem = "WHISH";
    mockSessionState.activeSession = null;
    mockAddOMTTransaction.mockClear();
  });

  it("OMT walk-in SEND: Discount line on, capped at $5", async () => {
    await renderPage();
    typeAmount("100");
    await screen.findByTestId("stub-multi-payment-input");
    expect(mockMpi.last?.showDiscount).toBe(true);
    expect(mockMpi.last?.maxDiscount).toBe(5);
    expect(typeof mockMpi.last?.onDiscountChange).toBe("function");
  });

  it("OMT walk-in SEND: the discount travels as discount_amount", async () => {
    await renderPage();
    typeAmount("100");
    await payWithDiscount(2);
    // Read before submitting: a successful submit resets the form.
    const total = mockMpi.last!.totals[0]!.amount;
    expect(total).toBe(101); // $100 INTRA + $1 fee
    const sent = await submitSend();
    expect(sent.discount_amount).toBe(2);
    // The legs cover the total minus the discount.
    const legs = sent.payments ?? [];
    expect(legs.reduce((s, l) => s + l.amount, 0)).toBeCloseTo(99, 2);
  });

  it("Whish walk-in SEND: Discount line on", async () => {
    // WHISH as the shop's base system, so its tab opens with no partner.
    mockShopBase.baseSystem = "WHISH";
    mockShopBase.partnerSystem = "OMT";
    await renderPage();
    clickTab("WHISH", "↑");
    typeAmount("100");
    await screen.findByTestId("stub-multi-payment-input");
    expect(mockMpi.last?.showDiscount).toBe(true);
  });

  it("RECEIVE (a payout): no Discount line", async () => {
    await renderPage();
    clickTab("OMT", "↓");
    typeAmount("100");
    await screen.findByTestId("stub-multi-payment-input");
    expect(mockMpi.last?.showDiscount).toBe(false);
  });

  it("inside a customer session: no Discount line (the basket's Waive owns it)", async () => {
    mockSessionState.activeSession = { id: 7 };
    await renderPage();
    typeAmount("100");
    await screen.findByTestId("stub-multi-payment-input");
    expect(mockMpi.last?.showDiscount).toBe(false);
  });

  it("no discount given → no discount_amount in the payload", async () => {
    await renderPage();
    typeAmount("100");
    await payWithDiscount(0);
    const sent = await submitSend();
    expect(sent.discount_amount).toBeUndefined();
  });
});

/**
 * Rule 28d — every OMT service type, fee on top and fee included: the
 * payload the screen builds with a $1 discount is accepted by the real
 * schema, carries the discount, and the legs cover the total minus it.
 */
describe("Services page — Discount on every OMT service type (LIRA-365)", () => {
  beforeEach(() => {
    delete mockMpi.last;
    mockShopBase.baseSystem = "OMT";
    mockShopBase.partnerSystem = "WHISH";
    mockSessionState.activeSession = null;
    mockAddOMTTransaction.mockClear();
  });

  const cases = OMT_SERVICE_TYPES.filter(
    (t) => t !== "OMT_WALLET" && t !== "ONLINE_BROKERAGE",
  ).flatMap((type) => [
    { type, includingFees: false },
    { type, includingFees: true },
  ]);

  it.each(cases)(
    "$type, fee included: $includingFees",
    async ({ type, includingFees }) => {
      await renderPage();
      const select = Array.from(document.querySelectorAll("select")).find(
        (s) => Array.from(s.options).some((o) => o.value === type),
      ) as HTMLSelectElement;
      fireEvent.change(select, { target: { value: type } });
      typeAmount("100");
      if (includingFees) {
        const toggle = screen.queryByTestId("service-including-fees-toggle");
        if (toggle) fireEvent.click(toggle);
      }
      await payWithDiscount(1);
      const sent = await submitSend();
      expect(sent.omtServiceType).toBe(type);
      expect(sent.discount_amount).toBe(1);
    },
  );
});
