/** @jest-environment jsdom */
/**
 * LIRA-350 (review C13 / B11) — a session basket item opened on the
 * client's Accounts page reads in the client's words: a human label
 * ("Recharge", not "recharge_mtc"), the item's line, how it was paid — and
 * no unit cost, product id or saved-data dump, even for an admin.
 *
 * Rule 17: NOT proven failing-first — written after the modal was switched
 * to the client view in the same change.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SessionDebtDetailModal } from "../SessionDebtDetailModal";

const mockApi = {
  session: {
    cartGet: jest.fn().mockResolvedValue({ success: true, items: [] }),
    getTransactions: jest.fn(),
  },
  getRecentTransactions: jest.fn(),
};
jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));
const mockAuth = { user: { role: "admin" } };
jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => mockAuth,
}));
const mockPaymentMethods = {
  methods: [{ code: "CASH", label: "Cash" }],
  allMethods: [{ code: "CASH", label: "Cash" }],
};
jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => mockPaymentMethods,
}));
jest.mock("@/shared/hooks/useModalFocusFix", () => ({
  useModalFocusFix: () => {},
}));

const SALE_ROW = {
  id: 501,
  type: "SALE",
  summary: "Sale #283: 1× iPhone 15 Clear MagSafe Case — $12",
  amount_usd: 12,
  amount_lbp: 0,
  metadata_json: JSON.stringify({
    details: {
      v: 1,
      kind: "pos_sale",
      items: [
        {
          productId: 108,
          name: "iPhone 15 Clear MagSafe Case",
          quantity: 1,
          unitPrice: 12,
          unitCost: 4,
        },
      ],
    },
    payment_snapshot: {
      lines: [{ method: "CASH", currency: "USD", amount: 12, direction: "IN" }],
    },
  }),
};
const MTC_ROW = {
  id: 502,
  type: "RECHARGE",
  summary: "Recharge: MTC Credits $6 — 600,000 LBP",
  amount_usd: 0,
  amount_lbp: 600000,
  metadata_json: JSON.stringify({
    provider: "MTC",
    cost: 510000,
    details: {
      v: 1,
      kind: "telecom_recharge",
      carrier: "MTC",
      type: "CREDIT_TRANSFER",
      phone: "03261026",
      amount: 6,
    },
  }),
};

it("shows each basket item in the client's words, never its cost", async () => {
  mockApi.session.getTransactions.mockResolvedValue({
    success: true,
    transactions: [
      {
        id: 1,
        transaction_type: "sale",
        amount_usd: 12,
        amount_lbp: 0,
        unified_transaction_id: 501,
        created_at: "2026-10-26 22:28:50",
      },
      {
        id: 2,
        transaction_type: "recharge_mtc",
        amount_usd: 0,
        amount_lbp: 600000,
        unified_transaction_id: 502,
        created_at: "2026-10-26 22:28:50",
      },
    ],
  });
  mockApi.getRecentTransactions.mockResolvedValue([SALE_ROW, MTC_ROW]);

  render(
    <SessionDebtDetailModal
      sessionId={162}
      debtAmountUsd={0}
      debtAmountLbp={600000}
      onClose={() => {}}
    />,
  );
  await waitFor(() => expect(screen.getByText("Recharge")).toBeInTheDocument());
  expect(screen.queryByText(/recharge_mtc/i)).toBeNull();
  expect(
    screen.getByText("MTC $6 credit → 03261026 — 600,000 LBP"),
  ).toBeInTheDocument();

  fireEvent.click(screen.getByTestId("session-line-1"));
  expect(await screen.findByText("Cash")).toBeInTheDocument();
  expect(screen.getByText("iPhone 15 Clear MagSafe Case")).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(
    /cost|product id|productId|Other saved data|\$4\b/i,
  );
});
