/** @jest-environment jsdom */

/**
 * LIRA-347 (owner decisions 2026-10-26) — settle a client's debts by day on
 * the Debts page's repayment modal:
 *  D1 pick days on a calendar → those days' items are ticked, the amount
 *     fills to what they owe, and the payload carries the stale-check
 *     figure (`expectedOwed`);
 *  D2 "Use credit": pre-filled min(owed of the picked days, credit); the
 *     payment fills to the rest; a repayment wholly from credit is allowed;
 *  D3 debt with no item shows as an account line, never on a day.
 *
 * Failing-first (rule 17): written and run before the calendar existed on
 * the page.
 *
 * (Header of the LIRA-308 test this mock setup was copied from:)
 * LIRA-308 (owner decisions 2026-10-11) — on the Debts page's "Process
 * Repayment" modal the ticks and the amount stay in step. Rendered with the
 * REAL repayment modal and payment sheet (MultiPaymentInput), so the amount
 * box the cashier types into is the one under test.
 *
 *  1. on open every item is ticked and the amount is their sum;
 *  2. a tick change resets the amount (even a typed one); typing never
 *     unticks;
 *  3. nothing ticked → Confirm disabled + "Tick what this payment is for";
 *  4. a smaller amount → cash drawer first, then oldest, each line showing
 *     "pays $X · leaves $Y";
 *  5. a bigger amount ticks the next items by itself (cash drawer first,
 *     then oldest) and sends them as `auto` targets;
 *  6. above the whole debt → "Account credit $X" in Goes to, sent as the
 *     existing CUSTOMER_ACCOUNT change leg;
 *  7. LBP items are shown in both currencies at the modal's rate;
 *  8. a discount is applied with the payment to the ticked items;
 *  9. an LBP debt follows the same rules in LBP.
 *
 * Payload field names are read through addRepaymentSchema (rule 24); the
 * useApi() mock returns ONE stable object (rule 25).
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
    rows: [OMT, SALE, LOTO].map(dayRow),
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

it("D1 — pick 22 Oct: only its item is ticked, the amount is what it owes, the payload carries the stale figure", async () => {
  await openCalendar();
  fireEvent.click(dayButton("2026-10-22"));
  await waitFor(() => expect(box(LOTO).checked).toBe(true));
  expect(box(SALE).checked).toBe(false);
  expect(box(OMT).checked).toBe(false);
  await waitFor(() => expect(amountValue()).toBe("40"));
  fireEvent.click(confirm());
  await waitFor(() => expect(mockAddRepayment).toHaveBeenCalledTimes(1));
  expect(sent().targets).toEqual([{ kind: "charge", id: 11 }]);
  expect(sent().expectedOwed).toEqual({ usd: 40, lbp: 0 });
  expect(sent().amountUSD).toBeCloseTo(40, 2);
  expect(sent().creditUseUSD).toBeUndefined();
});

it("D2 — with $20 credit, picking 20 Oct pre-fills Use credit $20 and the payment $30", async () => {
  setDebt(20);
  await openCalendar();
  fireEvent.click(dayButton("2026-10-20"));
  const credit = (await screen.findByTestId(
    "debt-use-credit-USD",
  )) as HTMLInputElement;
  await waitFor(() => expect(credit.value).toBe("20"));
  await waitFor(() => expect(amountValue()).toBe("30"));
  fireEvent.click(confirm());
  await waitFor(() => expect(mockAddRepayment).toHaveBeenCalledTimes(1));
  expect(sent().targets).toEqual([{ kind: "sale", id: 5 }]);
  expect(sent().expectedOwed).toEqual({ usd: 50, lbp: 0 });
  expect(sent().creditUseUSD).toBeCloseTo(20, 2);
  expect(sent().amountUSD).toBeCloseTo(30, 2);
});

it("D2 — lowering Use credit raises the payment; a repayment wholly from credit is allowed", async () => {
  setDebt(60);
  await openCalendar();
  fireEvent.click(dayButton("2026-10-22"));
  const credit = (await screen.findByTestId(
    "debt-use-credit-USD",
  )) as HTMLInputElement;
  await waitFor(() => expect(credit.value).toBe("40"));
  // Wholly from credit: nothing to pay in money.
  await waitFor(() => expect(confirm().disabled).toBe(false));
  fireEvent.change(credit, { target: { value: "15" } });
  await waitFor(() => expect(amountValue()).toBe("25"));
  fireEvent.change(credit, { target: { value: "40" } });
  // Nothing left to pay in money: the payment box empties (0).
  await waitFor(() => expect(Number(amountValue() || "0")).toBe(0));
  fireEvent.click(confirm());
  await waitFor(() => expect(mockAddRepayment).toHaveBeenCalledTimes(1));
  expect(sent().creditUseUSD).toBeCloseTo(40, 2);
  expect(sent().amountUSD).toBe(0);
  expect(sent().targets).toEqual([{ kind: "charge", id: 11 }]);
});

it("D3 — debt with no item is an account line under the calendar, never a day", async () => {
  setDebt(0, 30);
  await openCalendar();
  expect(screen.getByTestId("debt-account-earlier").textContent).toContain(
    "$30",
  );
});

it("hiding the calendar drops its plan: no credit use, no stale figure, the amount is the ticked sum", async () => {
  setDebt(20);
  await openCalendar();
  fireEvent.click(dayButton("2026-10-20"));
  await waitFor(() => expect(amountValue()).toBe("30"));
  fireEvent.click(screen.getByTestId("repay-pick-days"));
  expect(screen.queryByTestId("debt-day-calendar")).toBeNull();
  // The 20 Oct tick stays; the amount re-fills to it (capped at the due).
  expect(box(SALE).checked).toBe(true);
  await waitFor(() => expect(amountValue()).toBe("50"));
  fireEvent.click(confirm());
  await waitFor(() => expect(mockAddRepayment).toHaveBeenCalledTimes(1));
  expect(sent().creditUseUSD).toBeUndefined();
  expect(sent().expectedOwed).toBeUndefined();
  expect(sent().targets).toEqual([{ kind: "sale", id: 5 }]);
});
