/** @jest-environment jsdom */
/**
 * LIRA-097 — Partners page "Add Credit / Debt" and LBP currency.
 *
 * Investigation finding (task LIRA-097): the Currency <Select> inside
 * RecordTxModal (shared by "Record Transaction" AND the `adjustmentOnly`
 * "Add Credit / Debt" mode) has offered USD AND LBP since 2026-06-22 (git
 * blame b3f96649) — well before the owner's 2026-08-07 note that it "only
 * offers USD". PartnerService.recordPartnerTransaction /
 * PartnerRepository.addLedgerEntry pass `currency` straight through into
 * `partner_ledger.currency`, a free TEXT column with NO CHECK constraint
 * (electron-app/create_db.sql) — unlike `settlement_method`, which IS
 * CHECK-constrained. Both the IPC handler (electron-app) and the REST route
 * (backend/src/api/partners.ts `POST /transactions`) validate through the
 * SAME shared `partnerRecordTransactionSchema`
 * (packages/core/src/validators/partner.ts), which accepts any non-empty
 * currency string. So the ticket's premise — "LBP isn't selectable" — does
 * not hold against the current code; no source change was needed. This test
 * locks the existing behavior in as a regression guard, since no test
 * previously covered the LBP path (only USD is exercised in
 * lira-121-partner-payment-debt-profit.spec.ts /
 * lira-126-owner-notes-money-flows.spec.ts).
 *
 * Rule 17 (failing-first): temporarily changing the Currency <Select>'s
 * `options` in RecordTxModal (frontend/src/features/partners/pages/Partners/index.tsx)
 * to drop the LBP entry (`[{ value: "USD", label: "USD" }]` only) makes this
 * test fail — `select-USD-LBP` (the testid the mocked Select below derives
 * from `options`) is never found. Confirmed red against that reverted code,
 * then restored — see the task report.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Partners from "../index";

const mockGetAllBalances = jest.fn();
const mockGetLedger = jest.fn();
const mockRecordTransaction = jest.fn();
const mockAppEventsEmit = jest.fn();

jest.mock("@liratek/ui", () => ({
  useApi: () => ({
    partners: {
      getAllBalances: mockGetAllBalances,
      getLedger: mockGetLedger,
      recordTransaction: mockRecordTransaction,
      settle: jest.fn(),
      writeOff: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      deactivate: jest.fn(),
      activate: jest.fn(),
      getBalance: jest.fn(),
    },
  }),
  // Wrapped in a closure — a direct `{ emit: mockAppEventsEmit }` property
  // would be evaluated at jest.mock() factory time (hoisted above this
  // file's `const mockAppEventsEmit = jest.fn()`), throwing a TDZ error.
  appEvents: { emit: (...args: unknown[]) => mockAppEventsEmit(...args) },
  // Not exercised by this test (SettleModal isn't opened) — a stub is enough
  // so the module-level import in Partners/index.tsx resolves.
  CounterpartySettleModal: () => null,
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
  DecimalInput: ({
    value,
    onChange,
    placeholder,
    autoFocus,
  }: {
    value: number;
    onChange: (n: number) => void;
    placeholder?: string;
    autoFocus?: boolean;
  }) => (
    <input
      placeholder={placeholder}
      autoFocus={autoFocus}
      value={value === 0 ? "" : String(value)}
      onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
    />
  ),
  // testid is DERIVED from `options` so the Currency select (options exactly
  // ["USD","LBP"]) can be targeted unambiguously even though the page also
  // renders other <Select>s (ledger filters) with different option sets.
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
      data-testid={`select-${options.map((o) => o.value).join("-")}`}
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
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, username: "admin", role: "admin" } }),
}));

jest.mock("@/shared/hooks/useModalFocusFix", () => ({
  useModalFocusFix: () => {},
}));

const PARTNER = {
  id: 1,
  name: "Acme Partner",
  phone: null,
  notes: null,
  is_active: 1,
  system_association: null,
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
  usd: 0,
  lbp: 0,
  usdt: 0,
};

describe("Partners page — Add Credit/Debt LBP currency (LIRA-097)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAllBalances.mockResolvedValue([PARTNER]);
    mockGetLedger.mockResolvedValue({
      entries: [],
      balance: { usd: 0, lbp: 0, usdt: 0 },
      breakdown: null,
    });
    mockRecordTransaction.mockResolvedValue({
      success: true,
      data: { id: 42 },
    });
  });

  it("offers LBP as a selectable currency on Add Credit/Debt and books the entry in LBP", async () => {
    render(<Partners />);

    fireEvent.click(await screen.findByText("Acme Partner"));

    // Exactly one "Add Credit / Debt" control exists before the modal opens
    // — the DetailPanel action button.
    const openButton = await screen.findByRole("button", {
      name: "Add Credit / Debt",
    });
    fireEvent.click(openButton);

    const currencySelect = await screen.findByTestId("select-USD-LBP");
    expect(currencySelect).toBeInTheDocument();
    fireEvent.change(currencySelect, { target: { value: "LBP" } });

    const amountInput = screen.getByPlaceholderText("0.00");
    fireEvent.change(amountInput, { target: { value: "50000" } });

    // Now TWO "Add Credit / Debt" controls exist (action button + modal
    // submit button) — the submit button is the modal's, rendered last.
    const buttons = screen.getAllByRole("button", {
      name: "Add Credit / Debt",
    });
    expect(buttons.length).toBe(2);
    fireEvent.click(buttons[buttons.length - 1]);

    await waitFor(() => expect(mockRecordTransaction).toHaveBeenCalled());
    const payload = mockRecordTransaction.mock.calls[0][0];
    expect(payload.currency).toBe("LBP");
    expect(payload.amount).toBe(50000);
    expect(payload.partnerId).toBe(1);
    expect(payload.transactionType).toBe("ADJUSTMENT");
  });
});
