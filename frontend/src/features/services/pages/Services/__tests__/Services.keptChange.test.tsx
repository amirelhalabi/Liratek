/** @jest-environment jsdom */

/**
 * Services page (OMT / Whish system) — kept change on a SEND (owner decision
 * 2026-10-06: no "Keep change" button; handing back less change than due
 * keeps the rest as profit automatically wherever the backend can book it).
 *
 * FinancialServiceRepository's SEND branch already reconciles legs against
 * `kept_change_*` and stamps them as profit (the recharge-tab FinancialForm
 * and OMT/Whish App forms send them) — this page never wired `onKeptChange`,
 * so an under-returned SEND could only show the red "not covered" warning.
 * RECEIVE is a cashout (the shop pays out), so it stays unwired. Payload
 * asserted through the shared schema (rule 24).
 *
 * Rule 17: run against the pre-wiring page first — see the task report.
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
const mockSeenProps: {
  onKeptChange?: ((kept: { usd: number; lbp: number } | null) => void) | undefined;
  renders: number;
} = { renders: 0 };

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  // Stable reference (rule 25).
  useApi: () => mockApi,
  // Stub exposing the callbacks the page wires. Records whether the page
  // wired onKeptChange, and lets a button play "customer overpaid $120 for a
  // $100 OMT send + fee, cashier handed back $15, keeping the rest".
  MultiPaymentInput: (props: {
    onChange: (lines: unknown[]) => void;
    onReturnChange?: (legs: unknown[]) => void;
    onKeptChange?: (kept: { usd: number; lbp: number } | null) => void;
  }) => {
    mockSeenProps.onKeptChange = props.onKeptChange;
    mockSeenProps.renders += 1;
    return (
      <div data-testid="stub-multi-payment-input">
        <button
          data-testid="mpi-under-return"
          onClick={() => {
            props.onChange([
              { id: "L1", method: "CASH", currencyCode: "USD", amount: 120 },
            ]);
            props.onReturnChange?.([
              {
                id: "R1",
                method: "CASH",
                currencyCode: "USD",
                amount: 15,
                direction: "OUT",
              },
            ]);
            props.onKeptChange?.({ usd: 4, lbp: 0 });
          }}
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
  delete mockSeenProps.onKeptChange;
});

describe("Services page — kept change on an OMT/Whish system SEND", () => {
  it("SEND: an under-return sends kept_change_* with the legs in the ONE payload", async () => {
    await renderPage();
    expect(typeof mockSeenProps.onKeptChange).toBe("function");

    fireEvent.change(
      document.getElementById("service-amount") as HTMLInputElement,
      { target: { value: "100" } },
    );
    fireEvent.click(screen.getByTestId("mpi-under-return"));
    fireEvent.click(screen.getByRole("button", { name: /Record Send/i }));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    expect(mockAddOMTTransaction.mock.calls[0]).toHaveLength(1);
    const parsed = createFinancialServiceSchema.parse(
      mockAddOMTTransaction.mock.calls[0][0],
    );
    expect(parsed.serviceType).toBe("SEND");
    expect(parsed.kept_change_usd).toBe(4);
    expect(parsed.kept_change_lbp).toBe(0);
    expect(parsed.payments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ currencyCode: "USD", amount: 120 }),
        expect.objectContaining({
          currencyCode: "USD",
          amount: 15,
          direction: "OUT",
        }),
      ]),
    );
  });

  it("RECEIVE (a cashout): the page does not wire onKeptChange", async () => {
    await renderPage();
    expect(typeof mockSeenProps.onKeptChange).toBe("function");
    const receiveButton = screen
      .getAllByRole("button")
      .find(
        (b) =>
          (b.textContent ?? "").includes("OMT") &&
          (b.textContent ?? "").includes("↓"),
      );
    expect(receiveButton).toBeDefined();
    mockSeenProps.renders = 0;
    fireEvent.click(receiveButton!);
    // The payment section re-rendered in RECEIVE mode, without the callback.
    await waitFor(() => expect(mockSeenProps.renders).toBeGreaterThan(0));
    expect(mockSeenProps.onKeptChange).toBeUndefined();
  });
});
