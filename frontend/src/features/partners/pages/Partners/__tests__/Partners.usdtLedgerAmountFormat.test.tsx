/** @jest-environment jsdom */

/**
 * USDT amounts render through the LBP formatter (money-display bug, sixth
 * instance of the class this session — LIRA-119, 121, 122, 129, 130, and
 * this one).
 *
 * `LedgerRow` had TWO copies of a two-way `currency === "USD" ?
 * fmtUSD(...) : fmtLBP(...)` ternary — its own amount cell, and the
 * expanded financial-service detail row's amount. `partner_ledger.currency`
 * and `financial_services.currency` both carry USDT as a real third
 * currency (no CHECK constraint on either column; the Binance flow writes
 * it explicitly — `CryptoForm.tsx`'s `currency: "USDT"`), so a USDT row hit
 * the `else` branch and rendered with LBP's symbol AND LBP's rounding
 * (`maximumFractionDigits: 0`).
 *
 * Rule 17 (failing-first): confirmed by temporarily reverting `LedgerRow`'s
 * two amount cells back to the bare `currency === "USD" ? fmtUSD(...) :
 * fmtLBP(...)` ternaries. Both assertions below then failed with the
 * ACTUAL wrong output:
 *   expect(element).toHaveTextContent(/^45\.50 USDT$/)
 *   Received:  "LBP 46"          (main ledger amount cell, 45.50 USDT in)
 *   Received:  "LBP 12"          (expanded fs-detail amount cell, 12.25 USDT in)
 * i.e. not just the wrong symbol — LBP's 0-decimal rounding also silently
 * mangled the number (45.50 -> 46, 12.25 -> 12). Reverted back to the fix
 * after capturing this.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import Partners from "../index";

const mockGetAllBalances = jest.fn();
const mockGetLedger = jest.fn();
// Hoisted to a STABLE object (not a fresh literal per call) — `useApi()` in
// the real app returns a memoized context value (`ApiProvider.tsx`), so
// `DetailPanel`'s `loadLedger` useCallback (deps include `api`) only
// changes identity when filters actually change. A per-render `() => ({...})`
// mock would give `api` a new identity on every re-render, making
// `loadLedger`'s effect re-fire in a loop that keeps flipping `loading`
// true/false — which unmounts/remounts `LedgerRow` and silently resets its
// local `expanded` state, breaking any test that clicks a row open.
const mockPartnersApi = {
  partners: {
    getAllBalances: mockGetAllBalances,
    getLedger: mockGetLedger,
    recordTransaction: jest.fn(),
    settle: jest.fn(),
    writeOff: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    deactivate: jest.fn(),
    activate: jest.fn(),
    getBalance: jest.fn(),
  },
};

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return {
    ...actual,
    useApi: () => mockPartnersApi,
  };
});

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, username: "admin", role: "admin" } }),
}));

jest.mock("@/shared/hooks/useModalFocusFix", () => ({
  useModalFocusFix: () => {},
}));

function partner(overrides: Partial<Record<string, unknown>> = {}) {
  return {
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
    ...overrides,
  };
}

describe("Partners page — LedgerRow amount cell formats USDT as USDT (money-display bug)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAllBalances.mockResolvedValue([partner()]);
  });

  it("a plain USDT ledger row shows '45.50 USDT', not the LBP formatter's '$'-free rounded LBP string", async () => {
    mockGetLedger.mockResolvedValue({
      entries: [
        {
          id: 901,
          partner_id: 1,
          transaction_type: "ADJUSTMENT",
          reference_table: null,
          reference_id: null,
          amount: 45.5,
          currency: "USDT",
          direction: "DEBIT",
          notes: "USDT debit leg",
          user_id: 1,
          settlement_method: null,
          created_at: "2026-08-11 10:00:00",
          fs_provider: null,
          fs_service_type: null,
          fs_amount: null,
          fs_currency: null,
          fs_fee: null,
          fs_customer: null,
          fs_reference_number: null,
          fs_phone_number: null,
        },
      ],
      balance: { usd: 0, lbp: 0, usdt: -45.5 },
      breakdown: null,
    });

    render(<Partners />);
    fireEvent.click(await screen.findByText("Acme Partner"));

    const amountCell = await screen.findByText(/^45\.50 USDT$/);
    expect(amountCell).toBeInTheDocument();
    // The ONLY "LBP" that may legitimately appear is the "LBP Balance" card
    // label/value (0, unrelated to this USDT row) — assert the wrong LBP
    // rendering of THIS row specifically never appears.
    expect(screen.queryByText(/^LBP 4[56]$/)).not.toBeInTheDocument();
  });

  it("the expanded financial-service detail row also formats its fs_amount as USDT, independent of the main amount cell", async () => {
    mockGetLedger.mockResolvedValue({
      entries: [
        {
          id: 950,
          partner_id: 1,
          transaction_type: "THROUGH_RECEIVE",
          reference_table: "financial_services",
          reference_id: 555,
          amount: 50, // partner-ledger amount — deliberately DIFFERENT from
          // fs_amount below, so the two cells can't accidentally share text
          currency: "USDT",
          direction: "CREDIT",
          notes: "Binance receive detail",
          user_id: 1,
          settlement_method: null,
          created_at: "2026-08-11 12:00:00",
          fs_provider: "BINANCE",
          fs_service_type: "RECEIVE",
          fs_amount: 12.25,
          fs_currency: "USDT",
          fs_fee: 0,
          fs_customer: "Test Customer",
          fs_reference_number: null,
          fs_phone_number: null,
        },
      ],
      balance: { usd: 0, lbp: 0, usdt: 50 },
      breakdown: null,
    });

    render(<Partners />);
    fireEvent.click(await screen.findByText("Acme Partner"));

    // Main ledger amount cell: 50 USDT.
    const mainAmount = await screen.findByText(/^50\.00 USDT$/);
    expect(mainAmount).toBeInTheDocument();

    // Expand the row (it has financial_services details) to reveal the
    // fs_amount cell: 12.25 USDT — a SEPARATE call site, same bug class.
    const row = (await screen.findByText("Binance receive detail")).closest(
      "tr",
    ) as HTMLElement;
    fireEvent.click(row);

    const detailAmount = await screen.findByText(/^12\.25 USDT$/);
    expect(detailAmount.closest("td")).not.toBeNull();
    // Neither amount may have silently rounded through the LBP formatter
    // (fmtLBP(12.25) -> "LBP 12", fmtLBP(50) -> "LBP 50" — the exact wrong
    // strings the pre-fix ternaries produced for these two inputs).
    expect(screen.queryByText(/^LBP 12$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^LBP 50$/)).not.toBeInTheDocument();
  });
});
