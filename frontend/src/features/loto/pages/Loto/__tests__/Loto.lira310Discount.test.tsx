/** @jest-environment jsdom */

/**
 * LIRA-310 T031 — the Loto page's Discount (and so its Waive) now WORKS.
 *
 * Before: the payment input showed a Discount field (MultiPaymentInput's
 * default `showDiscount`) that lowered the on-screen total, but the page
 * never booked it — nothing reached the server, which then refused the sale
 * as underpaid. Now the page:
 *   - books it (`onDiscountChange`) and caps it at the ticket's commission
 *     (`maxDiscount`, LBP) — the built-in Waive then works too;
 *   - sends it ONCE in the sell payload as `discount_lbp` (whole LBP),
 *     never when it is 0;
 *   - hides it in session-cart mode (the basket's own Waive owns that case)
 *     and never sends it there;
 *   - forgets it after a sale.
 *
 * Payloads are parsed through the core `lotoSellSchema` (rule 24).
 * Rule 17: run against the unchanged page first; see tasks.md T031.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { lotoSellSchema } from "@liratek/core";
import type { PaymentLine } from "@liratek/ui";
import { LotoPage } from "../index";

const mockLotoSettingsGet = jest.fn();
const mockLotoReport = jest.fn();
const mockSell = jest.fn();
const mockFetchClientVouchers = jest.fn();
const mockAddToCart = jest.fn();
const mockActiveSession: { current: { id: number } | null } = { current: null };

let lastPaymentProps: Record<string, unknown> = {};

const SALE = 500_000;
const COMMISSION = SALE * 0.0445; // the page's default commission rate

// Rule 25: ONE stable object, never a fresh literal per useApi() call.
const mockApi = {
  loto: {
    settings: { get: mockLotoSettingsGet },
    report: mockLotoReport,
    sell: mockSell,
  },
};

const LINES_480: PaymentLine[] = [
  { id: "l1", method: "CASH", currencyCode: "LBP", amount: 480_000 },
];

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return {
    ...actual,
    useApi: () => mockApi,
    appEvents: { emit: jest.fn(), on: jest.fn(() => () => {}) },
    DecimalInput: (p: { onChange: (n: number) => void }) => (
      <input
        aria-label="sale-amount"
        onChange={(e) => p.onChange(Number(e.target.value))}
      />
    ),
    MultiPaymentInput: (p: Record<string, unknown>) => {
      lastPaymentProps = p;
      return (
        <>
          <button
            type="button"
            onClick={() =>
              (p.onChange as (l: PaymentLine[]) => void)(LINES_480)
            }
          >
            stub-pay
          </button>
          <button
            type="button"
            onClick={() =>
              (p.onDiscountChange as ((d: number) => void) | undefined)?.(
                20_000.4,
              )
            }
          >
            stub-discount
          </button>
        </>
      );
    },
  };
});

jest.mock("@/shared/utils/clientVouchers", () => ({
  fetchClientVouchers: (...a: unknown[]) => mockFetchClientVouchers(...a),
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

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 90000, buyRate: 89000, isLoading: false }),
}));

jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({
    activeSession: mockActiveSession.current,
    addToCart: mockAddToCart,
  }),
}));

jest.mock("@/shared/hooks/useAutoPrintReceipt", () => ({
  useAutoPrintReceipt: () => jest.fn(),
}));

jest.mock("@/features/recharge/utils/ensureClient", () => ({
  ensureRechargeClient: jest.fn(async () => ({ ok: true, id: 7 })),
}));

jest.mock("@/shared/components/TransactionTimeOverride", () => ({
  TransactionTimeOverride: () => null,
}));

jest.mock("@/shared/components/ClientAutocompleteInput", () => ({
  ClientAutocompleteInput: (p: {
    onClientSelect: (c: {
      id: number;
      full_name: string;
      phone_number: string;
    }) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        p.onClientSelect({ id: 7, full_name: "Ali", phone_number: "70123456" })
      }
    >
      pick-client
    </button>
  ),
}));

jest.mock("@/features/partners/components/ForPartnerToggle", () => ({
  ForPartnerToggle: () => null,
  ForPartnerNotice: () => null,
}));

// Relative to THIS file (pages/Loto/__tests__/), not to index.tsx.
jest.mock("../../../components/StatsCards", () => ({
  StatsCards: () => null,
}));
jest.mock("../../../components/CheckpointHistory", () => ({
  CheckpointHistory: () => null,
}));
jest.mock("../../../components/TicketHistoryModal", () => ({
  TicketHistoryModal: () => null,
}));
jest.mock("../../../components/CheckpointScheduler", () => ({
  CheckpointScheduler: () => null,
}));


function sellButton(): HTMLElement {
  // The tab header is also a "Sell Ticket" button; the submit one is last.
  const b = screen.getAllByRole("button", { name: /sell ticket/i });
  return b[b.length - 1];
}

function enterSale(amount = SALE): void {
  fireEvent.change(screen.getByLabelText("sale-amount"), {
    target: { value: String(amount) },
  });
}

describe("LotoPage — the Discount / Waive is booked and sent (LIRA-310)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    lastPaymentProps = {};
    mockActiveSession.current = null;
    mockLotoSettingsGet.mockResolvedValue({ success: false });
    mockLotoReport.mockResolvedValue({ success: false });
    mockSell.mockResolvedValue({ success: true, ticket: { id: 1 } });
    mockFetchClientVouchers.mockResolvedValue([]);
  });

  it("books the discount and caps it at the ticket's commission", () => {
    render(<LotoPage />);
    enterSale();
    expect(typeof lastPaymentProps.onDiscountChange).toBe("function");
    expect(lastPaymentProps.maxDiscount).toBeCloseTo(COMMISSION, 6);
    expect(lastPaymentProps.showDiscount).not.toBe(false);
  });

  it("sends the discount once, as whole LBP, through the schema", async () => {
    render(<LotoPage />);
    enterSale();
    fireEvent.click(screen.getByText("stub-pay"));
    fireEvent.click(screen.getByText("stub-discount"));
    fireEvent.click(sellButton());
    await waitFor(() => expect(mockSell).toHaveBeenCalledTimes(1));
    const parsed = lotoSellSchema.parse(mockSell.mock.calls[0][0]);
    expect(parsed.discount_lbp).toBe(20_000);
    expect(parsed.discount_usd).toBeUndefined();
  });

  it("sends no discount key when there is none", async () => {
    render(<LotoPage />);
    enterSale();
    fireEvent.click(screen.getByText("stub-pay"));
    fireEvent.click(sellButton());
    await waitFor(() => expect(mockSell).toHaveBeenCalledTimes(1));
    expect("discount_lbp" in mockSell.mock.calls[0][0]).toBe(false);
  });

  it("forgets the discount after a sale", async () => {
    render(<LotoPage />);
    enterSale();
    fireEvent.click(screen.getByText("stub-pay"));
    fireEvent.click(screen.getByText("stub-discount"));
    fireEvent.click(sellButton());
    await waitFor(() => expect(mockSell).toHaveBeenCalledTimes(1));
    // (the stub input is uncontrolled — a new value so onChange fires)
    enterSale(480_000);
    fireEvent.click(screen.getByText("stub-pay"));
    fireEvent.click(sellButton());
    await waitFor(() => expect(mockSell).toHaveBeenCalledTimes(2));
    expect("discount_lbp" in mockSell.mock.calls[1][0]).toBe(false);
  });

  it("session cart: the discount is hidden and never sent with the cart line", async () => {
    mockActiveSession.current = { id: 9 };
    render(<LotoPage />);
    enterSale();
    expect(lastPaymentProps.showDiscount).toBe(false);
    fireEvent.click(screen.getByText("stub-pay"));
    fireEvent.click(screen.getByText("stub-discount"));
    fireEvent.click(sellButton());
    await waitFor(() => expect(mockAddToCart).toHaveBeenCalledTimes(1));
    const formData = mockAddToCart.mock.calls[0][0].formData as Record<string, unknown>;
    expect("discount_lbp" in formData).toBe(false);
  });
});

// LIRA-316 follow-up — in a session the ticket goes into the basket and the
// server drops the item's OUT legs (deferPayment): the basket checkout owns
// the change. So the item sheet must not offer change-to-account there.
describe("LotoPage — change to account is not offered inside a session", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    lastPaymentProps = {};
    mockActiveSession.current = null;
    mockLotoSettingsGet.mockResolvedValue({ success: false });
    mockLotoReport.mockResolvedValue({ success: false });
    mockFetchClientVouchers.mockResolvedValue([]);
  });

  it("guard: outside a session, with a client, the account is offered", () => {
    render(<LotoPage />);
    enterSale();
    fireEvent.click(screen.getByText("pick-client"));
    expect(lastPaymentProps.hasClient).toBe(true);
    expect(lastPaymentProps.unreturnedChangeTo).toBe("CUSTOMER_ACCOUNT");
  });

  it("in a session, even with a client, no unreturnedChangeTo is passed", () => {
    mockActiveSession.current = { id: 9 };
    render(<LotoPage />);
    enterSale();
    fireEvent.click(screen.getByText("pick-client"));
    // Rule 28a: the sheet rendered with a client, so only the session gate
    // can be what withholds the account.
    expect(lastPaymentProps.hasClient).toBe(true);
    expect(lastPaymentProps.unreturnedChangeTo).toBeUndefined();
  });
});
