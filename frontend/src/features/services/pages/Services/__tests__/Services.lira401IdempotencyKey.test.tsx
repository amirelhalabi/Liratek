/** @jest-environment jsdom */

/**
 * LIRA-401 — the Services page (always-visible OMT/Whish form) sends a
 * one-time `idempotencyKey` with every `addOMTTransaction`:
 *   - the SAME key on a retry after a failed submit (so a retry or a double
 *     tap is booked once by the server's replay guard);
 *   - a NEW key for the next payment after a successful one (two real
 *     payments in a row are two bookings).
 *
 * Not proven failing-first (rule 17): written after the wiring; never run
 * against the page without it. Mocks copied from Services.keptChange.test.tsx
 * (stable `useApi` mock, rule 25).
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
  onKeptChange?:
    | ((kept: { usd: number; lbp: number } | null) => void)
    | undefined;
  onReturnChange?: ((legs: unknown[]) => void) | undefined;
  payer?: string | undefined;
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
    payer?: string;
  }) => {
    mockSeenProps.onKeptChange = props.onKeptChange;
    mockSeenProps.onReturnChange = props.onReturnChange;
    mockSeenProps.payer = props.payer;
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
        {/* RECEIVE payout: exact $100 — nothing kept. */}
        <button
          data-testid="mpi-payout-exact"
          onClick={() =>
            props.onChange([
              { id: "P1", method: "CASH", currencyCode: "USD", amount: 100 },
            ])
          }
        />
        {/* RECEIVE payout: $100.73 owed, $100 handed out, $0.73 kept. */}
        <button
          data-testid="mpi-payout-short"
          onClick={() => {
            props.onChange([
              { id: "P1", method: "CASH", currencyCode: "USD", amount: 100 },
            ]);
            props.onKeptChange?.({ usd: 0.73, lbp: 0 });
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

const KEY_PATTERN = /^[A-Za-z0-9-]{8,128}$/;

function keyOfCall(n: number): unknown {
  const opts = mockAddOMTTransaction.mock.calls[n][1] as
    | { idempotencyKey?: string }
    | undefined;
  return opts?.idempotencyKey;
}

function fillAndSubmit() {
  fireEvent.change(
    document.getElementById("service-amount") as HTMLInputElement,
    { target: { value: "100" } },
  );
  fireEvent.click(screen.getByTestId("mpi-under-return"));
  fireEvent.click(screen.getByRole("button", { name: /Record Send/i }));
}

describe("Services page — LIRA-401 idempotency key", () => {
  it("reuses the key on a retry after a failure, and issues a new one after a success", async () => {
    mockAddOMTTransaction
      .mockResolvedValueOnce({ success: false, error: "Network down" })
      .mockResolvedValueOnce({ success: true, id: 11 })
      .mockResolvedValueOnce({ success: true, id: 12 });
    await renderPage();

    // 1st submit fails — the form keeps its values.
    fillAndSubmit();
    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    const first = keyOfCall(0);
    expect(typeof first).toBe("string");
    expect(first).toEqual(expect.stringMatching(KEY_PATTERN));

    // Retry of the SAME payment — same key, so the server books it once.
    fireEvent.click(screen.getByRole("button", { name: /Record Send/i }));
    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(2));
    expect(keyOfCall(1)).toBe(first);

    // The retry succeeded; the NEXT customer's payment gets a new key.
    fillAndSubmit();
    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(3));
    const third = keyOfCall(2);
    expect(third).toEqual(expect.stringMatching(KEY_PATTERN));
    expect(third).not.toBe(first);
  });
});
