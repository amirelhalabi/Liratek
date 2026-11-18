/** @jest-environment jsdom */

/**
 * LIRA-401 Part A + B — the Debts repayment / cash-out modal must book ONE
 * payment per click-burst, and every write carries an idempotency key.
 *
 * Part A (rule 17, failing-first): before the fix the Confirm button stayed
 * enabled while `api.addRepayment` / `api.cashOut` was pending and the
 * handler had no in-flight guard, so a double click sent the payment twice
 * (owner report: one repayment booked twice on the web app).
 *
 * Part B: the adapter call receives `{ idempotencyKey }` as its LAST
 * argument (`WriteOptions`); the SAME key is reused for a retry while the
 * modal stays open (a failed submit) and a NEW key is used after the modal
 * closes and reopens.
 *
 * `useApi` returns ONE module-level object (rule 25 — a fresh literal per
 * call is the unstable identity production hides).
 */

import {
  act,
  render,
  screen,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import Debts from "../index";

const KEY_PATTERN = /^[A-Za-z0-9-]{8,128}$/;

const mockApi = {
  getDebtors: jest.fn(),
  getClientDebtHistory: jest.fn(),
  getClientBalance: jest.fn(),
  getClientDebtTotal: jest.fn(),
  addRepayment: jest.fn(),
  getOpenDebtItems: jest.fn(),
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
    // Stable identity (rule 25).
    useApi: () => mockApi,
    appEvents: { emit: jest.fn() },
    // Minimal stand-in exposing the props Debts wires up. "Confirm" honours
    // `isSubmitting` like the real modal; "Force Confirm" calls onConfirm
    // regardless, so the handler's own in-flight guard is proven too.
    CounterpartySettleModal: ({
      onConfirm,
      onCancel,
      confirmLabel,
      isSubmitting,
      multiPaymentInput,
    }: {
      onConfirm: () => void;
      onCancel?: () => void;
      confirmLabel: string;
      isSubmitting?: boolean;
      multiPaymentInput: { onChange: (lines: unknown[]) => void };
    }) => (
      <div data-testid="settle-modal">
        <button
          type="button"
          onClick={() =>
            multiPaymentInput.onChange([
              { id: "1", method: "Cash", currencyCode: "USD", amount: 10 },
            ])
          }
        >
          Set Lines
        </button>
        <button
          type="button"
          data-testid="confirm"
          onClick={onConfirm}
          disabled={!!isSubmitting}
        >
          {confirmLabel}
        </button>
        <button type="button" onClick={onConfirm}>
          Force Confirm
        </button>
        <button type="button" onClick={onCancel}>
          Close Modal
        </button>
      </div>
    ),
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

// buyRate (89000) is EXCHANGE_RATE's fallback — deliberately different from
// the 93000 the tests below feed through "Set Rate", so a payload that
// stamped the fallback instead of the operator's rate is also caught.
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

const DEBTOR = {
  id: 1,
  full_name: "Jane Doe",
  phone_number: "71234567",
  total_debt: 10,
  total_debt_usd: 10,
  total_debt_lbp: 0,
};

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

type Mode = {
  name: string;
  balanceUsd: number;
  open: string;
  confirm: string;
  call: jest.Mock;
};

const MODES: Mode[] = [
  {
    name: "repayment",
    balanceUsd: 10,
    open: "Settle Debt",
    confirm: "Confirm Payment",
    call: mockApi.addRepayment,
  },
  {
    name: "cash out",
    balanceUsd: -10,
    open: "Cash Out",
    confirm: "Confirm Cash Out",
    call: mockApi.cashOut,
  },
];

function lastOpts(call: jest.Mock, i: number): { idempotencyKey?: string } {
  const args = call.mock.calls[i];
  return (args[args.length - 1] ?? {}) as { idempotencyKey?: string };
}

describe("Debts — LIRA-401 one payment per click-burst + idempotency key", () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    alertSpy = jest.spyOn(window, "alert").mockImplementation(() => {});
    mockApi.getDebtors.mockResolvedValue([DEBTOR]);
    mockApi.getClientDebtHistory.mockResolvedValue([]);
    mockApi.getClientDebtTotal.mockResolvedValue(0);
    mockApi.getOpenDebtItems.mockResolvedValue([]);
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  describe.each(MODES)("$name", (mode) => {
    beforeEach(() => {
      mockApi.getClientBalance.mockResolvedValue({
        success: true,
        data: { balance_usd: mode.balanceUsd, balance_lbp: 0 },
      });
    });

    it("double Confirm while pending sends ONE call and disables Confirm", async () => {
      const pending = deferred<{ success: boolean; id: number }>();
      mode.call.mockReturnValue(pending.promise);

      render(<Debts />);
      fireEvent.click(await screen.findByText(mode.open));
      fireEvent.click(screen.getByText("Set Lines"));

      const confirm = screen.getByTestId("confirm");
      fireEvent.click(confirm);
      fireEvent.click(confirm);
      // Bypasses the disabled button: the handler itself must refuse.
      fireEvent.click(screen.getByText("Force Confirm"));

      await waitFor(() => expect(mode.call).toHaveBeenCalled());
      expect(mode.call).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("confirm")).toBeDisabled();

      await act(async () => {
        pending.resolve({ success: true, id: 1 });
        await pending.promise;
      });
      expect(mode.call).toHaveBeenCalledTimes(1);
    });

    it("sends an idempotency key: same key on retry after a failure, new key after reopen", async () => {
      mode.call
        .mockResolvedValueOnce({ success: false, error: "network" })
        .mockResolvedValue({ success: true, id: 1 });

      render(<Debts />);
      fireEvent.click(await screen.findByText(mode.open));
      fireEvent.click(screen.getByText("Set Lines"));

      fireEvent.click(screen.getByTestId("confirm"));
      await waitFor(() => expect(mode.call).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(screen.getByTestId("confirm")).toBeEnabled());

      // Retry while the modal is still open → the SAME key (server replays).
      fireEvent.click(screen.getByTestId("confirm"));
      await waitFor(() => expect(mode.call).toHaveBeenCalledTimes(2));

      const first = lastOpts(mode.call, 0).idempotencyKey;
      const retry = lastOpts(mode.call, 1).idempotencyKey;
      expect(first).toMatch(KEY_PATTERN);
      expect(retry).toBe(first);

      // The success closed the modal; reopen → a NEW key.
      await waitFor(() =>
        expect(screen.queryByTestId("settle-modal")).not.toBeInTheDocument(),
      );
      fireEvent.click(await screen.findByText(mode.open));
      fireEvent.click(screen.getByText("Set Lines"));
      fireEvent.click(screen.getByTestId("confirm"));
      await waitFor(() => expect(mode.call).toHaveBeenCalledTimes(3));
      const reopened = lastOpts(mode.call, 2).idempotencyKey;
      expect(reopened).toMatch(KEY_PATTERN);
      expect(reopened).not.toBe(first);
    });
  });
});
