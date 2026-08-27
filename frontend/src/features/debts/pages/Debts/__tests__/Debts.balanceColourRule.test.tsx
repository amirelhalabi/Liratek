/** @jest-environment jsdom */

/**
 * Balance Pages colour audit (`docs/plans/todo_plans/BALANCE_PAGES_UX_AUDIT.md`),
 * owner's rule verbatim (2026-08-10): "Positive account should be green,
 * means shop owes the second party."
 *
 * Debts is the ONE page of the three (Debts/Suppliers/Partners) that already
 * satisfied this rule before the audit — its own field comment
 * (`netUsd`/`netLbp`, this file's index.tsx `:406-407` era) has always read
 * "positive = client owes shop, negative = shop owes client", and the
 * detail-header chip has always coloured negative GREEN. What the audit
 * found wrong here was narrower: the chip had NO epsilon, so an EXACTLY
 * settled client (`netUsd === 0`) fell through the `netUsd < 0 ? emerald :
 * red` ternary's `else` branch and rendered a red "-$0.00" — a false debt
 * on a fully paid account.
 *
 * This is an INTERACTION-layer test (rule 15/17) — it renders the REAL
 * Debts page against the REAL, unmodified balance-chip JSX and asserts the
 * rendered class, not a props-level shape.
 *
 * Rule 17 (failing-first): confirmed by temporarily reverting the chip's
 * className expression back to the pre-fix
 * `netUsd < 0 ? "text-emerald-400" : "text-red-400"` (no epsilon) — the
 * "exactly settled" case below then fails with:
 *   expect(received).toMatch(expected)
 *   Expected pattern: /text-slate-400/
 *   Received string:  "font-mono text-2xl font-bold text-red-400"
 * i.e. the exact bug the audit named (latent bug #2): a $0.00 balance reads
 * as red debt. Reverted back to the shared-helper fix after capturing this.
 * The shop-owes/they-owe cases below were already correct pre-fix (Debts'
 * polarity was never wrong) and pass unchanged either way — they're kept
 * here as the "did the epsilon fix accidentally invert the working cases"
 * guard, not as a fix-under-test on their own.
 */

import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import Debts from "../index";

const mockGetDebtors = jest.fn();
const mockGetClientDebtHistory = jest.fn();
const mockGetTransactionById = jest.fn();
const mockGetSaleItems = jest.fn();
const mockGetClientBalance = jest.fn();
const mockGetSale = jest.fn();

// Spread the REAL module first (`jest.requireActual`) — Debts imports the
// shared, presentation-only balance colour helpers (`BALANCE_EPS`/
// `balanceTextColor`/`combinedBalanceBucket`/`BALANCE_BORDER_COLOR`,
// `@liratek/ui`) that this test is actually exercising; a plain
// object-literal mock would turn them into `undefined`.
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

// `total_debt_usd`/`total_debt_lbp` (the debtor-SUMMARY fields, used only by
// the left-hand list's Ongoing/Closed/All filter) are set to match each
// scenario below so the mocked client isn't filtered out of the default
// "Ongoing" view before ever being auto-selected — the actual value under
// test is the SEPARATE `getClientBalance` (ledger) mock the chip reads.
function mockOneDebtor(totalDebtUsd: number) {
  mockGetDebtors.mockResolvedValue([
    {
      id: 1,
      full_name: "Jane Doe",
      phone_number: "71234567",
      total_debt: totalDebtUsd,
      total_debt_usd: totalDebtUsd,
      total_debt_lbp: 0,
    },
  ]);
  mockGetClientDebtHistory.mockResolvedValue([]);
}

describe("Debts page — balance chip colour (Balance Pages colour audit)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shop owes the client (negative netUsd) renders GREEN", async () => {
    mockOneDebtor(-10);
    mockGetClientBalance.mockResolvedValue({
      success: true,
      data: { balance_usd: -10, balance_lbp: 0 },
    });

    render(<Debts />);

    const amount = await screen.findByText("+$10.00");
    expect(amount.className).toMatch(/text-emerald-400/);
    expect(amount.className).not.toMatch(/text-red-400/);
  });

  it("the client owes the shop (positive netUsd) renders RED", async () => {
    mockOneDebtor(10);
    mockGetClientBalance.mockResolvedValue({
      success: true,
      data: { balance_usd: 10, balance_lbp: 0 },
    });

    render(<Debts />);

    const amount = await screen.findByText("-$10.00");
    expect(amount.className).toMatch(/text-red-400/);
    expect(amount.className).not.toMatch(/text-emerald-400/);
  });

  it("an exactly-settled client (netUsd === 0) renders NEUTRAL, not red", async () => {
    // total_debt_usd = 0 would be filtered OUT of the default "Ongoing"
    // list, so it would never get auto-selected in the first place — switch
    // to "All" first so a settled client is reachable at all (a real user
    // would land here from the "Closed"/"All" tab, not "Ongoing").
    mockOneDebtor(0);
    mockGetClientBalance.mockResolvedValue({
      success: true,
      data: { balance_usd: 0, balance_lbp: 0 },
    });

    render(<Debts />);
    fireEvent.change(screen.getByTestId("debt-filter-select"), {
      target: { value: "all" },
    });

    const amount = await screen.findByText("-$0.00");
    // This is the latent bug (audit #2): pre-fix, `netUsd < 0 ? emerald :
    // red` had no epsilon/neutral branch, so exactly 0 fell into the `red`
    // side. A fully settled client must never read as a red debt.
    expect(amount.className).not.toMatch(/text-red-400/);
    expect(amount.className).toMatch(/text-slate-400/);

    // The surrounding balance-chip border must agree (neutral, not
    // red-tinted or green-tinted) — same bug, the chip's own wrapper div.
    await waitFor(() => {
      const wrapper = amount.parentElement as HTMLElement;
      expect(wrapper.className).not.toMatch(/border-red-500/);
      expect(wrapper.className).not.toMatch(/border-emerald-500/);
      expect(wrapper.className).toMatch(/border-slate-700\/50/);
    });
  });
});
