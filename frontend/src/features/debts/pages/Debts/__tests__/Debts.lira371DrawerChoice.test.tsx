/** @jest-environment jsdom */

/**
 * LIRA-371 T017 — Debts → Repay: "OMT Cash Drawer | General" inside the
 * "Goes to" box. Shown only when the default allocation routes cash to the
 * system cash drawer; General shows all the cash under General; the single
 * payload carries `cashDrawer` only when the choice is shown (field names
 * checked through addRepaymentSchema — rule 24). Stable useApi mock (rule 25).
 */

import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { addRepaymentSchema } from "@liratek/core";
import Debts from "../index";

const mockGetDebtors = jest.fn();
const mockGetClientDebtHistory = jest.fn();
const mockGetClientBalance = jest.fn();
const mockGetClientDebtTotal = jest.fn();
const mockAddRepayment = jest.fn();
const mockGetOpenDebtItems = jest.fn();

const mockApi = {
  getDebtors: (...a: unknown[]) => mockGetDebtors(...a),
  getClientDebtHistory: (...a: unknown[]) => mockGetClientDebtHistory(...a),
  getClientBalance: (...a: unknown[]) => mockGetClientBalance(...a),
  getClientDebtTotal: (...a: unknown[]) => mockGetClientDebtTotal(...a),
  addRepayment: (...a: unknown[]) => mockAddRepayment(...a),
  getOpenDebtItems: (...a: unknown[]) => mockGetOpenDebtItems(...a),
  cashOut: jest.fn(),
  addAccountEntry: jest.fn(),
  getTransactionById: jest.fn(),
  getSaleItems: jest.fn(),
  getCustomServiceById: jest.fn(),
  getSale: jest.fn(),
};

interface MpiProps {
  onChange: (lines: unknown[]) => void;
}

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return {
    ...actual,
    useApi: () => mockApi,
    appEvents: { emit: jest.fn() },
    CounterpartySettleModal: ({
      onConfirm,
      confirmLabel,
      multiPaymentInput,
      beforeContent,
      children,
    }: {
      onConfirm: () => void;
      confirmLabel: string;
      multiPaymentInput: MpiProps;
      beforeContent?: ReactNode;
      children?: ReactNode;
    }) => (
      <div data-testid="settle-modal">
        {beforeContent}
        {[151, 50, 9].map((amount) => (
          <button
            key={amount}
            type="button"
            onClick={() =>
              multiPaymentInput.onChange([
                { id: "1", method: "CASH", currencyCode: "USD", amount },
              ])
            }
          >
            {`Cash ${amount}`}
          </button>
        ))}
        <button
          type="button"
          onClick={() =>
            multiPaymentInput.onChange([
              { id: "1", method: "WHISH", currencyCode: "USD", amount: 151 },
            ])
          }
        >
          Whish 151
        </button>
        {children}
        <button type="button" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    ),
    PageHeader: ({ title, actions }: { title: string; actions?: ReactNode }) => (
      <div>
        <h1>{title}</h1>
        {actions}
      </div>
    ),
    Select: () => null,
    ServiceTypeTabs: () => null,
    MultiPaymentInput: () => null,
  };
});

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, username: "admin", role: "admin" } }),
}));
jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 89500, buyRate: 89000, isLoading: false }),
}));
const CASH = { code: "CASH", affects_drawer: 1, drawer_name: "General" };
const WHISH = { code: "WHISH", affects_drawer: 1, drawer_name: "Whish_App" };
const ACCOUNT = {
  code: "CUSTOMER_ACCOUNT",
  affects_drawer: 0,
  drawer_name: "General",
};
jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: [CASH, WHISH, ACCOUNT],
    drawerAffectingMethods: [CASH, WHISH],
    allMethods: [CASH, WHISH, ACCOUNT],
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
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

const DEBTOR = {
  id: 2,
  full_name: "Goes To Demo",
  phone_number: "03999222",
  total_debt: 151,
  total_debt_usd: 151,
  total_debt_lbp: 0,
};

const ITEMS = [
  {
    kind: "member",
    id: 3,
    rowId: 1,
    createdAt: "2026-10-10 23:26:58",
    openUsd: 101,
    openLbp: 0,
    routingCap: { usd: 101, lbp: 0 },
    label: "OMT SEND: Goes To Demo — $101",
    type: "FINANCIAL_SERVICE",
    sessionId: 2,
    isPrimary: true,
    primaryDrawer: "OMT_System",
  },
  {
    kind: "member",
    id: 4,
    rowId: 1,
    createdAt: "2026-10-10 23:26:58",
    openUsd: 9,
    openLbp: 0,
    routingCap: null,
    label: "Custom Service: Netflix Premium 1 Month",
    type: "CUSTOM_SERVICE",
    sessionId: 2,
    isPrimary: false,
    primaryDrawer: null,
  },
  {
    kind: "charge",
    id: 2,
    rowId: 2,
    createdAt: "2026-10-10 23:27:36",
    openUsd: 41,
    openLbp: 0,
    routingCap: { usd: 41, lbp: 0 },
    label: "OMT SEND: Goes To Demo — $41",
    type: "FINANCIAL_SERVICE",
    sessionId: null,
    isPrimary: true,
    primaryDrawer: "OMT_System",
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockGetDebtors.mockResolvedValue([DEBTOR]);
  mockGetClientDebtHistory.mockResolvedValue([
    {
      id: 1,
      client_id: 2,
      transaction_id: null,
      transaction_type: "Session Debt",
      amount_usd: 110,
      amount_lbp: 0,
      note: "Session #2 basket",
      created_at: "2026-10-10 23:26:58",
      created_by: 1,
      session_id: 2,
      is_refunded: 0,
    },
  ]);
  mockGetClientDebtTotal.mockResolvedValue(151);
  mockGetClientBalance.mockResolvedValue({
    success: true,
    data: { balance_usd: 151, balance_lbp: 0 },
  });
  mockGetOpenDebtItems.mockResolvedValue(ITEMS);
  mockAddRepayment.mockResolvedValue({ success: true, id: 1 });
});

async function openSettle() {
  render(<Debts />);
  fireEvent.click(await screen.findByText("Settle Debt"));
  await screen.findByTestId("debt-item-picker");
}

const untick = async (testId: string) => {
  const box = screen.getByTestId(testId).querySelector("input")!;
  await waitFor(() => expect(box.checked).toBe(true));
  fireEvent.click(box);
};

async function submitted() {
  fireEvent.click(screen.getByText("Confirm Payment"));
  await waitFor(() => expect(mockAddRepayment).toHaveBeenCalledTimes(1));
  return addRepaymentSchema.parse(mockAddRepayment.mock.calls[0][0]);
}

it("shows the choice, OMT selected, when cash pays an OMT transfer", async () => {
  await openSettle();
  fireEvent.click(screen.getByText("Cash 151"));
  const goes = await screen.findByTestId("repay-goes-to");
  expect(goes.querySelector('[data-testid="cash-drawer-choice"]')).toBeTruthy();
  expect(screen.getByTestId("cash-drawer-choice-system")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.getByTestId("cash-drawer-choice-system").textContent).toBe(
    "OMT Cash Drawer",
  );
});

it("is hidden when only a non-transfer item is paid", async () => {
  await openSettle();
  await untick("debt-item-member-3");
  await untick("debt-item-charge-2");
  fireEvent.click(screen.getByText("Cash 9"));
  await waitFor(() =>
    expect(screen.queryByTestId("cash-drawer-choice")).toBeNull(),
  );
});

it("is hidden for a wallet-only payment", async () => {
  await openSettle();
  fireEvent.click(screen.getByText("Whish 151"));
  await waitFor(() =>
    expect(screen.queryByTestId("cash-drawer-choice")).toBeNull(),
  );
});

it("General shows all the cash under General, and no system line", async () => {
  await openSettle();
  fireEvent.click(screen.getByText("Cash 151"));
  fireEvent.click(await screen.findByTestId("cash-drawer-choice-general"));
  await waitFor(() =>
    expect(screen.queryByTestId("repay-goes-to-system")).toBeNull(),
  );
  expect(screen.getByTestId("repay-goes-to-general").textContent).toContain(
    "$151",
  );
});

it("the payload carries cashDrawer GENERAL after picking General", async () => {
  await openSettle();
  fireEvent.click(screen.getByText("Cash 151"));
  fireEvent.click(await screen.findByTestId("cash-drawer-choice-general"));
  expect((await submitted()).cashDrawer).toBe("GENERAL");
});

it("the payload carries cashDrawer SYSTEM with the default", async () => {
  await openSettle();
  fireEvent.click(screen.getByText("Cash 151"));
  await screen.findByTestId("cash-drawer-choice");
  expect((await submitted()).cashDrawer).toBe("SYSTEM");
});

it("no choice shown → no cashDrawer key", async () => {
  await openSettle();
  fireEvent.click(screen.getByText("Whish 151"));
  await waitFor(() =>
    expect(screen.queryByTestId("cash-drawer-choice")).toBeNull(),
  );
  fireEvent.click(screen.getByText("Confirm Payment"));
  await waitFor(() => expect(mockAddRepayment).toHaveBeenCalledTimes(1));
  expect("cashDrawer" in mockAddRepayment.mock.calls[0][0]).toBe(false);
});
