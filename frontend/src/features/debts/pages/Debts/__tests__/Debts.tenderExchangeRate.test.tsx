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
 * `repayModalRate` into the outgoing payload on BOTH submit paths, which
 * both always go through the dual-mode adapter (rule 19 — no
 * `window.api ? … : …` transport gate lives in the component):
 *   1. `api.addRepayment` — repayment
 *   2. `api.cashOut` — credit cash-out
 *
 * Confirmed failing-first (rule 17): temporarily reverting the
 * `tender_exchange_rate` payload edits in Debts/index.tsx (while leaving the
 * type-only plumbing in preload.ts/electron.d.ts/packages/ui/types.ts alone)
 * makes every `tender_exchange_rate` assertion below fail — the field comes
 * back `undefined` because nothing read `repayModalRate` into the payload.
 * The mock rate here (93000) is deliberately DIFFERENT from the
 * `useSellRate` mock's `buyRate` (89000, `EXCHANGE_RATE`'s fallback), so a
 * "fix" that stamped the live snapshot instead of the operator's edited rate
 * would also be caught.
 *
 * CORRECTED 2026-09-12: this file used to assert a THIRD path —
 * `window.api.debt.addRepayment` called directly whenever `window.api` was
 * present — and asserted the outgoing payload in snake_case
 * (`client_id`/`amount_usd`). Both were wrong. `addRepaymentSchema`
 * (packages/core/src/validators/debt.ts) has always spoken camelCase
 * (`clientId`/`amountUSD`/`amountLBP`); the snake_case assertion encoded the
 * very "Invalid input: expected number, received undefined" bug that the
 * component's payload unification fixed (see the comment above the
 * `api.addRepayment(...)` call in Debts/index.tsx). And the direct-
 * `window.api` branch doesn't exist in the component at all — there is
 * exactly one call site per action (`api.addRepayment` / `api.cashOut`),
 * and the dual-mode adapter, not the component, decides IPC vs REST. See
 * each test below for what changed and why.
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

  // BEFORE: asserted `payload.client_id` / `payload.amount_usd` (snake_case).
  // That encoded the original Settle Debt defect, not correct behaviour —
  // `addRepaymentSchema` has always spoken camelCase. The Debts page used to
  // pick its payload shape per transport, so the REST branch sent
  // `client_id`/`amount_usd`, which the camelCase schema read as
  // `clientId: undefined` and rejected with "Invalid input: expected
  // number, received undefined" — a modal the operator had already filled
  // in, rejected for a reason naming no field.
  // AFTER: asserts `payload.clientId` / `payload.amountUSD`, the shape the
  // component actually sends and the schema actually accepts. Do not
  // "restore" the snake_case form — it is the bug, not a valid alternative.
  it("stamps the operator's rate on the api.addRepayment payload (window.api absent)", async () => {
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
    expect(payload.clientId).toBe(1);
    expect(payload.amountUSD).toBe(10);
  });

  // BEFORE: this test set `window.api.debt.addRepayment` and asserted the
  // component called it DIRECTLY whenever `window.api` was present — i.e.
  // that Debts/index.tsx still branched `window.api ? IPC : REST`, the
  // pattern rule 19(a) forbids. That branch was deliberately removed: the
  // component always calls `api.addRepayment(...)` through the dual-mode
  // adapter now (see the comment above that call in Debts/index.tsx), and
  // `ipcOrHttp` inside the adapter is the only place that picks IPC vs
  // REST. The old test's premise was dead code, so `mockWindowAddRepayment`
  // was never called and the test timed out.
  // AFTER: proves the thing the old test was actually reaching for — the
  // rate is stamped whichever transport is in play, guaranteed here by
  // there being exactly one call site — AND keeps a genuine rule-19
  // regression guard: even with `window.api` defined (simulating the
  // desktop environment), the component must still go through
  // `api.addRepayment` and must NEVER call `window.api.debt.addRepayment`
  // directly.
  it("stamps the operator's rate on api.addRepayment even when window.api is present, and never calls window.api.debt.addRepayment directly", async () => {
    const mockWindowAddRepayment = jest
      .fn()
      .mockResolvedValue({ success: true, id: 1 });
    (window as any).api = {
      debt: {
        addRepayment: mockWindowAddRepayment,
      },
    };
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
    expect(payload.clientId).toBe(1);
    expect(payload.amountUSD).toBe(10);
    expect(mockWindowAddRepayment).not.toHaveBeenCalled();
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
