/** @jest-environment jsdom */

/**
 * Shop-day bug (2026-10-16): an OMT SEND paid from a wallet (OMT / Whish
 * Wallet) with the 1% payment-method fee was ALWAYS refused —
 *   "expected $102.00 … got $101.00".
 * Core is right: the customer owes amount + provider fee + payment-method
 * fee (FinancialServiceRepository SEND reconcile, `totalCustomerPays`). The
 * page seeded the payment box with amount + provider fee only, so a single
 * wallet line carried $101 next to `paymentMethodFee: 1`; paying $102 by
 * hand made the box hand back $1 change and still net $101.
 *
 * The payment input is stubbed: it records the `totals`/`providerFee` it is
 * given, and its buttons play "the cashier picked Whish Wallet" and "the box
 * followed its total" (the real input auto-syncs an untouched single line to
 * the total). The payload is read through the shared schema (rule 24).
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
const mockSeen: {
  total?: number | undefined;
  providerFee?: number | undefined;
} = {};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
  MultiPaymentInput: (props: {
    onChange: (lines: unknown[]) => void;
    totals?: { amount: number; currency: string }[];
    providerFee?: number;
  }) => {
    mockSeen.total = props.totals?.[0]?.amount;
    mockSeen.providerFee = props.providerFee;
    return (
      <div data-testid="stub-multi-payment-input">
        <button
          data-testid="mpi-pick-whish"
          onClick={() =>
            props.onChange([
              { id: "L1", method: "WHISH", currencyCode: "USD", amount: 101 },
            ])
          }
        />
        <button
          data-testid="mpi-follow-total"
          onClick={() =>
            props.onChange([
              {
                id: "L1",
                method: "WHISH",
                currencyCode: "USD",
                amount: props.totals?.[0]?.amount ?? 0,
              },
            ])
          }
        />
      </div>
    );
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

beforeEach(() => {
  mockAddOMTTransaction.mockClear();
  delete mockSeen.total;
  delete mockSeen.providerFee;
});

describe("Services page — OMT SEND paid from a wallet with the 1% fee", () => {
  it("the payment box total includes the payment-method fee ($100 + $1 fee + $1 = $102)", async () => {
    await renderPage();
    fireEvent.change(
      document.getElementById("service-amount") as HTMLInputElement,
      { target: { value: "100" } },
    );
    await screen.findByTestId("stub-multi-payment-input");
    expect(mockSeen.total).toBe(101); // cash: amount + provider fee
    fireEvent.click(screen.getByTestId("mpi-pick-whish"));
    await waitFor(() => expect(mockSeen.total).toBe(102));
    // The box's own breakdown: send amount = total − fees on top = $100.
    expect((mockSeen.total ?? 0) - (mockSeen.providerFee ?? 0)).toBe(100);
  });

  it("the submitted wallet leg covers amount + provider fee + payment-method fee (what the server reconciles)", async () => {
    await renderPage();
    fireEvent.change(
      document.getElementById("service-amount") as HTMLInputElement,
      { target: { value: "100" } },
    );
    await screen.findByTestId("stub-multi-payment-input");
    fireEvent.click(screen.getByTestId("mpi-pick-whish"));
    await waitFor(() => expect(mockSeen.total).toBe(102));
    fireEvent.click(screen.getByTestId("mpi-follow-total"));
    fireEvent.click(screen.getByRole("button", { name: /Record Send/i }));
    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    const p = createFinancialServiceSchema.parse(
      mockAddOMTTransaction.mock.calls[0][0],
    );
    expect(p.paymentMethodFee).toBe(1);
    const inTotal = (p.payments ?? [])
      .filter((l) => l.direction !== "OUT")
      .reduce((s, l) => s + l.amount, 0);
    const outTotal = (p.payments ?? [])
      .filter((l) => l.direction === "OUT")
      .reduce((s, l) => s + l.amount, 0);
    expect(inTotal - outTotal).toBe(
      p.amount + (p.omtFee ?? 0) + (p.paymentMethodFee ?? 0),
    );
  });
});
