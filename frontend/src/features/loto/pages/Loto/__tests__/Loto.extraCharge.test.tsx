/** @jest-environment jsdom */

/**
 * LIRA-319 T048 (Loto) — the Loto page's "+ Extra" (the other side of the
 * payment input's Discount line).
 *
 * The page:
 *   - turns extra mode on (`onExtraChange`), capped at the ticket itself
 *     (`maxExtra`, LBP — the ticket's currency);
 *   - sends it ONCE in the sell payload as `extra_lbp` (whole LBP), never
 *     when it is 0, and never `extra_usd`;
 *   - leaves the sale amount (face value), commission rate and discount
 *     fields as they are;
 *   - does not offer it in session-cart mode (the basket checkout owns it,
 *     FR-010) and never sends it there;
 *   - forgets it after a sale.
 *
 * Payloads are parsed through the core `lotoSellSchema` (rule 24).
 * Not proven failing-first (rule 17): written after the page change.
 *
 * (Fixture scaffolding is shared with Loto.lira310Discount.test.tsx.)
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

// Rule 25: ONE stable object, never a fresh literal per useApi() call.
const mockApi = {
  loto: {
    settings: { get: mockLotoSettingsGet },
    report: mockLotoReport,
    sell: mockSell,
  },
};

const EXTRA = 10_000;
const LINES_510: PaymentLine[] = [
  { id: "l1", method: "CASH", currencyCode: "LBP", amount: SALE + EXTRA },
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
              (p.onChange as (l: PaymentLine[]) => void)(LINES_510)
            }
          >
            stub-pay
          </button>
          <button
            type="button"
            onClick={() =>
              (p.onExtraChange as ((d: number) => void) | undefined)?.(
                EXTRA + 0.4,
              )
            }
          >
            stub-extra
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

describe("LotoPage — the + Extra is booked and sent (LIRA-319)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    lastPaymentProps = {};
    mockActiveSession.current = null;
    mockLotoSettingsGet.mockResolvedValue({ success: false });
    mockLotoReport.mockResolvedValue({ success: false });
    mockSell.mockResolvedValue({ success: true, ticket: { id: 1 } });
    mockFetchClientVouchers.mockResolvedValue([]);
  });

  it("turns extra mode on, capped at the ticket itself", () => {
    render(<LotoPage />);
    enterSale();
    expect(typeof lastPaymentProps.onExtraChange).toBe("function");
    expect(lastPaymentProps.maxExtra).toBe(SALE);
  });

  it("sends the extra once, as whole LBP, through the schema; price fields unchanged", async () => {
    render(<LotoPage />);
    enterSale();
    fireEvent.click(screen.getByText("stub-pay"));
    fireEvent.click(screen.getByText("stub-extra"));
    fireEvent.click(sellButton());
    await waitFor(() => expect(mockSell).toHaveBeenCalledTimes(1));
    const parsed = lotoSellSchema.parse(mockSell.mock.calls[0][0]);
    expect(parsed.extra_lbp).toBe(EXTRA);
    expect(parsed.extra_usd).toBeUndefined();
    // Face value, commission rate and discount are not touched by the extra.
    expect(parsed.sale_amount).toBe(SALE);
    expect(parsed.commission_rate).toBeCloseTo(0.0445, 6);
    expect(parsed.discount_lbp).toBeUndefined();
    expect(parsed.discount_usd).toBeUndefined();
    // The legs carry what the customer actually paid (ticket + extra).
    expect(parsed.payments).toEqual([
      { method: "CASH", currencyCode: "LBP", amount: SALE + EXTRA },
    ]);
  });

  it("sends no extra key when there is none", async () => {
    render(<LotoPage />);
    enterSale();
    fireEvent.click(screen.getByText("stub-pay"));
    fireEvent.click(sellButton());
    await waitFor(() => expect(mockSell).toHaveBeenCalledTimes(1));
    expect("extra_lbp" in mockSell.mock.calls[0][0]).toBe(false);
    expect("extra_usd" in mockSell.mock.calls[0][0]).toBe(false);
  });

  it("forgets the extra after a sale", async () => {
    render(<LotoPage />);
    enterSale();
    fireEvent.click(screen.getByText("stub-pay"));
    fireEvent.click(screen.getByText("stub-extra"));
    fireEvent.click(sellButton());
    await waitFor(() => expect(mockSell).toHaveBeenCalledTimes(1));
    enterSale(510_000);
    fireEvent.click(screen.getByText("stub-pay"));
    fireEvent.click(sellButton());
    await waitFor(() => expect(mockSell).toHaveBeenCalledTimes(2));
    expect("extra_lbp" in mockSell.mock.calls[1][0]).toBe(false);
  });

  it("session cart: the extra is not offered and never sent with the cart line", async () => {
    mockActiveSession.current = { id: 9 };
    render(<LotoPage />);
    enterSale();
    expect(lastPaymentProps.onExtraChange).toBeUndefined();
    fireEvent.click(screen.getByText("stub-pay"));
    fireEvent.click(screen.getByText("stub-extra"));
    fireEvent.click(sellButton());
    await waitFor(() => expect(mockAddToCart).toHaveBeenCalledTimes(1));
    const formData = mockAddToCart.mock.calls[0][0].formData as Record<
      string,
      unknown
    >;
    expect("extra_lbp" in formData).toBe(false);
    expect("extra_usd" in formData).toBe(false);
  });
});
