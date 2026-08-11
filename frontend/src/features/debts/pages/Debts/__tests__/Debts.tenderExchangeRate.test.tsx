/** @jest-environment jsdom */

/**
 * Regression test for the `tender_exchange_rate` stamp field (owner decision
 * 2026-08-08, repro: buy 89,000 vs. sell 90,000 — same gap already fixed for
 * FinancialServiceRepository/RechargeRepository). `packages/core/src/validators/debt.ts`'s
 * `addRepaymentSchema`/`debtCashOutSchema` both carry an optional
 * `tender_exchange_rate: number` so `transactions.exchange_rate` reflects the
 * rate the operator actually tendered at (`repayModalRate`, fed by
 * MultiPaymentInput's `onExchangeRateChange` in the repayment/cash-out
 * payment sheet) instead of always falling back to the live market-rate
 * snapshot (`EXCHANGE_RATE` = `buyRate`).
 *
 * This proves `handleProcessRepayment` (Debts/index.tsx) forwards
 * `repayModalRate` into the outgoing payload on ALL THREE submit paths:
 *   1. `api.addRepayment` — the dual-mode/REST-shaped branch (window.api absent)
 *   2. `window.api.debt.addRepayment` — the IPC-shaped branch (window.api present)
 *   3. `api.cashOut` — the credit cash-out branch
 *
 * Confirmed failing-first (rule 17): temporarily reverting the 3
 * `tender_exchange_rate` payload edits in Debts/index.tsx (while leaving the
 * type-only plumbing in preload.ts/electron.d.ts/packages/ui/types.ts alone)
 * makes every `tender_exchange_rate` assertion below fail — the field comes
 * back `undefined` because nothing read `repayModalRate` into the payload.
 * The mock rate here (93000) is deliberately DIFFERENT from the
 * `useSellRate` mock's `buyRate` (89000, `EXCHANGE_RATE`'s fallback), so a
 * "fix" that stamped the live snapshot instead of the operator's edited rate
 * would also be caught.
 */

import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import Debts from "../index";

const mockGetDebtors = jest.fn();
const mockGetClientDebtHistory = jest.fn();
const mockGetClientBalance = jest.fn();
const mockGetClientDebtTotal = jest.fn();
const mockAddRepayment = jest.fn();
const mockCashOut = jest.fn();
const mockAppEventsEmit = jest.fn();

// Spread the REAL module first (`jest.requireActual`) — Debts also imports
// the shared, presentation-only balance colour helpers (`BALANCE_EPS`/
// `balanceTextColor`/`combinedBalanceBucket`/`BALANCE_BORDER_COLOR`,
// `@liratek/ui`, Balance Pages colour audit 2026-08-11), which a plain
// object-literal mock like the old one here would silently turn into
// `undefined` (a `TypeError` at render). Only the pieces below need
// stubbing — everything else stays real.
jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return {
    ...actual,
    useApi: () => ({
      getDebtors: mockGetDebtors,
      getClientDebtHistory: mockGetClientDebtHistory,
      getClientBalance: mockGetClientBalance,
      getClientDebtTotal: mockGetClientDebtTotal,
      addRepayment: mockAddRepayment,
      cashOut: mockCashOut,
      addAccountEntry: jest.fn(),
      getTransactionById: jest.fn(),
      getSaleItems: jest.fn(),
      getCustomServiceById: jest.fn(),
      getSale: jest.fn(),
    }),
    // Wrapped in a closure (like `useApi: () => ({...})` below) rather than
    // referenced directly — a direct `{ emit: mockAppEventsEmit }` property is
    // evaluated immediately when this factory runs (require-time, before this
    // file's own `const mockAppEventsEmit = jest.fn()` line has executed —
    // jest.mock() calls are hoisted above imports, but plain `const`
    // declarations are not), which throws a TDZ ReferenceError.
    appEvents: { emit: (...args: unknown[]) => mockAppEventsEmit(...args) },
    // CounterpartySettleModal (which internally renders MultiPaymentInput) is
    // stubbed with a minimal stand-in that exposes the exact same callback
    // props Debts/index.tsx wires up — `onExchangeRateChange` is the identical
    // prop the real MultiPaymentInput invokes when the operator edits the
    // split-header rate. What's under test is Debts' own payload-building
    // code, not MultiPaymentInput's UI (already covered elsewhere).
    CounterpartySettleModal: ({
      onConfirm,
      confirmLabel,
      multiPaymentInput,
    }: {
      onConfirm: () => void;
      confirmLabel: string;
      multiPaymentInput: {
        onChange: (lines: unknown[]) => void;
        onExchangeRateChange: (rate: number) => void;
      };
    }) => (
      <div data-testid="settle-modal">
        <button
          type="button"
          onClick={() => multiPaymentInput.onExchangeRateChange(93000)}
        >
          Set Rate
        </button>
        <button
          type="button"
          onClick={() =>
            multiPaymentInput.onChange([
              { id: "1", method: "Cash", currencyCode: "USD", amount: 10 },
            ])
          }
        >
          Set Lines
        </button>
        <button type="button" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    ),
    PageHeader: ({
      title,
      actions,
    }: {
      title: string;
      actions?: React.ReactNode;
    }) => (
      <div data-testid="page-header">
        <h1>{title}</h1>
        {actions}
      </div>
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
      <select
        data-testid="debt-filter-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    ),
    ServiceTypeTabs: () => null,
    MultiPaymentInput: () => null,
    DataTable: <T,>({
      data,
      renderRow,
      emptyMessage,
    }: {
      data: T[];
      renderRow: (item: T) => React.ReactNode;
      emptyMessage?: string;
    }) => (
      <table>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td>{emptyMessage}</td>
            </tr>
          ) : (
            data.map((item) => renderRow(item))
          )}
        </tbody>
      </table>
    ),
  };
});

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, username: "admin", role: "admin" } }),
}));

// buyRate (89000) is EXCHANGE_RATE's fallback — deliberately different from
// the 93000 the tests below feed through "Set Rate", so a payload that
// stamped the fallback instead of the operator's rate is also caught.
jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 89500, buyRate: 89000, isLoading: false }),
}));

jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: [],
    drawerAffectingMethods: [],
    allMethods: [],
    loading: false,
    refresh: jest.fn(),
  }),
}));

jest.mock("@/shared/hooks/useModalFocusFix", () => ({
  useModalFocusFix: () => {},
}));

jest.mock("@/api/backendApi", () => ({
  getDebtAging: jest.fn().mockResolvedValue(null),
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
  logger: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

// "ongoing" (the default debt filter) keys off the debtor SUMMARY's raw
// total_debt_usd, not the ledger balance the tests below control per
// scenario — kept positive here so the client is never filtered out.
const DEBTOR = {
  id: 1,
  full_name: "Jane Doe",
  phone_number: "71234567",
  total_debt: 10,
  total_debt_usd: 10,
  total_debt_lbp: 0,
};

describe("Debts page — tender_exchange_rate propagation (owner decision 2026-08-08)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete (window as any).api;

    mockGetDebtors.mockResolvedValue([DEBTOR]);
    mockGetClientDebtHistory.mockResolvedValue([]);
    mockGetClientDebtTotal.mockResolvedValue(0);
  });

  afterEach(() => {
    delete (window as any).api;
  });

  it("stamps the operator's rate on the REST-shaped api.addRepayment payload (window.api absent)", async () => {
    mockGetClientBalance.mockResolvedValue({
      success: true,
      data: { balance_usd: 10, balance_lbp: 0 },
    });
    mockAddRepayment.mockResolvedValue({ success: true, id: 1 });

    render(<Debts />);

    fireEvent.click(await screen.findByText("Settle Debt"));
    fireEvent.click(screen.getByText("Set Rate"));
    fireEvent.click(screen.getByText("Set Lines"));
    fireEvent.click(screen.getByText("Confirm Payment"));

    await waitFor(() => expect(mockAddRepayment).toHaveBeenCalled());
    const payload = mockAddRepayment.mock.calls[0][0];
    expect(payload.tender_exchange_rate).toBe(93000);
    expect(payload.client_id).toBe(1);
    expect(payload.amount_usd).toBe(10);
  });

  it("stamps the operator's rate on the IPC-shaped window.api.debt.addRepayment payload", async () => {
    const mockWindowAddRepayment = jest
      .fn()
      .mockResolvedValue({ success: true, id: 1 });
    (window as any).api = {
      debt: {
        getDebtors: jest.fn().mockResolvedValue([DEBTOR]),
        getClientHistory: jest.fn().mockResolvedValue([]),
        addRepayment: mockWindowAddRepayment,
        getClientBalance: jest.fn().mockResolvedValue({
          success: true,
          data: { balance_usd: 0, balance_lbp: 0 },
        }),
      },
    };
    // loadLedgerBalance always goes through the dual-mode `api` adapter
    // (never the raw window.api), regardless of the IPC/REST branch under
    // test here — see Debts/index.tsx's loadLedgerBalance.
    mockGetClientBalance.mockResolvedValue({
      success: true,
      data: { balance_usd: 10, balance_lbp: 0 },
    });

    render(<Debts />);

    fireEvent.click(await screen.findByText("Settle Debt"));
    fireEvent.click(screen.getByText("Set Rate"));
    fireEvent.click(screen.getByText("Set Lines"));
    fireEvent.click(screen.getByText("Confirm Payment"));

    await waitFor(() => expect(mockWindowAddRepayment).toHaveBeenCalled());
    const payload = mockWindowAddRepayment.mock.calls[0][0];
    expect(payload.tender_exchange_rate).toBe(93000);
    expect(payload.clientId).toBe(1);
    expect(payload.amountUSD).toBe(10);
  });

  it("stamps the operator's rate on the api.cashOut payload", async () => {
    mockGetClientBalance.mockResolvedValue({
      success: true,
      data: { balance_usd: -10, balance_lbp: 0 },
    });
    mockCashOut.mockResolvedValue({ success: true, id: 1 });

    render(<Debts />);

    fireEvent.click(await screen.findByText("Cash Out"));
    fireEvent.click(screen.getByText("Set Rate"));
    fireEvent.click(screen.getByText("Set Lines"));
    fireEvent.click(screen.getByText("Confirm Payment"));

    await waitFor(() => expect(mockCashOut).toHaveBeenCalled());
    const payload = mockCashOut.mock.calls[0][0];
    expect(payload.tender_exchange_rate).toBe(93000);
    expect(payload.clientId).toBe(1);
    expect(payload.amountUSD).toBe(10);
  });
});
