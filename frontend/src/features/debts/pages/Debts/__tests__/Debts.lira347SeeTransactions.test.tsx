/** @jest-environment jsdom */

/**
 * "See transactions" (owner mock 2026-10-26 §7) on the Debts repayment
 * calendar (LIRA-347): a "See transactions (N)" pill under the month line
 * opens a table of the picked days' items (paid ones too) under the
 * calendar; unticking an item there is the calendar's own untick, so the
 * picker's ticks, the amount and the payload follow.
 *
 * Failing-first (rule 17): written before the calendar wired the panel.
 * Mock setup copied from `Debts.lira347Days.test.tsx`; ONE stable useApi
 * object (rule 25); payload names read through addRepaymentSchema (rule 24).
 */

import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { addRepaymentSchema } from "@liratek/core";
import Debts from "../index";

const mockGetDebtors = jest.fn();
const mockGetClientDebtHistory = jest.fn();
const mockGetClientBalance = jest.fn();
const mockGetClientDebtTotal = jest.fn();
const mockAddRepayment = jest.fn();
const mockGetOpenDebtItems = jest.fn();
const mockGetDebtMonthRows = jest.fn();

const mockApi = {
  getDebtors: (...a: unknown[]) => mockGetDebtors(...a),
  getClientDebtHistory: (...a: unknown[]) => mockGetClientDebtHistory(...a),
  getClientBalance: (...a: unknown[]) => mockGetClientBalance(...a),
  getClientDebtTotal: (...a: unknown[]) => mockGetClientDebtTotal(...a),
  addRepayment: (...a: unknown[]) => mockAddRepayment(...a),
  getOpenDebtItems: (...a: unknown[]) => mockGetOpenDebtItems(...a),
  getDebtMonthRows: (...a: unknown[]) => mockGetDebtMonthRows(...a),
  cashOut: jest.fn(),
  addAccountEntry: jest.fn(),
  getTransactionById: jest.fn(),
  getSaleItems: jest.fn(),
  getCustomServiceById: jest.fn(),
  getSale: jest.fn(),
};

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return {
    ...actual,
    useApi: () => mockApi,
    appEvents: { emit: jest.fn() },
    PageHeader: ({
      title,
      actions,
    }: {
      title: string;
      actions?: ReactNode;
    }) => (
      <div>
        <h1>{title}</h1>
        {actions}
      </div>
    ),
    Select: () => null,
    ServiceTypeTabs: () => null,
  };
});

// The shop's today on this device (rule 27), pinned for the test.
jest.mock("@/shared/utils/localDay", () => ({
  ...jest.requireActual("@/shared/utils/localDay"),
  localDay: () => "2026-10-26",
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, username: "admin", role: "admin" } }),
}));
jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 89500, buyRate: 89000, isLoading: false }),
}));
const CASH = {
  code: "CASH",
  label: "Cash",
  affects_drawer: 1,
  drawer_name: "General",
};
const ACCOUNT = {
  code: "CUSTOMER_ACCOUNT",
  label: "Customer Account",
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

const SALE = {
  kind: "sale",
  id: 5,
  rowId: 5,
  createdAt: "2026-10-20 09:00:00",
  shopDay: "2026-10-20",
  openUsd: 50,
  openLbp: 0,
  label: "Sale #5: Charger",
  type: "SALE",
  sessionId: null,
  isPrimary: false,
  primaryDrawer: null,
};
const LOTO = {
  kind: "charge",
  id: 11,
  rowId: 11,
  createdAt: "2026-10-22 09:00:00",
  shopDay: "2026-10-22",
  openUsd: 40,
  openLbp: 0,
  routingCap: null,
  label: "Loto ticket — $40",
  type: "LOTO",
  sessionId: null,
  isPrimary: false,
  primaryDrawer: null,
};
const OMT = {
  kind: "charge",
  id: 12,
  rowId: 12,
  createdAt: "2026-10-05 09:00:00",
  shopDay: "2026-10-05",
  openUsd: 101,
  openLbp: 0,
  routingCap: { usd: 101, lbp: 0 },
  label: "OMT SEND — $101",
  type: "FINANCIAL_SERVICE",
  sessionId: null,
  isPrimary: true,
  primaryDrawer: "OMT_System",
};

const dayRow = (it: typeof SALE | typeof LOTO | typeof OMT) => ({
  shop_day: it.shopDay,
  kind: it.kind,
  id: it.id,
  amount_usd: it.openUsd,
  amount_lbp: 0,
  covered_usd: 0,
  covered_lbp: 0,
  remaining_usd: it.openUsd,
  remaining_lbp: 0,
  row_scope: "DAY",
  label: it.label,
  type: it.type,
  session_id: null,
});

/** Items $191; `creditUsd` of unapplied credit; `earlierUsd` no-item debt. */
function setDebt(creditUsd: number, earlierUsd = 0) {
  const usd = 191 - creditUsd + earlierUsd;
  mockGetDebtors.mockResolvedValue([
    {
      id: 2,
      full_name: "Days Demo",
      phone_number: "03999347",
      total_debt: usd,
      total_debt_usd: usd,
      total_debt_lbp: 0,
    },
  ]);
  mockGetClientDebtHistory.mockResolvedValue([
    {
      id: 1,
      client_id: 2,
      transaction_id: null,
      transaction_type: "Loto Debt",
      amount_usd: usd,
      amount_lbp: 0,
      note: "debt",
      created_at: "2026-10-01 09:00:00",
      created_by: 1,
      session_id: null,
      is_refunded: 0,
    },
  ]);
  mockGetClientDebtTotal.mockResolvedValue(usd);
  mockGetClientBalance.mockResolvedValue({
    success: true,
    data: { balance_usd: usd, balance_lbp: 0 },
  });
  mockGetOpenDebtItems.mockResolvedValue([OMT, SALE, LOTO]);
  mockGetDebtMonthRows.mockResolvedValue({
    month: "2026-10",
    rows: [...[OMT, SALE, LOTO].map(dayRow), PAID_22],
    account: {
      earlier_usd: earlierUsd,
      earlier_lbp: 0,
      credit_usd: creditUsd,
      credit_lbp: 0,
    },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAddRepayment.mockResolvedValue({ success: true, id: 1 });
  setDebt(0);
});

async function openCalendar() {
  render(<Debts />);
  fireEvent.click(await screen.findByText("Settle Debt"));
  await screen.findByTestId("debt-item-picker");
  fireEvent.click(screen.getByTestId("repay-pick-days"));
  await screen.findByTestId("debt-day-calendar");
  await waitFor(() =>
    expect(mockGetDebtMonthRows).toHaveBeenCalledWith(2, "2026-10"),
  );
  await waitFor(() =>
    expect(
      document.querySelector('[data-day="2026-10-22"] button[aria-pressed]'),
    ).toBeTruthy(),
  );
}

const dayButton = (day: string) =>
  document.querySelector(`[data-day="${day}"] button`) as HTMLButtonElement;
const box = (it: { kind: string; id: number }) =>
  screen
    .getByTestId(`debt-item-${it.kind}-${it.id}`)
    .querySelector("input") as HTMLInputElement;
const amountValue = (i = 0) =>
  Array.from(
    document.querySelectorAll<HTMLInputElement>(
      '[data-testid^="payment-amount-"]',
    ),
  )[i]?.value.replace(/,/g, "");
const confirm = () => screen.getByText("Confirm Payment") as HTMLButtonElement;
const sent = () => addRepaymentSchema.parse(mockAddRepayment.mock.calls[0][0]);


/** Paid in full on 22 Oct: only in the month read. */
const PAID_22 = {
  shop_day: "2026-10-22",
  kind: "charge",
  id: 13,
  amount_usd: 25,
  amount_lbp: 0,
  covered_usd: 25,
  covered_lbp: 0,
  remaining_usd: 0,
  remaining_lbp: 0,
  row_scope: "DAY",
  label: "Alfa recharge — $25",
  type: "RECHARGE",
  session_id: null,
};

async function pickTwoDaysAndOpenTable() {
  await openCalendar();
  fireEvent.click(dayButton("2026-10-20"));
  fireEvent.click(dayButton("2026-10-22"));
  const btn = await screen.findByTestId("settle-see-transactions");
  await waitFor(() => expect(btn).toHaveTextContent("2"));
  fireEvent.click(btn);
  return screen.findByTestId("settle-transactions-panel");
}

it("the pill counts the picked days' open items and opens a table with paid items too", async () => {
  const panel = await pickTwoDaysAndOpenTable();
  expect(screen.getByTestId("settle-see-transactions")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  const loto = within(panel).getByTestId("settle-tx-row-charge:11");
  expect(loto).toHaveTextContent("Loto ticket — $40");
  expect(within(loto).getByText("LOTO")).toBeInTheDocument();
  expect(loto).toHaveTextContent("$40.00");
  const paid = within(panel).getByTestId("settle-tx-row-charge:13");
  expect(paid).toHaveTextContent("paid");
  expect(within(paid).getByRole("checkbox")).toBeDisabled();
  // 5 Oct (OMT) is not picked.
  expect(within(panel).queryByTestId("settle-tx-row-charge:12")).not.toBeInTheDocument();
});

it("unticking an item in the table unticks it in the list; amount and payload follow", async () => {
  const panel = await pickTwoDaysAndOpenTable();
  await waitFor(() => expect(amountValue()).toBe("90"));
  fireEvent.click(
    within(within(panel).getByTestId("settle-tx-row-charge:11")).getByRole("checkbox"),
  );
  await waitFor(() => expect(box(LOTO).checked).toBe(false));
  expect(box(SALE).checked).toBe(true);
  await waitFor(() => expect(amountValue()).toBe("50"));
  expect(within(panel).getByTestId("settle-tx-row-charge:11")).toHaveTextContent("unticked");
  fireEvent.click(confirm());
  await waitFor(() => expect(mockAddRepayment).toHaveBeenCalledTimes(1));
  expect(sent().targets).toEqual([{ kind: "sale", id: 5 }]);
  expect(sent().expectedOwed).toEqual({ usd: 50, lbp: 0 });
});

it("× closes the table", async () => {
  const panel = await pickTwoDaysAndOpenTable();
  fireEvent.click(within(panel).getByRole("button", { name: "Close transactions" }));
  await waitFor(() =>
    expect(screen.queryByTestId("settle-transactions-panel")).not.toBeInTheDocument(),
  );
  expect(screen.getByTestId("settle-see-transactions")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
});
