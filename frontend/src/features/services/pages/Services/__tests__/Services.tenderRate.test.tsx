/** @jest-environment jsdom */

/**
 * Services page — the operator's TENDERED exchange rate must reach the backend
 * as `tender_exchange_rate`.
 *
 * `MultiPaymentInput` lets the operator edit "1 USD = X LBP" and converts the
 * tendered legs at THAT rate. The repository reconciles cross-currency legs at
 * `data.tender_exchange_rate` when present (within ±10% of the server rate —
 * moneyPosting.ts `resolveReconciliationRate`), and otherwise falls back to a
 * live DB lookup of the configured sell rate
 * (`FinancialServiceRepository`: `data.exchangeRate ?? getUsdLbpSellRate(db)`).
 *
 * Pre-fix, this page passed a rate DOWN to MultiPaymentInput for display and
 * sent NOTHING back up — a grep of index.tsx for `tender_exchange_rate`
 * returned zero hits, while SIX recharge components already forwarded it
 * (FinancialForm, TelecomForm, KatchForm, PaymentSheet, CardGridPayView,
 * OmtWhishAppTransferForm). So the operator's rate was silently discarded on
 * exactly the OMT/Whish system flows.
 *
 * Harmless when the tender currency equals the service currency (no
 * conversion happens). REAL for a cross-currency tender: a USD send paid with
 * an LBP leg was reconciled at the server rate rather than the rate the till
 * actually converted at, so a CORRECT payment could be hard-rejected. The
 * owner hit the cosmetic edge of this on 2026-07-30 — they tendered at 89,000
 * and the reconcile error reported `at rate 90000`.
 *
 * These tests MOUNT the page and assert the REAL submitted payload (the same
 * approach as Services.legsGate.test.tsx). That matters here specifically: a
 * "logic-replica" test that re-implements the payload expression inline cannot
 * catch this class of bug, because the defect is that the page never populates
 * the field at all.
 *
 * rule 17 — proven failing-first 2026-07-30: dropping the
 * `...(tenderExchangeRate !== undefined ? { tender_exchange_rate } : {})`
 * spread from `apiPayload` makes the first two tests red (payload.
 * tender_exchange_rate reads `undefined` instead of 91000 / 89000).
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
const mockPartnersGetAll = jest.fn().mockResolvedValue([]);

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    getOMTHistory: mockGetOMTHistory,
    getOMTAnalytics: mockGetOMTAnalytics,
    getSuppliers: mockGetSuppliers,
    getSupplierBalances: mockGetSupplierBalances,
    partners: { getAll: mockPartnersGetAll },
    addOMTTransaction: mockAddOMTTransaction,
  }),
  // Stub exposing BOTH callbacks the page wires: one button injects a payment
  // line, the others simulate the operator editing the rate field (the real
  // component fires onExchangeRateChange on mount AND on every edit).
  MultiPaymentInput: ({
    onChange,
    onExchangeRateChange,
  }: {
    onChange: (lines: unknown[]) => void;
    onExchangeRateChange?: (rate: number) => void;
  }) => (
    <div data-testid="stub-multi-payment-input">
      <button
        data-testid="mpi-inject-usd-cash"
        onClick={() =>
          onChange([
            { id: "L1", method: "CASH", currencyCode: "USD", amount: 100 },
          ])
        }
      />
      <button
        data-testid="mpi-edit-rate-91000"
        onClick={() => onExchangeRateChange?.(91000)}
      />
      <button
        data-testid="mpi-edit-rate-zero"
        onClick={() => onExchangeRateChange?.(0)}
      />
    </div>
  ),
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

// buyRate is what the page feeds MultiPaymentInput and what it falls back to.
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

/** Fill a $100 OMT INTRA SEND with one USD cash leg, then submit. */
async function submitSend() {
  fireEvent.change(
    document.getElementById("service-amount") as HTMLInputElement,
    { target: { value: "100" } },
  );
  fireEvent.click(screen.getByTestId("mpi-inject-usd-cash"));
  fireEvent.click(screen.getByRole("button", { name: /Record Send/i }));
  await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
  return mockAddOMTTransaction.mock.calls[0][0] as Record<string, unknown>;
}

describe("Services page — tendered exchange rate is forwarded", () => {
  beforeEach(() => {
    mockAddOMTTransaction.mockClear();
  });

  it("forwards the operator's EDITED rate as tender_exchange_rate", async () => {
    await renderPage();

    // Operator overrides "1 USD = X LBP" to 91,000 (server/buy rate is 89,000).
    fireEvent.click(screen.getByTestId("mpi-edit-rate-91000"));

    const payload = await submitSend();

    // The bug: pre-fix this key did not exist on the payload at all, so the
    // repository reconciled at its own live sell-rate lookup instead.
    expect(payload.tender_exchange_rate).toBe(91000);
  });

  it("falls back to the page's buyRate when the operator never edits the rate", async () => {
    await renderPage();

    const payload = await submitSend();

    // `effectiveRate ?? exchangeRate` — the rate MultiPaymentInput was seeded
    // with is still the rate the tender was converted at, so it is the honest
    // value to report. NOT undefined, and NOT the sellRate (89,500).
    expect(payload.tender_exchange_rate).toBe(89000);
  });

  it("omits the field entirely on a non-positive rate rather than poisoning reconciliation", async () => {
    await renderPage();

    // A 0 rate would make the core validator (z.number().positive()) reject
    // the whole transaction, and reconcileLegs trusts a tender rate as-is when
    // the server rate is not > 0. Omitting lets the repository's existing
    // live-sell-rate fallback apply instead.
    fireEvent.click(screen.getByTestId("mpi-edit-rate-zero"));

    const payload = await submitSend();

    expect(payload.tender_exchange_rate).toBeUndefined();
    expect("tender_exchange_rate" in payload).toBe(false);
  });
});
