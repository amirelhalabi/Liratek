/** @jest-environment jsdom */

/**
 * Debts page — Purchases table refunded-row display (LIRA-131).
 *
 * `debt_ledger` is in `TransactionRepository._markSourceRefunded`'s
 * supported-tables whitelist (migration v68) — a void/refund of a debt entry
 * correctly sets `is_refunded = 1` / `refunded_at`. The badge JSX in
 * Debts/index.tsx's Purchases-table `renderRow` already existed
 * (`isRefunded = Boolean(item.is_refunded)`) — it just never had real data
 * to key off, because `DebtRepository.getColumns()` never projected either
 * column (fixed in this same change). This test proves the READ path (the
 * only thing this ticket touches): a refunded row renders the badge, a live
 * row does not.
 *
 * Rule 17 (failing-first): reverting DebtRepository.getColumns() to omit
 * is_refunded/refunded_at (the pre-fix column list) makes
 * `DebtRepository.refundedRead.test.ts` fail with `received: undefined` —
 * confirmed manually, then reverted (see task report). This frontend test
 * additionally proves the interaction layer: the badge JSX itself was never
 * exercised by a backend-only test, per the class of bug this ticket
 * documents (LIRA-119/121/122/129/130).
 */

import { render, screen, waitFor } from "@testing-library/react";
import Debts from "../index";

const REFUNDED_NOTE = "Refunded manual charge";
const LIVE_NOTE = "Live manual charge";

const mockGetDebtors = jest.fn();
const mockGetClientDebtHistory = jest.fn();
const mockGetTransactionById = jest.fn();
const mockGetSaleItems = jest.fn();
const mockGetClientBalance = jest.fn();
const mockGetSale = jest.fn();

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
      getTransactionById: mockGetTransactionById,
      getSaleItems: mockGetSaleItems,
      getClientBalance: mockGetClientBalance,
      getCustomServiceById: jest.fn(),
      getSale: mockGetSale,
      cashOut: jest.fn(),
      addRepayment: jest.fn(),
      addAccountEntry: jest.fn(),
      getClientDebtTotal: jest.fn(),
    }),
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

describe("Debts page — Purchases table refunded badge (LIRA-131)", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockGetDebtors.mockResolvedValue([
      {
        id: 1,
        full_name: "Jane Doe",
        phone_number: "71234567",
        total_debt: 10,
        total_debt_usd: 10,
        total_debt_lbp: 0,
      },
    ]);

    // Shaped exactly like the FIXED DebtRepository.findClientHistory() now
    // returns rows — is_refunded/refunded_at present, one refunded, one not.
    // "Manual Debt" avoids the Sale Debt item-name enrichment fetch, which
    // is orthogonal to the read-path bug under test here.
    mockGetClientDebtHistory.mockResolvedValue([
      {
        id: 300,
        client_id: 1,
        transaction_id: 500,
        transaction_type: "Manual Debt",
        amount_usd: 15,
        amount_lbp: 0,
        note: REFUNDED_NOTE,
        created_at: "2026-08-10 20:00:00",
        created_by: 1,
        session_id: null,
        is_refunded: 1,
        refunded_at: "2026-08-10 21:00:00",
      },
      {
        id: 301,
        client_id: 1,
        transaction_id: 501,
        transaction_type: "Manual Debt",
        amount_usd: 8,
        amount_lbp: 0,
        note: LIVE_NOTE,
        created_at: "2026-08-10 19:00:00",
        created_by: 1,
        session_id: null,
        is_refunded: 0,
        refunded_at: null,
      },
    ]);

    mockGetClientBalance.mockResolvedValue({
      success: true,
      data: { balance_usd: 23, balance_lbp: 0 },
    });
  });

  it("shows a Refunded badge on the refunded purchase row and NOT on the live row", async () => {
    render(<Debts />);

    await waitFor(() => screen.getByText(REFUNDED_NOTE));
    await waitFor(() => screen.getByText(LIVE_NOTE));

    const refundedRow = screen.getByText(REFUNDED_NOTE).closest("tr");
    const liveRow = screen.getByText(LIVE_NOTE).closest("tr");
    expect(refundedRow).not.toBeNull();
    expect(liveRow).not.toBeNull();

    const withinRefunded = refundedRow!.querySelectorAll("span");
    const refundedTexts = Array.from(withinRefunded).map((s) => s.textContent);
    expect(refundedTexts).toContain("Refunded");

    const withinLive = liveRow!.querySelectorAll("span");
    const liveTexts = Array.from(withinLive).map((s) => s.textContent);
    expect(liveTexts).not.toContain("Refunded");
  });
});
