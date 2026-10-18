/** @jest-environment jsdom */

/**
 * Services page (OMT / Whish system) — the customer adds change on a RECEIVE
 * payout (LIRA-336, T012). Owner example: $197 owed, the customer hands over
 * $3, the shop hands out $200.
 *
 *  - OMT/WHISH system RECEIVE, CASH cashout, no partner, no session, no fee
 *    section → an OPTIONAL "Customer gives change" section (counterFlow
 *    `{ optional, allowAddedChange, totalAmount: 0 }`); its non-zero lines go
 *    out as `customerPayments` together with `added_change_*` (the payout
 *    currency, from `onAddedChange`).
 *  - WHISH fee paid on top → the existing fee section gets
 *    `allowAddedChange`; all its lines go as `feePayments` + the claim.
 *  - Partner (THROUGH) or session → no section, no claim.
 *
 * Payload parsed through the shared core schema (rule 24); the `useApi`
 * mock returns a stable reference (rule 25).
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
const mockPartnersGetAll = jest.fn().mockResolvedValue([]);
const mockAddToCart = jest.fn();
const mockApi = {
  getOMTHistory: mockGetOMTHistory,
  getOMTAnalytics: jest.fn().mockResolvedValue({
    today: { commission: 0, pending_commission: 0, count: 0, byCurrency: [] },
    month: { commission: 0, pending_commission: 0, count: 0, byCurrency: [] },
    byProvider: [],
  }),
  getSuppliers: jest.fn().mockResolvedValue([]),
  getSupplierBalances: jest.fn().mockResolvedValue([]),
  partners: { getAll: mockPartnersGetAll },
  addOMTTransaction: mockAddOMTTransaction,
};

let mockActiveSession: { id: number } | null = null;
let mockPartnerSystem: "OMT" | "WHISH" = "WHISH";

interface SeenCounterFlow {
  totalAmount: number;
  currency: string;
  optional?: boolean;
  allowAddedChange?: boolean;
  onChange: (lines: unknown[]) => void;
  onStateChange?: (s: Record<string, unknown>) => void;
}
const mockSeen: {
  counterFlow?: SeenCounterFlow | undefined;
  onAddedChange?:
    | ((a: { usd: number; lbp: number } | null) => void)
    | undefined;
  payer?: string | undefined;
} = {};

const BALANCED = {
  paid: 3,
  owedToAccount: 0,
  forgiven: 0,
  balanced: true,
  overpaid: false,
  needsClient: false,
  unaccounted: 0,
  addedChange: 3,
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  // Stable reference (rule 25).
  useApi: () => mockApi,
  // Stub: fires callbacks in the order the real input does.
  MultiPaymentInput: (props: {
    onChange: (lines: unknown[]) => void;
    onAddedChange?: (a: { usd: number; lbp: number } | null) => void;
    counterFlow?: SeenCounterFlow;
    payer?: string;
  }) => {
    mockSeen.counterFlow = props.counterFlow;
    mockSeen.onAddedChange = props.onAddedChange;
    mockSeen.payer = props.payer;
    return (
      <div data-testid="stub-multi-payment-input">
        {/* Owner example: Customer gives Cash USD 3, shop pays Cash USD 200. */}
        <button
          data-testid="mpi-customer-adds-3"
          onClick={() => {
            props.counterFlow?.onChange([
              { id: "C1", method: "CASH", currencyCode: "USD", amount: 3 },
            ]);
            props.counterFlow?.onStateChange?.(BALANCED);
            props.onChange([
              { id: "P1", method: "CASH", currencyCode: "USD", amount: 200 },
            ]);
            props.onAddedChange?.({ usd: 3, lbp: 0 });
          }}
        />
        {/* The cashier opened the section but typed nothing (0 CASH line). */}
        <button
          data-testid="mpi-section-open-empty"
          onClick={() => {
            props.counterFlow?.onChange([
              { id: "C1", method: "CASH", currencyCode: "USD", amount: 0 },
            ]);
            props.onChange([
              { id: "P1", method: "CASH", currencyCode: "USD", amount: 197 },
            ]);
            props.onAddedChange?.(null);
          }}
        />
        <button
          data-testid="mpi-payout-exact"
          onClick={() =>
            props.onChange([
              { id: "P1", method: "CASH", currencyCode: "USD", amount: 197 },
            ])
          }
        />
        {/* Over the cap: the section reports overpaid, no added change. */}
        <button
          data-testid="mpi-customer-adds-over-cap"
          onClick={() => {
            props.counterFlow?.onChange([
              { id: "C1", method: "CASH", currencyCode: "USD", amount: 20 },
            ]);
            props.counterFlow?.onStateChange?.({
              ...BALANCED,
              paid: 20,
              balanced: false,
              overpaid: true,
              addedChange: 0,
            });
            props.onAddedChange?.(null);
          }}
        />
        {/* WHISH fee $5 on top; the customer hands $8 (fee + $3 added). */}
        <button
          data-testid="mpi-fee-plus-3"
          onClick={() => {
            props.counterFlow?.onChange([
              { id: "F1", method: "CASH", currencyCode: "USD", amount: 8 },
            ]);
            props.counterFlow?.onStateChange?.({ ...BALANCED, paid: 8 });
            props.onChange([
              { id: "P1", method: "CASH", currencyCode: "USD", amount: 103 },
            ]);
            props.onAddedChange?.({ usd: 3, lbp: 0 });
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
    activeSession: mockActiveSession,
    linkTransaction: jest.fn(),
    addToCart: mockAddToCart,
  }),
}));

jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: [
      { code: "CASH", label: "Cash" },
      { code: "OMT", label: "OMT Wallet" },
      { code: "WHISH", label: "Whish Wallet" },
      { code: "CUSTOMER_ACCOUNT", label: "Customer account" },
    ],
  }),
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 89500, buyRate: 89000 }),
}));

jest.mock("@/hooks/useShopBase", () => ({
  useShopBase: () => ({
    baseSystem: mockPartnerSystem === "WHISH" ? "OMT" : "WHISH",
    partnerSystem: mockPartnerSystem,
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
  PartnerSelector: ({ onSelect }: { onSelect: (id: number) => void }) => (
    <button data-testid="pick-partner" onClick={() => onSelect(7)} />
  ),
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

function directionButton(provider: string, arrow: "↑" | "↓"): HTMLElement {
  const b = screen
    .getAllByRole("button")
    .find(
      (el) =>
        (el.textContent ?? "").includes(provider) &&
        (el.textContent ?? "").includes(arrow),
    );
  if (!b) throw new Error(`no ${provider} ${arrow} button`);
  return b;
}

function typeAmount(v: string): void {
  fireEvent.change(
    document.getElementById("service-amount") as HTMLInputElement,
    { target: { value: v } },
  );
}

function submit(): void {
  fireEvent.click(screen.getByRole("button", { name: /Record Receive/i }));
}

async function sentPayload() {
  await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
  return createFinancialServiceSchema.parse(
    mockAddOMTTransaction.mock.calls[0][0],
  );
}

beforeEach(() => {
  mockActiveSession = null;
  mockPartnerSystem = "WHISH";
  mockPartnersGetAll.mockResolvedValue([]);
  mockAddOMTTransaction.mockClear();
  mockAddToCart.mockClear();
  delete mockSeen.counterFlow;
  delete mockSeen.onAddedChange;
  delete mockSeen.payer;
});

describe("Services page — customer adds change on an OMT/Whish system RECEIVE (LIRA-336)", () => {
  it("OMT RECEIVE CASH: an optional 'Customer gives change' section is offered (total 0, payout currency)", async () => {
    await renderPage();
    fireEvent.click(directionButton("OMT", "↓"));
    await waitFor(() => expect(mockSeen.payer).toBe("payout"));
    expect(mockSeen.counterFlow).toEqual(
      expect.objectContaining({
        optional: true,
        allowAddedChange: true,
        totalAmount: 0,
        currency: "USD",
      }),
    );
    expect(typeof mockSeen.onAddedChange).toBe("function");
  });

  it("$197 owed, customer gives Cash USD 3, shop pays $200 → customerPayments [Cash 3] + added_change_usd 3", async () => {
    await renderPage();
    fireEvent.click(directionButton("OMT", "↓"));
    await waitFor(() => expect(mockSeen.payer).toBe("payout"));
    typeAmount("197");
    fireEvent.click(screen.getByTestId("mpi-customer-adds-3"));
    submit();

    const parsed = await sentPayload();
    expect(parsed.serviceType).toBe("RECEIVE");
    expect(parsed.amount).toBe(197);
    expect(parsed.customerPayments).toEqual([
      { method: "CASH", currencyCode: "USD", amount: 3 },
    ]);
    expect(parsed.added_change_usd).toBe(3);
    expect(parsed.added_change_lbp ?? 0).toBe(0);
    expect(parsed.payments).toEqual([
      expect.objectContaining({ currencyCode: "USD", amount: 200 }),
    ]);
    // No round-up / kept change for the customer's own money.
    expect(parsed.rounding_given_usd).toBeUndefined();
    expect(parsed.kept_change_usd).toBeUndefined();
  });

  it("no added change → no added_change_* and no customerPayments key", async () => {
    await renderPage();
    fireEvent.click(directionButton("OMT", "↓"));
    await waitFor(() => expect(mockSeen.payer).toBe("payout"));
    typeAmount("197");
    fireEvent.click(screen.getByTestId("mpi-payout-exact"));
    submit();

    const parsed = await sentPayload();
    expect(parsed.added_change_usd).toBeUndefined();
    expect(parsed.added_change_lbp).toBeUndefined();
    expect(mockAddOMTTransaction.mock.calls[0][0]).not.toHaveProperty(
      "customerPayments",
    );
  });

  it("section opened but left at 0 → the 0 line is dropped, no customerPayments, no claim", async () => {
    await renderPage();
    fireEvent.click(directionButton("OMT", "↓"));
    await waitFor(() => expect(mockSeen.payer).toBe("payout"));
    typeAmount("197");
    fireEvent.click(screen.getByTestId("mpi-section-open-empty"));
    submit();

    const parsed = await sentPayload();
    expect(parsed.added_change_usd).toBeUndefined();
    expect(mockAddOMTTransaction.mock.calls[0][0]).not.toHaveProperty(
      "customerPayments",
    );
  });

  it("over the cap → Confirm is disabled and nothing is sent", async () => {
    await renderPage();
    fireEvent.click(directionButton("OMT", "↓"));
    await waitFor(() => expect(mockSeen.payer).toBe("payout"));
    typeAmount("197");
    fireEvent.click(screen.getByTestId("mpi-customer-adds-over-cap"));
    expect(
      screen.getByRole("button", { name: /Record Receive/i }),
    ).toBeDisabled();
    submit();
    expect(mockAddOMTTransaction).not.toHaveBeenCalled();
  });

  it("a stale added change is not sent after the cashier flips to SEND", async () => {
    await renderPage();
    fireEvent.click(directionButton("OMT", "↓"));
    await waitFor(() => expect(mockSeen.payer).toBe("payout"));
    fireEvent.click(screen.getByTestId("mpi-customer-adds-3"));
    fireEvent.click(directionButton("OMT", "↑"));
    await waitFor(() => expect(mockSeen.payer).toBeUndefined());
    expect(mockSeen.counterFlow).toBeUndefined();
    expect(mockSeen.onAddedChange).toBeUndefined();
    typeAmount("100");
    fireEvent.click(screen.getByTestId("mpi-payout-exact"));
    fireEvent.click(screen.getByRole("button", { name: /Record Send/i }));

    const parsed = await sentPayload();
    expect(parsed.serviceType).toBe("SEND");
    expect(parsed.added_change_usd).toBeUndefined();
    expect(mockAddOMTTransaction.mock.calls[0][0]).not.toHaveProperty(
      "customerPayments",
    );
  });

  it("THROUGH partner (partner system tab): no section, no onAddedChange", async () => {
    mockPartnersGetAll.mockResolvedValue([
      { id: 7, name: "P", system_association: "WHISH", is_active: 1 },
    ]);
    await renderPage();
    fireEvent.click(directionButton("WHISH", "↓"));
    await waitFor(() => expect(mockSeen.payer).toBe("payout"));
    // No partner picked yet: the section is there…
    await waitFor(() => expect(mockSeen.counterFlow?.optional).toBe(true));
    // …and goes the moment one is.
    fireEvent.click(screen.getByTestId("pick-partner"));
    await waitFor(() => expect(mockSeen.counterFlow).toBeUndefined());
    expect(mockSeen.onAddedChange).toBeUndefined();
  });

  it("inside a session: no section, no onAddedChange", async () => {
    mockActiveSession = { id: 1 };
    await renderPage();
    fireEvent.click(directionButton("OMT", "↓"));
    await waitFor(() => expect(mockSeen.payer).toBe("payout"));
    expect(mockSeen.counterFlow).toBeUndefined();
    expect(mockSeen.onAddedChange).toBeUndefined();
  });

  it("WHISH fee $5 on top: the fee section allows added change; feePayments [Cash 8] + added_change_usd 3", async () => {
    mockPartnerSystem = "OMT";
    await renderPage();
    fireEvent.click(directionButton("WHISH", "↓"));
    await waitFor(() => expect(mockSeen.payer).toBe("payout"));
    typeAmount("100");
    fireEvent.change(
      document.getElementById("service-whish-fee") as HTMLInputElement,
      { target: { value: "5" } },
    );
    await waitFor(() =>
      expect(mockSeen.counterFlow).toEqual(
        expect.objectContaining({ totalAmount: 5, allowAddedChange: true }),
      ),
    );
    expect(mockSeen.counterFlow?.optional).toBeFalsy();
    fireEvent.click(screen.getByTestId("mpi-fee-plus-3"));
    submit();

    const parsed = await sentPayload();
    expect(parsed.feePayments).toEqual([
      { method: "CASH", currencyCode: "USD", amount: 8 },
    ]);
    expect(parsed.added_change_usd).toBe(3);
    expect(mockAddOMTTransaction.mock.calls[0][0]).not.toHaveProperty(
      "customerPayments",
    );
  });
});
