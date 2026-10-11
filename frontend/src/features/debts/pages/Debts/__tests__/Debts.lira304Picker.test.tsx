/** @jest-environment jsdom */

/**
 * LIRA-304 T031 / T033 / T043 — the repayment screen's item picker and
 * "Goes to" preview, and the Accounts page's basket breakdown.
 *
 *  - the open items (basket items grouped under their session, separate
 *    visits alone) are listed with a tick box each;
 *  - "Goes to" shows the primary cash drawer's share, computed by the same
 *    allocation the server posts with — hidden when nothing goes there;
 *  - the ticked items reach the payload as `targets` (field names checked
 *    through addRepaymentSchema — rule 24);
 *  - a basket line on the Purchases list shows what is still open on each
 *    of its items.
 *
 * Not proven failing-first (written after the code).
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
const ACCOUNT = {
  code: "CUSTOMER_ACCOUNT",
  affects_drawer: 0,
  drawer_name: "General",
};
jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: [CASH, ACCOUNT],
    drawerAffectingMethods: [CASH],
    allMethods: [CASH, ACCOUNT],
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

it("lists the basket items under their session and the separate visit alone", async () => {
  await openSettle();
  expect(screen.getByTestId("debt-item-picker").textContent).toContain(
    "Session #2 basket",
  );
  expect(screen.getByTestId("debt-item-member-3")).toBeTruthy();
  expect(screen.getByTestId("debt-item-member-4")).toBeTruthy();
  expect(screen.getByTestId("debt-item-charge-2")).toBeTruthy();
});

it("Goes to: full $151 cash → OMT Cash Drawer $142 · General $9", async () => {
  await openSettle();
  fireEvent.click(screen.getByText("Cash 151"));
  const goes = await screen.findByTestId("repay-goes-to");
  expect(goes.textContent).toContain("OMT Cash Drawer");
  expect(goes.textContent).toContain("$142");
  expect(goes.textContent).toContain("$9");
});

// LIRA-308 (owner decisions 2026-10-11): every item opens TICKED, so
// "only X ticked" is reached by unticking the others (was: tick X).
const untick = async (testId: string) => {
  const box = screen.getByTestId(testId).querySelector("input")!;
  await waitFor(() => expect(box.checked).toBe(true));
  fireEvent.click(box);
};

it("Goes to is hidden when only a non-transfer item is ticked and paid", async () => {
  await openSettle();
  await untick("debt-item-member-3");
  await untick("debt-item-charge-2");
  fireEvent.click(screen.getByText("Cash 9"));
  await waitFor(() => expect(screen.queryByTestId("repay-goes-to")).toBeNull());
});

it("ticking the basket's OMT send sends it as a target and routes the $50", async () => {
  await openSettle();
  await untick("debt-item-member-4");
  await untick("debt-item-charge-2");
  fireEvent.click(screen.getByText("Cash 50"));
  expect((await screen.findByTestId("repay-goes-to")).textContent).toContain("$50");
  fireEvent.click(screen.getByText("Confirm Payment"));
  await waitFor(() => expect(mockAddRepayment).toHaveBeenCalledTimes(1));
  const parsed = addRepaymentSchema.parse(mockAddRepayment.mock.calls[0][0]);
  expect(parsed.targets).toEqual([{ kind: "member", id: 3 }]);
});

it("the basket line on the Purchases list shows what is still open per item", async () => {
  render(<Debts />);
  const box = await screen.findByTestId("basket-open-items-1");
  expect(box.textContent).toContain("Still open");
  expect(box.textContent).toContain("$101.00");
  expect(box.textContent).toContain("$9.00");
  expect(box.textContent).not.toContain("$41.00"); // separate visit, not in the basket
});
