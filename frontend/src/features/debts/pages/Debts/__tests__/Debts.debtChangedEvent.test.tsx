/** @jest-environment jsdom */
/**
 * NOT RUN — proven at the end-of-batch gate (owner process rule, 2026-09-24
 * batch: build first, verify once at the end).
 *
 * LIRA-212 Tier A — every Debts-page account write must emit "debt:changed"
 * so TopBar's session balance badge (see
 * `TopBar.balanceBadge.test.tsx`) can refresh live instead of only on
 * "sale:completed" or the dead "debt:repayment" event.
 *
 * Pre-fix behaviour to prove this fails against (rule 17): before this
 * change, none of `handleProcessRepayment` (repay/cash-out), the write-off
 * confirm handler, or the Add Credit/Debt confirm handler emitted anything
 * but "notification:show" on success — temporarily removing the four
 * `appEvents.emit("debt:changed")` calls added alongside this test file
 * reproduces that and makes every assertion below fail.
 *
 * Scaffold reused from `Debts.tenderExchangeRate.test.tsx` (the addRepayment
 * / cashOut payment-sheet stub and the read mocks) — see that file's header
 * for why `appEvents` is wrapped in a closure and why the payload keys are
 * camelCase.
 *
 * The fifth test below (Excel import) guards reviewer finding minor #3
 * (2026-09-24 fix round): `executeImport`'s success branch called
 * `loadDebtors()` but never emitted "debt:changed", so importing a ledger
 * that includes the session's active client left the TopBar badge stale.
 * Pre-fix (rule 17): temporarily removing the `appEvents.emit("debt:changed")`
 * call added next to `loadDebtors()` in the import success branch makes this
 * test's final assertion fail. `xlsx` is mocked outright — the parsing logic
 * itself is not what's under test here, only that a successful import emits.
 */

import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import Debts from "../index";

const mockGetDebtors = jest.fn();
const mockGetClientDebtHistory = jest.fn();
const mockGetClientBalance = jest.fn();
const mockGetClientDebtTotal = jest.fn();
const mockAddRepayment = jest.fn();
const mockCashOut = jest.fn();
const mockDebtWriteOff = jest.fn();
const mockAddAccountEntry = jest.fn();
const mockImportClientDebts = jest.fn();
const mockAppEventsEmit = jest.fn();

// Jest hoists `jest.mock` calls above these `const`s, but factories are only
// INVOKED later (on import), and jest specifically allows a factory to close
// over identifiers prefixed `mock` — see the same pattern used for
// `mockAppEventsEmit` just below. The parsing logic in `handleImportFile` is
// not what test 5 exercises; only that a successful `executeImport` emits.
const mockXlsxSheetToJson = jest.fn((sheet: { rows: unknown[][] }) => sheet.rows);
jest.mock("xlsx", () => ({
  read: jest.fn(() => ({
    SheetNames: ["Client A"],
    Sheets: {
      "Client A": {
        rows: [
          ["", "Client A", "mobile#", "70123456"],
          [],
          ["2026-01-01", 5, 0, "Old debt"],
        ],
      },
    },
  })),
  utils: { sheet_to_json: (sheet: { rows: unknown[][] }) => mockXlsxSheetToJson(sheet) },
}));

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return {
    ...actual,
    useApi: () => ({
      getDebtors: mockGetDebtors,
      getClientDebtHistory: mockGetClientDebtHistory,
      getClientBalance: mockGetClientBalance,
      getClientDebtTotal: mockGetClientDebtTotal,
      addRepayment: mockAddRepayment,
      cashOut: mockCashOut,
      debtWriteOff: mockDebtWriteOff,
      addAccountEntry: mockAddAccountEntry,
      importClientDebts: mockImportClientDebts,
      getTransactionById: jest.fn(),
      getSaleItems: jest.fn(),
      getCustomServiceById: jest.fn(),
      getSale: jest.fn(),
    }),
    // See Debts.tenderExchangeRate.test.tsx: wrapped in a closure to dodge
    // the jest.mock hoist / TDZ on `mockAppEventsEmit`.
    appEvents: { emit: (...args: unknown[]) => mockAppEventsEmit(...args) },
    CounterpartySettleModal: ({
      onConfirm,
      confirmLabel,
      multiPaymentInput,
    }: {
      onConfirm: () => void;
      confirmLabel: string;
      multiPaymentInput: {
        onChange: (lines: unknown[]) => void;
      };
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
        <button type="button" onClick={onConfirm}>
          {confirmLabel}
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
    ServiceTypeTabs: ({
      value,
      onChange,
      options,
    }: {
      value: string;
      onChange: (v: string) => void;
      options: { id: string; label: string }[];
    }) => (
      <div>
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            aria-pressed={value === o.id}
            onClick={() => onChange(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>
    ),
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
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

// The Add Credit/Debt modal's client picker; stubbed exactly like
// CounterpartySettleModal above — a button that fires the real callback
// prop with a fixed client, so Debts' own payload/emit code is what's
// under test, not the autocomplete dropdown's search UI.
const CREDIT_CLIENT = { id: 7, full_name: "Alex Credit" };
jest.mock("@/shared/components/ClientAutocompleteInput", () => ({
  ClientAutocompleteInput: ({
    onClientSelect,
  }: {
    onClientSelect?: (client: typeof CREDIT_CLIENT) => void;
  }) => (
    <button type="button" onClick={() => onClientSelect?.(CREDIT_CLIENT)}>
      Pick Alex Credit
    </button>
  ),
}));

const DEBTOR = {
  id: 1,
  full_name: "Jane Doe",
  phone_number: "71234567",
  total_debt: 10,
  total_debt_usd: 10,
  total_debt_lbp: 0,
};

describe("Debts page — 'debt:changed' emitted on every account write (LIRA-212 Tier A)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete (window as any).api;

    mockGetDebtors.mockResolvedValue([DEBTOR]);
    mockGetClientDebtHistory.mockResolvedValue([]);
    mockGetClientDebtTotal.mockResolvedValue(0);
  });

  afterEach(() => {
    delete (window as any).api;
  });

  it("emits 'debt:changed' after a successful repayment", async () => {
    mockGetClientBalance.mockResolvedValue({
      success: true,
      data: { balance_usd: 10, balance_lbp: 0 },
    });
    mockAddRepayment.mockResolvedValue({ success: true, id: 1 });

    render(<Debts />);

    fireEvent.click(await screen.findByText("Settle Debt"));
    fireEvent.click(screen.getByText("Set Lines"));
    fireEvent.click(screen.getByText("Confirm Payment"));

    await waitFor(() => expect(mockAddRepayment).toHaveBeenCalled());
    expect(mockAppEventsEmit).toHaveBeenCalledWith("debt:changed");
  });

  it("emits 'debt:changed' after a successful cash-out", async () => {
    mockGetClientBalance.mockResolvedValue({
      success: true,
      data: { balance_usd: -10, balance_lbp: 0 },
    });
    mockCashOut.mockResolvedValue({ success: true, id: 1 });

    render(<Debts />);

    fireEvent.click(await screen.findByText("Cash Out"));
    fireEvent.click(screen.getByText("Set Lines"));
    fireEvent.click(screen.getByText("Confirm Payment"));

    await waitFor(() => expect(mockCashOut).toHaveBeenCalled());
    expect(mockAppEventsEmit).toHaveBeenCalledWith("debt:changed");
  });

  it("emits 'debt:changed' after a successful write-off", async () => {
    mockGetClientBalance.mockResolvedValue({
      success: true,
      data: { balance_usd: 10, balance_lbp: 0 },
    });
    mockDebtWriteOff.mockResolvedValue({ success: true });

    render(<Debts />);

    fireEvent.click(
      await screen.findByTitle("Forgive part of the debt with no cash movement"),
    );
    fireEvent.change(screen.getByPlaceholderText("0.00"), {
      target: { value: "5" },
    });
    // Two "Write off" buttons exist once the modal is open: the page's own
    // trigger (still in the DOM behind the overlay) and the modal's confirm
    // button, which renders LAST in document order.
    const writeOffButtons = screen.getAllByRole("button", {
      name: "Write off",
    });
    fireEvent.click(writeOffButtons[writeOffButtons.length - 1]);

    await waitFor(() => expect(mockDebtWriteOff).toHaveBeenCalled());
    expect(mockAppEventsEmit).toHaveBeenCalledWith("debt:changed");
  });

  it("emits 'debt:changed' after a successful Add Credit / Debt entry", async () => {
    mockGetClientBalance.mockResolvedValue({
      success: true,
      data: { balance_usd: 0, balance_lbp: 0 },
    });
    mockAddAccountEntry.mockResolvedValue({ success: true });

    render(<Debts />);

    fireEvent.click(await screen.findByText("Add Credit / Debt"));
    fireEvent.click(screen.getByText("Pick Alex Credit"));
    // Only the credit modal's own USD field has this placeholder while it's
    // open (the repayment modal's matching field lives inside the mocked-out
    // CounterpartySettleModal, and the write-off modal isn't open here).
    fireEvent.change(screen.getByPlaceholderText("0.00"), {
      target: { value: "5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Credit" }));

    await waitFor(() => expect(mockAddAccountEntry).toHaveBeenCalled());
    expect(mockAddAccountEntry.mock.calls[0][0]).toMatchObject({
      clientId: CREDIT_CLIENT.id,
    });
    expect(mockAppEventsEmit).toHaveBeenCalledWith("debt:changed");
  });

  it("emits 'debt:changed' after a successful Excel import", async () => {
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
    const alertSpy = jest.spyOn(window, "alert").mockImplementation(() => {});
    mockImportClientDebts.mockResolvedValue({
      success: true,
      result: {
        clientsCreated: 1,
        clientsSkipped: 0,
        clientsDiscarded: 0,
        entriesImported: 1,
        duplicatesSkipped: 0,
        errors: [],
      },
    });

    const { container } = render(<Debts />);
    await screen.findByText("Import Excel");

    const fileInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const file = new File(["dummy"], "ledger.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    // jest-environment-jsdom 30.2.0's nested jsdom 26.1.0 implements only
    // slice/size/type on File/Blob (no arrayBuffer), and jest does not inject
    // Node's Blob — so the unstubbed call throws a TypeError inside
    // handleImportFile, caught silently, and executeImport/importClientDebts
    // is never reached (2026-09-24 fix round, reviewer finding major #1).
    // Stub it on the instance; xlsx.read is mocked outright so the buffer
    // content is irrelevant.
    Object.defineProperty(file, "arrayBuffer", {
      value: () => Promise.resolve(new ArrayBuffer(8)),
    });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(mockImportClientDebts).toHaveBeenCalled());
    expect(mockAppEventsEmit).toHaveBeenCalledWith("debt:changed");

    confirmSpy.mockRestore();
    alertSpy.mockRestore();
  });
});
