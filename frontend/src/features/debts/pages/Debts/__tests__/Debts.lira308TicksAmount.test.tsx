/** @jest-environment jsdom */

/**
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

const RATE = 89_000;

// A $14 cable sale (oldest), a $20 Loto ticket, a newer $101 OMT send (cash
// drawer). Whole debt $135.
const SALE = {
  kind: "sale",
  id: 5,
  rowId: 5,
  createdAt: "2026-10-01 09:00:00",
  openUsd: 14,
  openLbp: 0,
  label: "Sale #5: Cable",
  type: "SALE",
  sessionId: null,
  isPrimary: false,
  primaryDrawer: null,
};
const LOTO = {
  kind: "charge",
  id: 11,
  rowId: 11,
  createdAt: "2026-10-02 09:00:00",
  openUsd: 20,
  openLbp: 0,
  routingCap: null,
  label: "Loto ticket — $20",
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
  openUsd: 101,
  openLbp: 0,
  routingCap: { usd: 101, lbp: 0 },
  label: "OMT SEND — $101",
  type: "FINANCIAL_SERVICE",
  sessionId: null,
  isPrimary: true,
  primaryDrawer: "OMT_System",
};
const LBP_LOTO = {
  kind: "charge",
  id: 14,
  rowId: 14,
  createdAt: "2026-10-03 09:00:00",
  openUsd: 0,
  openLbp: 890_000,
  routingCap: null,
  label: "Loto ticket — 890,000 LBP",
  type: "LOTO",
  sessionId: null,
  isPrimary: false,
  primaryDrawer: null,
};

function setDebt(items: unknown[], usd: number, lbp: number) {
  mockGetDebtors.mockResolvedValue([
    {
      id: 2,
      full_name: "Ticks Demo",
      phone_number: "03999222",
      total_debt: usd + lbp / RATE,
      total_debt_usd: usd,
      total_debt_lbp: lbp,
    },
  ]);
  mockGetClientDebtHistory.mockResolvedValue([
    {
      id: 1,
      client_id: 2,
      transaction_id: null,
      transaction_type: "Loto Debt",
      amount_usd: usd,
      amount_lbp: lbp,
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
    data: { balance_usd: usd, balance_lbp: lbp },
  });
  mockGetOpenDebtItems.mockResolvedValue(items);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAddRepayment.mockResolvedValue({ success: true, id: 1 });
  setDebt([SALE, LOTO, OMT], 135, 0);
});

async function openSettle() {
  render(<Debts />);
  fireEvent.click(await screen.findByText("Settle Debt"));
  await screen.findByTestId("debt-item-picker");
}

const row = (it: { kind: string; id: number }) =>
  screen.getByTestId(`debt-item-${it.kind}-${it.id}`);
const box = (it: { kind: string; id: number }) =>
  row(it).querySelector("input") as HTMLInputElement;
const amountInputs = () =>
  Array.from(
    document.querySelectorAll<HTMLInputElement>(
      '[data-testid^="payment-amount-"]',
    ),
  );
const amountValue = (i = 0) => amountInputs()[i]?.value.replace(/,/g, "");
const typeAmount = (value: string, i = 0) =>
  fireEvent.change(amountInputs()[i], { target: { value } });
const confirm = () => screen.getByText("Confirm Payment") as HTMLButtonElement;
const sent = () => addRepaymentSchema.parse(mockAddRepayment.mock.calls[0][0]);

it("1 — on open every item is ticked and the amount is their sum", async () => {
  await openSettle();
  await waitFor(() => expect(box(SALE).checked).toBe(true));
  expect(box(LOTO).checked).toBe(true);
  expect(box(OMT).checked).toBe(true);
  await waitFor(() => expect(amountValue()).toBe("135"));
});

it("2 — a tick change resets the amount, even a typed one; typing never unticks", async () => {
  await openSettle();
  await waitFor(() => expect(amountValue()).toBe("135"));
  fireEvent.click(box(LOTO));
  await waitFor(() => expect(amountValue()).toBe("115"));
  typeAmount("50");
  expect(box(SALE).checked).toBe(true);
  expect(box(OMT).checked).toBe(true);
  expect(box(LOTO).checked).toBe(false);
  fireEvent.click(box(LOTO));
  await waitFor(() => expect(amountValue()).toBe("135"));
});

it("3 — nothing ticked: Confirm disabled with the hint", async () => {
  await openSettle();
  await waitFor(() => expect(box(SALE).checked).toBe(true));
  fireEvent.click(box(SALE));
  fireEvent.click(box(LOTO));
  fireEvent.click(box(OMT));
  await waitFor(() => expect(confirm().disabled).toBe(true));
  expect(screen.getByText("Tick what this payment is for")).toBeTruthy();
  fireEvent.click(box(LOTO));
  await waitFor(() => expect(confirm().disabled).toBe(false));
});

it("4 — a smaller amount pays the cash-drawer item first, then oldest; each line shows pays/leaves", async () => {
  await openSettle();
  await waitFor(() => expect(amountValue()).toBe("135"));
  typeAmount("110");
  await waitFor(() =>
    expect(row(OMT).textContent).toContain("pays $101 · leaves $0"),
  );
  expect(row(SALE).textContent).toContain("pays $9 · leaves $5");
  expect(row(LOTO).textContent).toContain("pays $0 · leaves $20");
  fireEvent.click(confirm());
  await waitFor(() => expect(mockAddRepayment).toHaveBeenCalledTimes(1));
  expect(sent().targets).toEqual([
    { kind: "sale", id: 5 },
    { kind: "charge", id: 11 },
    { kind: "charge", id: 12 },
  ]);
  expect(sent().amountUSD).toBeCloseTo(110, 2);
});

it("5 — a bigger amount ticks the next items itself (cash drawer first) and sends them as auto targets", async () => {
  await openSettle();
  await waitFor(() => expect(amountValue()).toBe("135"));
  fireEvent.click(box(SALE));
  fireEvent.click(box(OMT));
  await waitFor(() => expect(amountValue()).toBe("20"));
  typeAmount("70");
  // $20 Loto, then $50 of the OMT send — not the older cable sale.
  await waitFor(() => expect(box(OMT).checked).toBe(true));
  expect(box(SALE).checked).toBe(false);
  expect(row(OMT).textContent).toContain("pays $50 · leaves $51");
  // Ticking itself does not reset the typed amount.
  expect(amountValue()).toBe("70");
  fireEvent.click(confirm());
  await waitFor(() => expect(mockAddRepayment).toHaveBeenCalledTimes(1));
  expect(sent().targets).toEqual([
    { kind: "charge", id: 11 },
    { kind: "charge", id: 12, auto: true },
  ]);
});

it("6 — above the whole debt: Account credit in Goes to, sent as a Customer Account change leg", async () => {
  await openSettle();
  await waitFor(() => expect(amountValue()).toBe("135"));
  typeAmount("151");
  await waitFor(() =>
    expect(screen.getByTestId("repay-goes-to").textContent).toContain(
      "Account credit$16",
    ),
  );
  // All $151 cash stays in the shop: $101 to the OMT cash drawer, $50 in
  // General (the $16 credit is not handed back).
  expect(screen.getByTestId("repay-goes-to").textContent).toContain(
    "General$50",
  );
  fireEvent.click(confirm());
  await waitFor(() => expect(mockAddRepayment).toHaveBeenCalledTimes(1));
  const p = sent();
  expect(p.amountUSD).toBeCloseTo(135, 2);
  expect(p.payments).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        method: "CASH",
        currencyCode: "USD",
        amount: 151,
      }),
      expect.objectContaining({
        method: "CUSTOMER_ACCOUNT",
        currencyCode: "USD",
        amount: 16,
        direction: "OUT",
      }),
    ]),
  );
  expect(p.keptChangeUSD ?? 0).toBe(0);
  expect(p.targets).toHaveLength(3);
});

it("7 + 9 — LBP items show both currencies; an LBP debt fills and pays in LBP", async () => {
  setDebt([SALE, LBP_LOTO], 14, 890_000);
  await openSettle();
  expect(row(LBP_LOTO).textContent).toContain("890,000 LBP");
  expect(row(LBP_LOTO).textContent).toContain("$10");
  // One line per currency: $14 and 890,000 LBP.
  await waitFor(() => expect(amountInputs()).toHaveLength(2));
  expect(amountValue(0)).toBe("14");
  expect(amountValue(1)).toBe("890000");
  typeAmount("500000", 1);
  await waitFor(() =>
    expect(row(LBP_LOTO).textContent).toContain(
      "pays 500,000 LBP · leaves 390,000 LBP",
    ),
  );
  expect(row(SALE).textContent).toContain("pays $14 · leaves $0");
});

it("8 — a discount is applied with the payment to the ticked items", async () => {
  await openSettle();
  await waitFor(() => expect(amountValue()).toBe("135"));
  fireEvent.click(box(SALE));
  fireEvent.click(box(OMT));
  await waitFor(() => expect(amountValue()).toBe("20"));
  const discount = screen
    .getByText("Amount (USD)")
    .parentElement!.querySelector("input")!;
  fireEvent.change(discount, { target: { value: "5" } });
  await waitFor(() => expect(amountValue()).toBe("15"));
  expect(row(LOTO).textContent).toContain("pays $20 · leaves $0");
  expect(box(OMT).checked).toBe(false);
  fireEvent.click(confirm());
  await waitFor(() => expect(mockAddRepayment).toHaveBeenCalledTimes(1));
  expect(sent().discount).toEqual(expect.objectContaining({ amount_usd: 5 }));
  expect(sent().targets).toEqual([{ kind: "charge", id: 11 }]);
});

it("no itemised debt (picker hidden): Confirm stays enabled", async () => {
  setDebt([], 30, 0);
  render(<Debts />);
  fireEvent.click(await screen.findByText("Settle Debt"));
  await waitFor(() => expect(mockGetOpenDebtItems).toHaveBeenCalled());
  await waitFor(() => expect(amountValue()).toBe("30"));
  expect(screen.queryByTestId("debt-item-picker")).toBeNull();
  expect(confirm().disabled).toBe(false);
});

it("6 + 9 — no itemised debt, LBP overpay: LBP account credit, shown in Goes to", async () => {
  setDebt([], 0, 600_000);
  render(<Debts />);
  fireEvent.click(await screen.findByText("Settle Debt"));
  await waitFor(() => expect(mockGetOpenDebtItems).toHaveBeenCalled());
  await waitFor(() => expect(amountValue()).toBe("600000"));
  typeAmount("700000");
  // LIRA-313 (owner decision 2026-10-12): the change starts as "Return
  // change"; "To account" puts the whole overpay on the account.
  fireEvent.click(await screen.findByTestId("change-destination-account"));
  await waitFor(() =>
    expect(screen.getByTestId("repay-goes-to").textContent).toContain(
      "Account credit100,000 LBP",
    ),
  );
  fireEvent.click(confirm());
  await waitFor(() => expect(mockAddRepayment).toHaveBeenCalledTimes(1));
  const p = sent();
  expect(p.amountLBP).toBeCloseTo(600_000, 0);
  expect(p.amountUSD).toBeCloseTo(0, 2);
  expect(p.payments).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        method: "CUSTOMER_ACCOUNT",
        currencyCode: "LBP",
        amount: 100_000,
        direction: "OUT",
      }),
    ]),
  );
});

// ── LIRA-308 owner answers (2026-10-11, binding) ─────────────────────────

it("answer 1 — $10 over, $4 typed as returned: $4 cash back, $6 account credit, nothing kept as profit", async () => {
  await openSettle();
  await waitFor(() => expect(amountValue()).toBe("135"));
  typeAmount("145");
  // LIRA-313 (owner decision 2026-10-12): the returned-amount field now
  // starts FULL ("Return change" is the default); the cashier lowers it to
  // what is really handed back and the rest goes to the account.
  const returned = (await screen.findByTestId(
    "return-usd",
  )) as HTMLInputElement;
  expect(returned.value).toBe("10.00");
  fireEvent.change(returned, { target: { value: "4" } });
  await waitFor(() =>
    expect(screen.getByTestId("repay-goes-to").textContent).toContain(
      "Account credit$6",
    ),
  );
  fireEvent.click(confirm());
  await waitFor(() => expect(mockAddRepayment).toHaveBeenCalledTimes(1));
  const p = sent();
  expect(p.amountUSD).toBeCloseTo(135, 2);
  expect(p.keptChangeUSD ?? 0).toBe(0);
  expect(p.keptChangeLBP ?? 0).toBe(0);
  expect(p.payments).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ method: "CASH", amount: 145 }),
      expect.objectContaining({
        method: "CASH",
        currencyCode: "USD",
        amount: 4,
        direction: "OUT",
      }),
      expect.objectContaining({
        method: "CUSTOMER_ACCOUNT",
        currencyCode: "USD",
        amount: 6,
        direction: "OUT",
      }),
    ]),
  );
});

// Characterization (passes on the pre-answer frontend: the page is generic
// over item kinds; the new behaviour is the server's line and the core
// order, both failing-first in core). Pins how the page uses the line.
const EARLIER = {
  kind: "balance",
  id: 1,
  rowId: 0,
  createdAt: "",
  openUsd: 30,
  openLbp: 0,
  routingCap: null,
  label: "Earlier balance (no items)",
  type: null,
  sessionId: null,
  isPrimary: false,
  primaryDrawer: null,
};

it("answer 2 — the earlier-balance line is ticked on open (amount = whole balance) and paid as the oldest", async () => {
  setDebt([EARLIER, LOTO], 50, 0);
  await openSettle();
  await waitFor(() => expect(box(EARLIER).checked).toBe(true));
  expect(row(EARLIER).textContent).toContain("Earlier balance (no items)");
  await waitFor(() => expect(amountValue()).toBe("50"));
  typeAmount("40");
  await waitFor(() =>
    expect(row(LOTO).textContent).toContain("pays $10 · leaves $10"),
  );
  expect(row(EARLIER).textContent).toContain("pays $30 · leaves $0");
  fireEvent.click(box(LOTO));
  await waitFor(() => expect(amountValue()).toBe("30"));
  fireEvent.click(confirm());
  await waitFor(() => expect(mockAddRepayment).toHaveBeenCalledTimes(1));
  expect(sent().targets).toEqual([{ kind: "balance", id: 1 }]);
});
