/** @jest-environment jsdom */

/**
 * Services page (OMT / Whish system RECEIVE) — the "− Less | + Extra" line
 * on the payout, with the REAL payment box (LIRA-382). Table-driven, the same
 * cases as every other payout screen: the cashier types in the line, the
 * payment line follows, and the ONE payload carries the existing
 * `rounding_given_*` / `kept_change_*` fields, read off the payload after
 * `createFinancialServiceSchema` parses it (rule 24). Stable `useApi` mock
 * (rule 25). Rule 17: run against the box without the line first — see the
 * task report.
 */

import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { createFinancialServiceSchema } from "@liratek/core";
import {
  setPayoutLine,
  payoutLegAmounts,
  type PayoutLineSide,
} from "@/shared/testing/payoutExtraLess";
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

type Parsed = ReturnType<typeof createFinancialServiceSchema.parse>;
const CASES: {
  name: string;
  currency: "USD" | "LBP";
  owed: string;
  side: PayoutLineSide;
  typed: string;
  leg: number;
  check: (p: Parsed) => void;
}[] = [
  {
    name: "+ Extra 0.10 on $102.90 → pays $103.00, rounding_given_usd 0.1",
    currency: "USD",
    owed: "102.90",
    side: "extra",
    typed: "0.10",
    leg: 103,
    check: (p) => {
      expect(p.rounding_given_usd).toBe(0.1);
      expect(p.rounding_given_lbp ?? 0).toBe(0);
      expect(p.kept_change_usd).toBeUndefined();
      expect(p.kept_change_lbp).toBeUndefined();
    },
  },
  {
    name: "− Less 5,000 on 1,345,000 LBP → pays 1,340,000, kept_change_lbp 5000",
    currency: "LBP",
    owed: "1345000",
    side: "less",
    typed: "5000",
    leg: 1_340_000,
    check: (p) => {
      expect(p.kept_change_lbp).toBe(5_000);
      expect(p.kept_change_usd ?? 0).toBe(0);
      expect(p.rounding_given_usd).toBeUndefined();
      expect(p.rounding_given_lbp).toBeUndefined();
    },
  },
];

beforeEach(() => {
  mockAddOMTTransaction.mockClear();
  mockGetOMTHistory.mockClear();
});

describe("Services page — payout '− Less | + Extra' line, real box (LIRA-382)", () => {
  it.each(CASES)("OMT RECEIVE: $name", async (c) => {
    render(<Services />);
    await waitFor(() => expect(mockGetOMTHistory).toHaveBeenCalled());
    fireEvent.click(receiveButton());
    fireEvent.click(screen.getByTestId(`service-currency-${c.currency}`));
    fireEvent.change(
      document.getElementById("service-amount") as HTMLInputElement,
      { target: { value: c.owed } },
    );
    await screen.findByTestId("payout-extra-less");
    setPayoutLine(c.side, c.typed);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(payoutLegAmounts()).toEqual([c.leg]);

    fireEvent.click(screen.getByRole("button", { name: /Record Receive/i }));
    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    const p = createFinancialServiceSchema.parse(
      mockAddOMTTransaction.mock.calls[0][0],
    );
    expect(p.serviceType).toBe("RECEIVE");
    expect(p.payments).toEqual([
      expect.objectContaining({
        method: "CASH",
        currencyCode: c.currency,
        amount: c.leg,
      }),
    ]);
    c.check(p);
  });
});
