/** @jest-environment jsdom */

/**
 * Services page — the session-basket cart label (production testing
 * 2026-10-07).
 *
 * 1. An OMT RECEIVE cart line read "· fee $1.00" although OMT never charges
 *    the customer a fee on a receive (D1: the fee there is informational
 *    only). The label must not mention a fee for OMT RECEIVE. Whish RECEIVE,
 *    whose typed fee IS charged, keeps it.
 * 2. A For-Partner OMT/Whish line contributes $0 to the walk-in customer's
 *    charge (`sessionBasketCustomerAmount`, @liratek/core), yet its label
 *    still read "+ $X fees". It must say the transfer goes on the partner's
 *    account and drop the fee wording.
 *
 * Label only — the cart amount / payload are asserted unchanged.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
const mockPartnersGetAll = jest.fn().mockResolvedValue([
  { id: 7, name: "Ziad Supplies", system_association: null, is_active: 1 },
]);
const mockAddToCart = jest.fn();

// Rule 25: ONE stable object — a fresh literal per useApi() call is the
// unstable identity production hides.
const mockApi = {
  getOMTHistory: (...a: unknown[]) => mockGetOMTHistory(...a),
  getOMTAnalytics: (...a: unknown[]) => mockGetOMTAnalytics(...a),
  getSuppliers: (...a: unknown[]) => mockGetSuppliers(...a),
  getSupplierBalances: (...a: unknown[]) => mockGetSupplierBalances(...a),
  partners: { getAll: (...a: unknown[]) => mockPartnersGetAll(...a) },
  addOMTTransaction: (...a: unknown[]) => mockAddOMTTransaction(...a),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
  MultiPaymentInput: () => <div data-testid="stub-multi-payment-input" />,
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

// Active session — the RECEIVE-in-session combination this contract covers.
// Only `customer_name`/`customer_phone` are read by index.tsx from this
// object; `addToCart` is what captures the cart payload we assert against.
jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({
    activeSession: {
      id: 1,
      customer_name: "Jane Doe",
      customer_phone: "70111222",
    },
    linkTransaction: jest.fn(),
    addToCart: mockAddToCart,
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

// Switchable so the Whish guard can make WHISH the shop's own (base) system,
// as Services.whishReceiveFee.test.tsx does — otherwise WHISH is gated
// behind a partner.
let mockBaseSystem: "OMT" | "WHISH" = "OMT";
jest.mock("@/hooks/useShopBase", () => ({
  useShopBase: () => ({
    baseSystem: mockBaseSystem,
    partnerSystem: mockBaseSystem === "OMT" ? "WHISH" : "OMT",
    loading: false,
  }),
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

// Selects partner #7 on mount — stands in for the real selector's
// single-partner auto-select.
jest.mock("@/features/partners/components/PartnerSelector", () => ({
  PartnerSelector: ({ onSelect }: { onSelect: (id: number) => void }) => {
    const { useEffect } = jest.requireActual("react");
    useEffect(() => {
      onSelect(7);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return null;
  },
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

function switchTab(provider: "OMT" | "WHISH", type: "SEND" | "RECEIVE") {
  const arrow = type === "SEND" ? "↑" : "↓";
  const button = screen
    .getAllByRole("button")
    .find(
      (b) =>
        (b.textContent ?? "").includes(provider) &&
        (b.textContent ?? "").includes(arrow),
    );
  expect(button).toBeDefined();
  fireEvent.click(button!);
}

function typeAmount(value: string) {
  fireEvent.change(
    document.getElementById("service-amount") as HTMLInputElement,
    { target: { value } },
  );
}

async function addToBasket(type: "SEND" | "RECEIVE") {
  fireEvent.click(
    screen.getByRole("button", {
      name: type === "SEND" ? /Record Send/i : /Record Receive/i,
    }),
  );
  await waitFor(() => expect(mockAddToCart).toHaveBeenCalledTimes(1));
  const item = mockAddToCart.mock.calls[0][0] as {
    label: string;
    amount: number;
    formData: Record<string, unknown>;
  };
  // Rule 28a: confirm a label was actually captured before judging it.
  expect(typeof item.label).toBe("string");
  return item;
}

async function checkForPartner() {
  fireEvent.click(screen.getByRole("checkbox", { name: /For Partner/i }));
  await waitFor(() =>
    expect(screen.queryByText(/Select partner/)).not.toBeInTheDocument(),
  );
}

describe("Services page — session cart label", () => {
  beforeEach(() => {
    mockAddToCart.mockClear();
    mockAddOMTTransaction.mockClear();
    mockBaseSystem = "OMT";
  });

  it("OMT RECEIVE: the label shows no fee (OMT never charges one on a receive)", async () => {
    await renderPage();
    switchTab("OMT", "RECEIVE");
    typeAmount("100");
    const item = await addToBasket("RECEIVE");

    // Premise: a $100 INTRA receive resolves a non-zero tier fee.
    expect(item.formData.omtFee).toBe(1);
    expect(item.label).toContain("OMT RECEIVE");
    expect(item.label).toContain("$100.00");
    expect(item.label).not.toMatch(/fee/i);
    // Label only: the payout amount is unchanged.
    expect(item.amount).toBe(-100);
  });

  it("guard: Whish RECEIVE keeps its typed fee on the label (only OMT hides it)", async () => {
    mockBaseSystem = "WHISH";
    await renderPage();
    switchTab("WHISH", "RECEIVE");
    typeAmount("100");
    fireEvent.change(
      document.getElementById("service-whish-fee") as HTMLInputElement,
      { target: { value: "2" } },
    );
    const item = await addToBasket("RECEIVE");

    expect(item.label).toContain("WHISH RECEIVE");
    expect(item.label).toContain("· fee $2.00");
  });

  it("guard: OMT SEND still shows its fee on the label", async () => {
    await renderPage();
    switchTab("OMT", "SEND");
    typeAmount("100");
    const item = await addToBasket("SEND");

    expect(item.label).toContain("OMT SEND");
    expect(item.label).toMatch(/\+ \$1\.00 fees/);
  });

  it("For Partner OMT SEND: the label says it goes on the partner's account, with no fee wording", async () => {
    await renderPage();
    switchTab("OMT", "SEND");
    typeAmount("100");
    await checkForPartner();
    const item = await addToBasket("SEND");

    expect(item.formData.partnerMode).toBe("FOR");
    expect(item.label).toContain("OMT SEND");
    expect(item.label).toContain("$100.00");
    expect(item.label).toContain("for Ziad Supplies");
    expect(item.label).toContain("on partner account");
    expect(item.label).not.toMatch(/fee/i);
  });

  it("For Partner OMT RECEIVE: the label says it goes on the partner's account", async () => {
    await renderPage();
    switchTab("OMT", "RECEIVE");
    typeAmount("100");
    await checkForPartner();
    const item = await addToBasket("RECEIVE");

    expect(item.formData.partnerMode).toBe("FOR");
    expect(item.label).toContain("OMT RECEIVE");
    expect(item.label).toContain("for Ziad Supplies");
    expect(item.label).toContain("on partner account");
    expect(item.label).not.toMatch(/fee/i);
  });
});
