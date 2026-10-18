/** @jest-environment jsdom */

/**
 * Services page (OMT / Whish system) — payout round-up on a RECEIVE
 * (LIRA-334, T014/T029). Owner example: $102.90 owed, $103 handed out — the
 * $0.10 is a round-up the shop books as a "Change rounding" expense. The
 * payment input reports it via `onRoundUpChange`; the page sends it as
 * `rounding_given_*` in the ONE payload (rule 22), only on a CASH walk-in
 * RECEIVE, never kept change alongside. Payload parsed through the shared
 * schema (rule 24); `useApi` mock returns a stable reference (rule 25).
 *
 * Rule 17: run against the unwired page first — see the task report.
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
  onRoundUpChange?:
    | ((r: { usd: number; lbp: number } | null) => void)
    | undefined;
  payer?: string | undefined;
} = {};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  // Stable reference (rule 25).
  useApi: () => mockApi,
  // Stub: fires callbacks in the order the real input does (lines, then the
  // kept report, then the round-up report).
  MultiPaymentInput: (props: {
    onChange: (lines: unknown[]) => void;
    onKeptChange?: (kept: { usd: number; lbp: number } | null) => void;
    onRoundUpChange?: (r: { usd: number; lbp: number } | null) => void;
    payer?: string;
  }) => {
    mockSeenProps.onRoundUpChange = props.onRoundUpChange;
    mockSeenProps.payer = props.payer;
    return (
      <div data-testid="stub-multi-payment-input">
        {/* Owner example: $102.90 owed, $103 handed out, $0.10 rounded up. */}
        <button
          data-testid="mpi-payout-roundup"
          onClick={() => {
            props.onChange([
              { id: "P1", method: "CASH", currencyCode: "USD", amount: 103 },
            ]);
            props.onKeptChange?.(null);
            props.onRoundUpChange?.({ usd: 0.1, lbp: 0 });
          }}
        />
        <button
          data-testid="mpi-payout-exact"
          onClick={() => {
            props.onChange([
              { id: "P1", method: "CASH", currencyCode: "USD", amount: 102.9 },
            ]);
            props.onRoundUpChange?.(null);
          }}
        />
        {/* Lines only — no report (the input does not re-report on a
            payer switch it was not keyed on). */}
        <button
          data-testid="mpi-send-pay"
          onClick={() =>
            props.onChange([
              { id: "S1", method: "CASH", currencyCode: "USD", amount: 102.9 },
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

function typeAmount(v: string): void {
  fireEvent.change(
    document.getElementById("service-amount") as HTMLInputElement,
    { target: { value: v } },
  );
}

beforeEach(() => {
  mockAddOMTTransaction.mockClear();
  delete mockSeenProps.onRoundUpChange;
  delete mockSeenProps.payer;
});

describe("Services page — payout round-up on an OMT/Whish system RECEIVE", () => {
  it("RECEIVE CASH: the input gets onRoundUpChange; $103 on $102.90 sends rounding_given_usd 0.1 and no kept change", async () => {
    await renderPage();
    fireEvent.click(receiveButton());
    await waitFor(() => expect(mockSeenProps.payer).toBe("payout"));
    expect(typeof mockSeenProps.onRoundUpChange).toBe("function");

    typeAmount("102.90");
    fireEvent.click(screen.getByTestId("mpi-payout-roundup"));
    fireEvent.click(screen.getByRole("button", { name: /Record Receive/i }));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    const parsed = createFinancialServiceSchema.parse(
      mockAddOMTTransaction.mock.calls[0][0],
    );
    expect(parsed.serviceType).toBe("RECEIVE");
    expect(parsed.rounding_given_usd).toBe(0.1);
    expect(parsed.rounding_given_lbp ?? 0).toBe(0);
    expect(parsed.kept_change_usd).toBeUndefined();
    expect(parsed.kept_change_lbp).toBeUndefined();
    expect(parsed.payments).toEqual([
      expect.objectContaining({ currencyCode: "USD", amount: 103 }),
    ]);
  });

  it("RECEIVE exact payout: no rounding_given_* is sent", async () => {
    await renderPage();
    fireEvent.click(receiveButton());
    await waitFor(() => expect(mockSeenProps.payer).toBe("payout"));
    typeAmount("102.90");
    fireEvent.click(screen.getByTestId("mpi-payout-roundup"));
    fireEvent.click(screen.getByTestId("mpi-payout-exact"));
    fireEvent.click(screen.getByRole("button", { name: /Record Receive/i }));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    const parsed = createFinancialServiceSchema.parse(
      mockAddOMTTransaction.mock.calls[0][0],
    );
    expect(parsed.rounding_given_usd).toBeUndefined();
    expect(parsed.rounding_given_lbp).toBeUndefined();
  });

  it("SEND: the input never gets onRoundUpChange, and a stale RECEIVE round-up is not sent on a SEND", async () => {
    await renderPage();
    // A RECEIVE round-up left in page state…
    fireEvent.click(receiveButton());
    await waitFor(() => expect(mockSeenProps.payer).toBe("payout"));
    fireEvent.click(screen.getByTestId("mpi-payout-roundup"));
    // …then the cashier flips back to SEND.
    const sendButton = screen
      .getAllByRole("button")
      .find(
        (el) =>
          (el.textContent ?? "").includes("OMT") &&
          (el.textContent ?? "").includes("↑"),
      );
    expect(sendButton).toBeDefined();
    fireEvent.click(sendButton!);
    await waitFor(() => expect(mockSeenProps.payer).toBeUndefined());
    expect(mockSeenProps.onRoundUpChange).toBeUndefined();

    typeAmount("100");
    fireEvent.click(screen.getByTestId("mpi-send-pay"));
    fireEvent.click(screen.getByRole("button", { name: /Record Send/i }));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    const parsed = createFinancialServiceSchema.parse(
      mockAddOMTTransaction.mock.calls[0][0],
    );
    expect(parsed.serviceType).toBe("SEND");
    expect(parsed.rounding_given_usd).toBeUndefined();
    expect(parsed.rounding_given_lbp).toBeUndefined();
  });
});
