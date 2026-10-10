/** @jest-environment jsdom */

/**
 * Web-mode guard for `loadServiceDebtDetails` (LIRA-297,
 * TRANSPORT_PARITY_AUDIT_PLAN.md §4, defect class C).
 *
 * The function used to open with `if (!window.api) return;` and then call
 * `window.api.transactions.getById` / `window.api.omt.*` directly, so in the
 * browser clicking the eye button on a "Service Debt" row did NOTHING — no
 * modal, no error. It now goes through the dual-mode adapter (`useApi()`).
 *
 * This test runs with `window.api` explicitly absent (the browser), clicks the
 * row's "View Transaction Details" button, and asserts the three adapter reads
 * happen and the detail modal opens with what they returned.
 *
 * Rule 17: NOT proven failing-first. The fix landed in 584e0d43 (2026-09-12)
 * before this guard was written, and re-breaking finished code to watch it
 * fail is forbidden. Statically, `yarn check:transport-parity` (rule C1) now
 * also refuses any `window.api` access in this file.
 *
 * Rule 25: `useApi` returns ONE module-scope object, never a fresh literal per
 * call — an unstable identity is exactly what production's singleton hides.
 */

import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import Debts from "../index";

const TRANSACTION_ID = 77; // unified transactions.id on the debt row
const FINANCIAL_SERVICE_ID = 4321; // financial_services.id it resolves to

const mockApi = {
  getDebtors: jest.fn(),
  getClientDebtHistory: jest.fn(),
  getTransactionById: jest.fn(),
  getFinancialServiceById: jest.fn(),
  getPaymentsByTransaction: jest.fn(),
  getSaleItems: jest.fn(),
  getClientBalance: jest.fn(),
  getCustomServiceById: jest.fn(),
  getSale: jest.fn(),
  cashOut: jest.fn(),
  addRepayment: jest.fn(),
  addAccountEntry: jest.fn(),
  getClientDebtTotal: jest.fn(),
};

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return {
    ...actual,
    useApi: () => mockApi,
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
    Select: () => null,
    ServiceTypeTabs: () => null,
    MultiPaymentInput: () => null,
    DataTable: <T,>({
      data,
      renderRow,
    }: {
      data: T[];
      renderRow: (item: T) => React.ReactNode;
    }) => (
      <table>
        <tbody>{data.map((item) => renderRow(item))}</tbody>
      </table>
    ),
  };
});

// The modal's own rendering is covered by ServiceDebtDetailModal.test.tsx;
// here we only need to know it opened, and with which records.
jest.mock("../../../components/ServiceDebtDetailModal", () => ({
  ServiceDebtDetailModal: ({
    financialService,
    payments,
    debtAmountUsd,
  }: {
    financialService: { id: number };
    payments: unknown[];
    debtAmountUsd: number;
  }) => (
    <div data-testid="service-debt-detail">
      fs:{financialService.id} payments:{payments.length} debt:
      {debtAmountUsd}
    </div>
  ),
}));

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

jest.mock("@/utils/logger", () => {
  const l = {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  };
  return { __esModule: true, default: l, logger: l };
});

describe("Debts page — service debt details on the WEB (no window.api)", () => {
  const originalApi = (window as unknown as { api?: unknown }).api;

  beforeEach(() => {
    jest.clearAllMocks();
    // The browser: there is no preload bridge at all.
    delete (window as unknown as { api?: unknown }).api;

    mockApi.getDebtors.mockResolvedValue([
      {
        id: 1,
        full_name: "Jane Doe",
        phone_number: "71234567",
        total_debt: 12,
        total_debt_usd: 12,
        total_debt_lbp: 0,
      },
    ]);
    mockApi.getClientDebtHistory.mockResolvedValue([
      {
        id: 300,
        client_id: 1,
        transaction_id: TRANSACTION_ID,
        transaction_type: "Service Debt",
        amount_usd: 12,
        amount_lbp: 0,
        note: "OMT transfer on account",
        created_at: "2026-10-01 10:00:00",
        created_by: null,
        session_id: null,
      },
    ]);
    mockApi.getClientBalance.mockResolvedValue({
      success: true,
      data: { balance_usd: 12, balance_lbp: 0 },
    });
    mockApi.getTransactionById.mockImplementation(async (id: number) =>
      id === TRANSACTION_ID
        ? {
            id,
            source_table: "financial_services",
            source_id: FINANCIAL_SERVICE_ID,
          }
        : null,
    );
    mockApi.getFinancialServiceById.mockImplementation(async (id: number) =>
      id === FINANCIAL_SERVICE_ID ? { id, currency: "USD", amount: 12 } : null,
    );
    mockApi.getPaymentsByTransaction.mockResolvedValue([
      { id: 1, method: "DEBT", currency_code: "USD", amount: 12 },
    ]);
  });

  afterAll(() => {
    (window as unknown as { api?: unknown }).api = originalApi;
  });

  it("clicking a Service Debt row opens the detail modal through useApi()", async () => {
    expect((window as unknown as { api?: unknown }).api).toBeUndefined();

    render(<Debts />);
    fireEvent.click(await screen.findByTitle("View Transaction Details"));

    const modal = await screen.findByTestId("service-debt-detail");
    expect(modal).toHaveTextContent(`fs:${FINANCIAL_SERVICE_ID}`);
    expect(modal).toHaveTextContent("payments:1");
    expect(modal).toHaveTextContent("debt:12");

    await waitFor(() => {
      expect(mockApi.getTransactionById).toHaveBeenCalledWith(TRANSACTION_ID);
    });
    expect(mockApi.getFinancialServiceById).toHaveBeenCalledWith(
      FINANCIAL_SERVICE_ID,
    );
    expect(mockApi.getPaymentsByTransaction).toHaveBeenCalledWith(
      TRANSACTION_ID,
    );
  });
});
