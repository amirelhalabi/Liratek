/** @jest-environment jsdom */

/**
 * Services page — customer adds change with the REAL payment box (LIRA-336).
 * Owner example on an OMT system RECEIVE: $197 owed, the cashier opens
 * "+ Customer gives change", enters Cash USD 3; "Shop pays" follows to $200
 * and the payload carries customerPayments [Cash USD 3] + added_change_usd 3.
 *
 * The page tests (Services.addedChange.test.tsx) stub the box; this one runs
 * the real MultiPaymentInput, so it also guards against a render loop from
 * the page's counterFlow wiring (rule 25: a loop shows up as a hang / worker
 * OOM, not as a failure). Field names come from the shared schema (rule 24).
 * Rule 17: written after the page change — not proven failing-first.
 */

import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { createFinancialServiceSchema } from "@liratek/core";
import Services from "../index";

const mockAddOMTTransaction = jest
  .fn()
  .mockResolvedValue({ success: true, id: 1 });
const mockGetOMTHistory = jest.fn().mockResolvedValue([]);
const mockApi = {
  getOMTHistory: mockGetOMTHistory,
  getOMTAnalytics: jest.fn().mockResolvedValue({
    today: { commission: 0, pending_commission: 0, count: 0, byCurrency: [] },
    month: { commission: 0, pending_commission: 0, count: 0, byCurrency: [] },
    byProvider: [],
  }),
  getSuppliers: jest.fn().mockResolvedValue([]),
  getSupplierBalances: jest.fn().mockResolvedValue([]),
  partners: { getAll: jest.fn().mockResolvedValue([]) },
  addOMTTransaction: mockAddOMTTransaction,
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  // Stable reference (rule 25). MultiPaymentInput is NOT stubbed.
  useApi: () => mockApi,
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

jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({
    activeSession: null,
    linkTransaction: jest.fn(),
    addToCart: jest.fn(),
  }),
}));

jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: [
      { code: "CASH", label: "Cash" },
      { code: "OMT", label: "OMT Wallet" },
      { code: "WHISH", label: "Whish Wallet" },
      { code: "CUSTOMER_ACCOUNT", label: "Customer Account" },
    ],
  }),
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 89500, buyRate: 89000 }),
}));

jest.mock("@/hooks/useShopBase", () => ({
  useShopBase: () => ({
    baseSystem: "OMT",
    partnerSystem: "WHISH",
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

// A plain input, so the sender name + phone can be filled as the cashier
// does (the e2e picks a saved client, which fills both).
jest.mock("@/shared/components/ClientAutocompleteInput", () => ({
  ClientAutocompleteInput: ({
    id,
    value,
    onChange,
  }: {
    id?: string;
    value: string;
    onChange: (v: string) => void;
  }) => (
    <input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
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

function receiveButton(): HTMLElement {
  const b = screen
    .getAllByRole("button")
    .find(
      (el) =>
        (el.textContent ?? "").includes("OMT") &&
        (el.textContent ?? "").includes("↓"),
    );
  if (!b) throw new Error("no RECEIVE button");
  return b;
}

beforeEach(() => {
  mockAddOMTTransaction.mockClear();
  mockGetOMTHistory.mockClear();
});

describe("Services page — customer adds change, real payment box (LIRA-336)", () => {
  it("OMT RECEIVE $197 + customer Cash $3 → shop pays $200, customerPayments [Cash 3], added_change_usd 3", async () => {
    render(<Services />);
    await waitFor(() => expect(mockGetOMTHistory).toHaveBeenCalled());
    fireEvent.click(receiveButton());
    fireEvent.change(
      document.getElementById("service-amount") as HTMLInputElement,
      { target: { value: "197" } },
    );

    fireEvent.click(await screen.findByTestId("counter-flow-add-change"));
    const cfAmount = await waitFor(() => {
      const el = document.querySelector<HTMLInputElement>(
        '[data-testid^="counter-flow-amount-"]',
      );
      if (!el) throw new Error("customer section not open");
      return el;
    });
    fireEvent.change(cfAmount, { target: { value: "3" } });
    // Let the box settle (auto-sync of "Shop pays").
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });

    fireEvent.click(screen.getByRole("button", { name: /Record Receive/i }));
    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    const p = createFinancialServiceSchema.parse(
      mockAddOMTTransaction.mock.calls[0][0],
    );
    expect(p.serviceType).toBe("RECEIVE");
    expect(p.amount).toBe(197);
    expect(p.customerPayments).toEqual([
      { method: "CASH", currencyCode: "USD", amount: 3 },
    ]);
    expect(p.added_change_usd).toBe(3);
    expect(p.payments).toEqual([
      expect.objectContaining({
        method: "CASH",
        currencyCode: "USD",
        amount: 200,
      }),
    ]);
    expect(p.rounding_given_usd).toBeUndefined();
    expect(p.kept_change_usd).toBeUndefined();
  });
});
