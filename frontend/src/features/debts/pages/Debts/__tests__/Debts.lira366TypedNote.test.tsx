/** @jest-environment jsdom */

/**
 * LIRA-366 T053 — the Accounts (Debts) settle window's Note box. On a
 * REPAYMENT (money in) it is the cashier's typed note and travels as
 * `typedNote`; on a CASH-OUT (money out — the shop pays the client) it stays
 * the plain `note`, as before. Field names are read off the core schemas
 * (rule 24). Harness copied from repayment.payloadLanguage.test.tsx (real
 * settle modal and payment box).
 *
 * Rule 17: run against the unchanged page first and seen failing.
 */


/**
 * LIRA-331 T046 (research R9, rule 28d) — the Accounts (Debts) page sends the
 * SAME payload whatever language the screen is in. Each case drives the real
 * page (real settle modal and payment box) the same way twice, once in
 * English and once in Arabic, and the two captured payloads must be
 * deep-equal. Every payload is also parsed through its core schema.
 *
 * Cases: repayment of a USD debt, an LBP debt and a mixed debt; repayment
 * with a USD forgive + reason, with an LBP forgive, and with Waive; a
 * repayment with ticked open items; cash-out of a USD and of an LBP credit;
 * the admin write-off; Add Credit and Add Debt (paper entry) with a note.
 *
 * Nothing is selected by visible text — only test ids, ids and DOM position —
 * so the Arabic run fails only if the payload differs.
 *
 * NOT failing-first (rule 17): it passes before the page is translated. It
 * guards the conversion against a translated label leaking into saved data.
 */

import {
  render,
  screen,
  waitFor,
  fireEvent,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { addRepaymentSchema, debtCashOutSchema } from "@liratek/core";
import Debts from "../index";

const mockGetDebtors = jest.fn();
const mockGetClientDebtHistory = jest.fn();
const mockGetClientBalance = jest.fn();
const mockGetClientDebtTotal = jest.fn();
const mockGetOpenDebtItems = jest.fn();
const mockAddRepayment = jest.fn();
const mockCashOut = jest.fn();
const mockWriteOff = jest.fn();
const mockAddAccountEntry = jest.fn();

// One stable object (rule 25).
const mockApi = {
  getDebtors: (...a: unknown[]) => mockGetDebtors(...a),
  getClientDebtHistory: (...a: unknown[]) => mockGetClientDebtHistory(...a),
  getClientBalance: (...a: unknown[]) => mockGetClientBalance(...a),
  getClientDebtTotal: (...a: unknown[]) => mockGetClientDebtTotal(...a),
  getOpenDebtItems: (...a: unknown[]) => mockGetOpenDebtItems(...a),
  addRepayment: (...a: unknown[]) => mockAddRepayment(...a),
  cashOut: (...a: unknown[]) => mockCashOut(...a),
  debtWriteOff: (...a: unknown[]) => mockWriteOff(...a),
  addAccountEntry: (...a: unknown[]) => mockAddAccountEntry(...a),
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
    PageHeader: ({ actions }: { actions?: ReactNode }) => <div>{actions}</div>,
    Select: () => null,
    ServiceTypeTabs: ({
      onChange,
      options,
    }: {
      onChange: (v: string) => void;
      options: { id: string }[];
    }) => (
      <div>
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            data-testid={`entry-tab-${o.id}`}
            onClick={() => onChange(o.id)}
          />
        ))}
      </div>
    ),
  };
});

jest.mock("@/shared/components/ClientAutocompleteInput", () => ({
  ClientAutocompleteInput: ({
    onClientSelect,
  }: {
    onClientSelect: (c: { id: number; full_name: string }) => void;
  }) => (
    <button
      type="button"
      data-testid="entry-pick-client"
      onClick={() => onClientSelect({ id: 2, full_name: "Language Demo" })}
    />
  ),
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, username: "admin", role: "admin" } }),
}));
jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 90500, buyRate: 90000, isLoading: false }),
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
jest.mock("@/shared/components/TransactionTimeOverride", () => ({
  TransactionTimeOverride: () => null,
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

const RATE = 90_000;

/** The client's balance: positive = owes the shop, negative = credit. */
function setAccount(usd: number, lbp: number, items: unknown[] = []) {
  mockGetDebtors.mockResolvedValue([
    {
      id: 2,
      full_name: "Language Demo",
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
      transaction_type: usd < 0 || lbp < 0 ? "CREDIT_DEPOSIT" : "Manual Debt",
      amount_usd: usd,
      amount_lbp: lbp,
      note: "opening",
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

const amountInputs = () =>
  Array.from(
    document.querySelectorAll<HTMLInputElement>(
      '[data-testid^="payment-amount-"]',
    ),
  );

async function confirmSettle() {
  const body = screen.getByTestId("counterparty-settle-body");
  const buttons = within(body).getAllByRole("button");
  // The confirm button is the last one in the settle body.
  const confirm = buttons[buttons.length - 1];
  await waitFor(() => expect(confirm).not.toBeDisabled());
  fireEvent.click(confirm);
}

async function openPage() {
  render(<Debts />);
  await waitFor(() => expect(mockGetClientBalance).toHaveBeenCalled());
}

async function openSettle(opener: "debts-settle-open" | "debts-cashout-open") {
  await openPage();
  fireEvent.click(await screen.findByTestId(opener));
  await waitFor(() => expect(amountInputs().length).toBeGreaterThan(0));
  await waitFor(() =>
    expect(amountInputs().every((i) => i.value !== "")).toBe(true),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAddRepayment.mockResolvedValue({ success: true, id: 1 });
  mockCashOut.mockResolvedValue({ success: true, id: 1 });
});

describe("Accounts settle window — typed note (LIRA-366)", () => {
  it("repayment: the note travels as typedNote", async () => {
    setAccount(50, 0);
    await openSettle("debts-settle-open");
    fireEvent.change(document.getElementById("repay-note")!, {
      target: { value: "rest on Monday" },
    });
    await confirmSettle();
    await waitFor(() => expect(mockAddRepayment).toHaveBeenCalledTimes(1));
    const parsed = addRepaymentSchema.parse(mockAddRepayment.mock.calls[0][0]);
    expect(parsed.typedNote).toBe("rest on Monday");
    expect(parsed.note).toBeUndefined();
  });

  it("repayment with a blank note: no typedNote", async () => {
    setAccount(50, 0);
    await openSettle("debts-settle-open");
    await confirmSettle();
    await waitFor(() => expect(mockAddRepayment).toHaveBeenCalledTimes(1));
    const parsed = addRepaymentSchema.parse(mockAddRepayment.mock.calls[0][0]);
    expect(parsed.typedNote).toBeUndefined();
  });

  it("cash-out (money out): the note stays the plain note", async () => {
    setAccount(-25, 0);
    await openSettle("debts-cashout-open");
    fireEvent.change(document.getElementById("repay-note")!, {
      target: { value: "paid out at counter" },
    });
    await confirmSettle();
    await waitFor(() => expect(mockCashOut).toHaveBeenCalledTimes(1));
    const parsed = debtCashOutSchema.parse(mockCashOut.mock.calls[0][0]);
    expect(parsed.note).toBe("paid out at counter");
  });
});
