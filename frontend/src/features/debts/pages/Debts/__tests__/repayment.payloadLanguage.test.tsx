/** @jest-environment jsdom */

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
  cleanup,
} from "@testing-library/react";
import type { ReactNode } from "react";
import {
  addRepaymentSchema,
  debtAccountEntrySchema,
  debtCashOutSchema,
  debtWriteOffSchema,
} from "@liratek/core";
import { i18n, loadLanguage } from "@/i18n/setup";
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

const OPEN_ITEMS = [
  {
    kind: "charge",
    id: 7,
    rowId: 1,
    createdAt: "2026-10-10 10:00:00",
    openUsd: 30,
    openLbp: 0,
    routingCap: null,
    label: "Sale #7: 1× Case — $30",
    type: "SALE",
    sessionId: null,
    isPrimary: false,
    primaryDrawer: null,
  },
  {
    kind: "charge",
    id: 8,
    rowId: 2,
    createdAt: "2026-10-11 10:00:00",
    openUsd: 20,
    openLbp: 0,
    routingCap: null,
    label: "Recharge Debt — $20",
    type: "RECHARGE",
    sessionId: null,
    isPrimary: false,
    primaryDrawer: null,
  },
];

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

interface Case {
  name: string;
  run: () => Promise<unknown>;
}

const repaid = async () => {
  await waitFor(() => expect(mockAddRepayment).toHaveBeenCalledTimes(1));
  return addRepaymentSchema.parse(mockAddRepayment.mock.calls[0][0]);
};

const CASES: Case[] = [
  {
    name: "repayment of a USD debt, with a note",
    run: async () => {
      setAccount(50, 0);
      await openSettle("debts-settle-open");
      fireEvent.change(document.getElementById("repay-note")!, {
        target: { value: "paid at counter" },
      });
      await confirmSettle();
      return repaid();
    },
  },
  {
    name: "repayment of an LBP debt",
    run: async () => {
      setAccount(0, 900_000);
      await openSettle("debts-settle-open");
      await confirmSettle();
      return repaid();
    },
  },
  {
    name: "repayment of a mixed USD + LBP debt",
    run: async () => {
      setAccount(20, 450_000);
      await openSettle("debts-settle-open");
      await confirmSettle();
      return repaid();
    },
  },
  {
    name: "repayment with a USD forgive and a reason",
    run: async () => {
      setAccount(50, 0);
      await openSettle("debts-settle-open");
      fireEvent.change(screen.getByTestId("debt-forgive-usd"), {
        target: { value: "10" },
      });
      fireEvent.change(amountInputs()[0], { target: { value: "40" } });
      fireEvent.change(screen.getByTestId("debt-forgive-reason"), {
        target: { value: "loyal customer" },
      });
      await confirmSettle();
      return repaid();
    },
  },
  {
    name: "repayment with an LBP forgive",
    run: async () => {
      setAccount(0, 900_000);
      await openSettle("debts-settle-open");
      fireEvent.change(screen.getByTestId("debt-forgive-lbp"), {
        target: { value: "100000" },
      });
      fireEvent.change(amountInputs()[0], { target: { value: "800000" } });
      await confirmSettle();
      return repaid();
    },
  },
  {
    name: "repayment with Waive on the rest",
    run: async () => {
      setAccount(50, 0);
      await openSettle("debts-settle-open");
      // Waive only shows for a gap within the shared shortfall cap ($5).
      fireEvent.change(amountInputs()[0], { target: { value: "46" } });
      fireEvent.click(await screen.findByTestId("waive-remaining"));
      await waitFor(() =>
        expect(
          (screen.getByTestId("debt-forgive-usd") as HTMLInputElement).value,
        ).toBe("4.00"),
      );
      await confirmSettle();
      return repaid();
    },
  },
  {
    name: "repayment of ticked open items",
    run: async () => {
      setAccount(50, 0, OPEN_ITEMS);
      await openSettle("debts-settle-open");
      await waitFor(() => expect(mockGetOpenDebtItems).toHaveBeenCalled());
      await confirmSettle();
      return repaid();
    },
  },
  {
    name: "cash-out of a USD credit",
    run: async () => {
      setAccount(-25, 0);
      await openSettle("debts-cashout-open");
      await confirmSettle();
      await waitFor(() => expect(mockCashOut).toHaveBeenCalledTimes(1));
      return debtCashOutSchema.parse(mockCashOut.mock.calls[0][0]);
    },
  },
  {
    name: "cash-out of an LBP credit",
    run: async () => {
      setAccount(0, -300_000);
      await openSettle("debts-cashout-open");
      await confirmSettle();
      await waitFor(() => expect(mockCashOut).toHaveBeenCalledTimes(1));
      return debtCashOutSchema.parse(mockCashOut.mock.calls[0][0]);
    },
  },
  {
    name: "write-off of part of a mixed debt, with a reason",
    run: async () => {
      setAccount(20, 450_000);
      await openPage();
      fireEvent.click(await screen.findByTestId("debts-writeoff-open"));
      fireEvent.change(screen.getByTestId("debts-writeoff-usd"), {
        target: { value: "15" },
      });
      fireEvent.change(screen.getByTestId("debts-writeoff-lbp"), {
        target: { value: "50000" },
      });
      fireEvent.change(screen.getByTestId("debts-writeoff-reason"), {
        target: { value: "bad debt" },
      });
      fireEvent.click(screen.getByTestId("debts-writeoff-confirm"));
      await waitFor(() => expect(mockWriteOff).toHaveBeenCalledTimes(1));
      return debtWriteOffSchema.parse(mockWriteOff.mock.calls[0][0]);
    },
  },
  ...(["credit", "debt"] as const).map(
    (direction): Case => ({
      name: `Add ${direction === "credit" ? "Credit" : "Debt (paper entry)"} with a note`,
      run: async () => {
        setAccount(50, 0);
        await openPage();
        fireEvent.click(screen.getByTestId("debts-add-entry-open"));
        fireEvent.click(screen.getByTestId(`entry-tab-${direction}`));
        fireEvent.click(screen.getByTestId("entry-pick-client"));
        fireEvent.change(screen.getByTestId("debts-entry-usd"), {
          target: { value: "12.5" },
        });
        fireEvent.change(screen.getByTestId("debts-entry-lbp"), {
          target: { value: "150000" },
        });
        fireEvent.change(screen.getByTestId("debts-entry-note"), {
          target: { value: "opening balance" },
        });
        if (direction === "debt") {
          const toggle = within(
            screen.getByTestId("account-cash-moved-toggle"),
          ).getByRole("checkbox");
          fireEvent.click(toggle);
        }
        fireEvent.click(screen.getByTestId("debts-entry-confirm"));
        await waitFor(() =>
          expect(mockAddAccountEntry).toHaveBeenCalledTimes(1),
        );
        return debtAccountEntrySchema.parse(
          mockAddAccountEntry.mock.calls[0][0],
        );
      },
    }),
  ),
];

async function runIn(lang: "en" | "ar", c: Case): Promise<unknown> {
  jest.clearAllMocks();
  mockAddRepayment.mockResolvedValue({ success: true, id: 1 });
  mockCashOut.mockResolvedValue({ success: true, id: 1 });
  mockWriteOff.mockResolvedValue({ success: true });
  mockAddAccountEntry.mockResolvedValue({ success: true, id: 1 });
  await i18n.changeLanguage(lang);
  const payload = await c.run();
  cleanup();
  return payload;
}

beforeAll(async () => {
  await loadLanguage("ar");
});

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("Accounts payloads are the same in English and Arabic (LIRA-331)", () => {
  it.each(CASES.map((c) => [c.name, c] as const))("%s", async (_name, c) => {
    const en = await runIn("en", c);
    const ar = await runIn("ar", c);
    expect(ar).toEqual(en);
  });
});
