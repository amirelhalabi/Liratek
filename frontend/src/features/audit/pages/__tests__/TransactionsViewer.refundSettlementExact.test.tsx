/** @jest-environment jsdom */
/**
 * LIRA-373 (owner decision 2026-11-05) — a supplier/partner settlement is
 * refunded by EXACT reversal only. Production tx 15456 (Cornertech): an OMT
 * settlement that collected $7,492.70 and paid 60,000,000 LBP at 89,000. The
 * refund window folded the lira leg into the dollar leg as if it were
 * customer change, pre-filled ONE "Cash $6,818.54" line, and even an
 * untouched Confirm sent it as a refundLegs override.
 *
 * Runs the REAL RefundMethodModal (not a stub): the window must show both
 * original legs, read-only, and an untouched Confirm must send NO refundLegs
 * (and no rate), so the server mirrors each leg negated.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import TransactionsViewer from "../TransactionsViewer";

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, username: "tester", role: "admin" } }),
}));
import {
  getRecentTransactions,
  refundTransaction,
  getRefundBookedRate,
} from "@/api/backendApi";

jest.mock("@/api/backendApi", () => ({
  getRecentTransactions: jest.fn(),
  voidTransaction: jest.fn(),
  refundTransaction: jest.fn(),
  voidCheckoutGroup: jest.fn(),
  voidSessionBasket: jest.fn(),
  refundSessionBasket: jest.fn(),
  getSaleItems: jest.fn(),
  getProductUnitsForSaleItems: jest.fn().mockResolvedValue([]),
  getRefundBookedRate: jest.fn(),
}));

const mockApi = {
  getSessionItemRefundPreview: jest.fn(),
  refundSessionBasketItem: jest.fn(),
};
jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: [],
    drawerAffectingMethods: [
      { code: "CASH", label: "Cash" },
      { code: "WHISH", label: "Whish" },
    ],
    allMethods: [],
    loading: false,
    refresh: jest.fn(),
  }),
}));

jest.mock("@/hooks/useShopName", () => ({
  useShopInfo: () => ({ name: "Test Shop", phone: "", location: "", logo: "" }),
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 89500, buyRate: 89000, isLoading: false }),
}));

const mockGetRecentTransactions = getRecentTransactions as jest.MockedFunction<
  typeof getRecentTransactions
>;
const mockRefundTransaction = refundTransaction as jest.MockedFunction<
  typeof refundTransaction
>;
const mockGetRefundBookedRate = getRefundBookedRate as jest.MockedFunction<
  typeof getRefundBookedRate
>;

function settlementRow(type: string) {
  return {
    id: 15456,
    type,
    status: "ACTIVE",
    source_table: "supplier_ledger",
    source_id: 1,
    user_id: 1,
    amount_usd: 7492.7,
    amount_lbp: -60_000_000,
    exchange_rate: 89000,
    client_id: null,
    reverses_id: null,
    summary: "OMT settlement",
    metadata_json: null,
    device_id: null,
    created_at: "2026-11-04 10:00:00",
    username: "cashier",
    client_name: null,
    session_id: null,
    reversed_by_id: null,
    payments: [
      {
        direction: "in",
        amount: 7492.7,
        signed_amount: 7492.7,
        currency_code: "USD",
        method: "CASH",
        drawer_name: "OMT_System",
      },
      {
        direction: "out",
        amount: 60_000_000,
        signed_amount: -60_000_000,
        currency_code: "LBP",
        method: "CASH",
        drawer_name: "OMT_System",
      },
    ],
  };
}

describe.each(["SUPPLIER_SETTLEMENT", "PARTNER_SETTLEMENT"])(
  "TransactionsViewer — refunding a %s is an exact reversal",
  (type) => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockRefundTransaction.mockResolvedValue({ success: true } as never);
      mockGetRefundBookedRate.mockResolvedValue({
        success: true,
        bookedRate: 89000,
        bookedRateSource: "transaction",
      });
    });

    async function openRefund(): Promise<void> {
      mockGetRecentTransactions.mockResolvedValue([
        settlementRow(type),
      ] as never);
      render(
        <TransactionsViewer
          limit="50"
          selectedFilters={[]}
          search=""
          from=""
          to=""
        />,
      );
      await waitFor(() => expect(mockGetRecentTransactions).toHaveBeenCalled());
      fireEvent.click(await screen.findByRole("button", { name: /^refund$/i }));
      await screen.findByRole("button", { name: "Confirm Refund" });
    }

    it("an untouched Confirm sends NO refundLegs and no rate", async () => {
      await openRefund();
      fireEvent.click(screen.getByRole("button", { name: "Confirm Refund" }));

      await waitFor(() =>
        expect(mockRefundTransaction).toHaveBeenCalledTimes(1),
      );
      const [id, refundLegs, , rate] = mockRefundTransaction.mock.calls[0];
      expect(id).toBe(15456);
      expect(refundLegs).toBeUndefined();
      expect(rate).toBeUndefined();
    });

    it("shows both original legs read-only — never the folded one-line total, no amount/method inputs", async () => {
      await openRefund();
      expect(screen.queryByText(/6,818/)).toBeNull();
      expect(screen.queryAllByRole("spinbutton")).toHaveLength(0);
      expect(screen.queryAllByRole("textbox")).toHaveLength(0);
      expect(screen.queryAllByRole("combobox")).toHaveLength(0);
      const legs = screen.getByTestId("refund-exact-legs");
      // The mirror, one line per original leg.
      expect(legs).toHaveTextContent("$7,492.7");
      expect(legs).toHaveTextContent("60,000,000 LBP");
    });
  },
);
