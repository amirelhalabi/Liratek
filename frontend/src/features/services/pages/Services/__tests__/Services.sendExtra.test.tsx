/** @jest-environment jsdom */

/**
 * LIRA-319 T047/T048 (financial-send part) — the Services page OMT/Whish
 * SEND offers an extra-only line in the payment box (`onExtraChange`, with
 * `showDiscount` still false — no discount on a system transfer) and sends
 * the extra as its OWN field: `amount` (the transfer principal) and `omtFee`
 * are exactly what they are without it, so the provider fee and the supplier
 * amount never see the extra. Never on a RECEIVE (a payout).
 *
 * The payment input is stubbed: it records the props the page wires and lets
 * a button play "the cashier typed a $1 extra and took $102". The payload is
 * asserted through the shared schema (rule 24).
 *
 * Not proven failing-first: written after the page change (rule 17).
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
  onExtraChange?: ((extra: number) => void) | undefined;
  showDiscount?: boolean | undefined;
  payer?: string | undefined;
} = {};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  // Stable reference (rule 25).
  useApi: () => mockApi,
  MultiPaymentInput: (props: {
    onChange: (lines: unknown[]) => void;
    onExtraChange?: (extra: number) => void;
    showDiscount?: boolean;
    payer?: string;
  }) => {
    mockSeen.onExtraChange = props.onExtraChange;
    mockSeen.showDiscount = props.showDiscount;
    mockSeen.payer = props.payer;
    return (
      <div data-testid="stub-multi-payment-input">
        <button
          data-testid="mpi-extra-1"
          onClick={() => {
            props.onExtraChange?.(1);
            props.onChange([
              { id: "L1", method: "CASH", currencyCode: "USD", amount: 102 },
            ]);
          }}
        />
        <button
          data-testid="mpi-no-extra"
          onClick={() =>
            props.onChange([
              { id: "L1", method: "CASH", currencyCode: "USD", amount: 101 },
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
  delete mockSeen.onExtraChange;
});

function typeAmountAndFee(): void {
  fireEvent.change(
    document.getElementById("service-amount") as HTMLInputElement,
    { target: { value: "100" } },
  );
}

async function submitSend(): Promise<ReturnType<typeof createFinancialServiceSchema.parse>> {
  fireEvent.click(screen.getByRole("button", { name: /Record Send/i }));
  await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
  return createFinancialServiceSchema.parse(
    mockAddOMTTransaction.mock.calls[0][0],
  );
}

describe("Services page — extra on an OMT/Whish system SEND", () => {
  it("SEND: extra-only line (no discount) is wired", async () => {
    await renderPage();
    typeAmountAndFee();
    await screen.findByTestId("stub-multi-payment-input");
    expect(typeof mockSeen.onExtraChange).toBe("function");
    expect(mockSeen.showDiscount).toBe(false);
  });

  it("SEND with a $1 extra: extra_usd 1 on its own field; amount and fee unchanged vs the same send without it", async () => {
    await renderPage();
    typeAmountAndFee();
    fireEvent.click(screen.getByTestId("mpi-no-extra"));
    const plain = await submitSend();
    expect(plain.extra_usd).toBeUndefined();
    expect(plain.extra_lbp).toBeUndefined();

    mockAddOMTTransaction.mockClear();
    typeAmountAndFee();
    fireEvent.click(screen.getByTestId("mpi-extra-1"));
    const withExtra = await submitSend();
    expect(withExtra.extra_usd).toBe(1);
    expect(withExtra.extra_lbp).toBeUndefined();
    expect(withExtra.amount).toBe(plain.amount);
    expect(withExtra.omtFee).toBe(plain.omtFee);
    expect(withExtra.commission).toBe(plain.commission);
    expect(withExtra.payments).toEqual([
      expect.objectContaining({ currencyCode: "USD", amount: 102 }),
    ]);
  });

  it("RECEIVE (a payout): no extra offered, and a stale extra from a SEND is not sent", async () => {
    await renderPage();
    // A SEND extra left in page state.
    fireEvent.click(screen.getByTestId("mpi-extra-1"));
    const receiveButton = screen
      .getAllByRole("button")
      .find(
        (b) =>
          (b.textContent ?? "").includes("OMT") &&
          (b.textContent ?? "").includes("↓"),
      );
    expect(receiveButton).toBeDefined();
    fireEvent.click(receiveButton!);
    await waitFor(() => expect(mockSeen.payer).toBe("payout"));
    expect(mockSeen.onExtraChange).toBeUndefined();

    fireEvent.change(
      document.getElementById("service-amount") as HTMLInputElement,
      { target: { value: "100" } },
    );
    fireEvent.click(screen.getByTestId("mpi-no-extra"));
    fireEvent.click(screen.getByRole("button", { name: /Record Receive/i }));
    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    const parsed = createFinancialServiceSchema.parse(
      mockAddOMTTransaction.mock.calls[0][0],
    );
    expect(parsed.serviceType).toBe("RECEIVE");
    expect(parsed.extra_usd).toBeUndefined();
    expect(parsed.extra_lbp).toBeUndefined();
  });
});
