/** @jest-environment jsdom */

/**
 * recharge/components/HistoryModal.tsx — refunded-row display (LIRA-131).
 *
 * This ONE component is shared by both `recharges` (TelecomForm) and the
 * cost-flow slice of `financial_services` (KatchForm/FinancialForm/
 * OmtWhishAppTransferForm/CryptoForm) — both are in
 * `TransactionRepository._markSourceRefunded`'s supported-tables whitelist
 * (migration v68). The "Refunded" badge JSX already existed here
 * (`isRefunded = Boolean(tx.is_refunded)`, LIRA-131 audit: "dead badge
 * ready") — it was starved because `RechargeRepository.getColumns()` /
 * `FinancialServiceRepository.getColumns()` never projected `is_refunded`/
 * `refunded_at` (fixed in this same change; see
 * RechargeRepository.refundedRead.test.ts and
 * FinancialServiceRepository.refundedRead.test.ts for the backend-side
 * proof). This test proves the frontend half: given data shaped exactly
 * like the FIXED repositories now return it, the badge renders and the
 * Profit/Fee columns are neutralised (muted + struck through + tooltip)
 * rather than presenting reversed income as live — the second half of this
 * fix, mirroring e47dfa2 (Custom Services).
 *
 * Rule 17 (failing-first): the Profit-column neutralisation added by this
 * change did not exist before it (the className ternary had no `isRefunded`
 * branch at all). Temporarily reverting it made "does not present a live
 * profit" FAIL (the refunded row's commission rendered plain
 * `text-emerald-400`, indistinguishable from the live row) while the badge
 * assertion still passed (the badge logic pre-dated this fix) — confirmed
 * manually, then reverted (see task report for the exact captured output).
 */

import { render, screen, within } from "@testing-library/react";
import { HistoryModal } from "../HistoryModal";
import type { FinancialTransaction } from "../../types";

// HistoryModal calls useShopInfo() unconditionally (for the Print handler),
// which fetches shop settings via useApi().getAllSettings() on mount.
jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    getAllSettings: jest.fn().mockResolvedValue([]),
  }),
}));

const REFUNDED_CLIENT = "Refunded Client";
const LIVE_CLIENT = "Live Client";

describe("recharge/HistoryModal — refunded row display (LIRA-131)", () => {
  describe("single-column mode (recharges — no cost, plain Profit column)", () => {
    const transactions: FinancialTransaction[] = [
      {
        id: 1,
        provider: "MTC",
        service_type: "SEND",
        amount: 10,
        currency: "USD",
        cost: 0,
        commission: 2,
        client_name: REFUNDED_CLIENT,
        created_at: "2026-08-10 20:00:00",
        is_refunded: 1,
        refunded_at: "2026-08-10 21:00:00",
      },
      {
        id: 2,
        provider: "MTC",
        service_type: "SEND",
        amount: 5,
        currency: "USD",
        cost: 0,
        commission: 1,
        client_name: LIVE_CLIENT,
        created_at: "2026-08-10 19:00:00",
        is_refunded: 0,
        refunded_at: null,
      },
    ];

    function renderModal() {
      render(
        <HistoryModal
          transactions={transactions}
          provider="MTC"
          onClose={jest.fn()}
          onRefresh={jest.fn()}
        />,
      );
    }

    it("shows a Refunded badge on the refunded row and NOT on the live row", () => {
      renderModal();

      const refundedRow = screen.getByText(REFUNDED_CLIENT).closest("tr");
      const liveRow = screen.getByText(LIVE_CLIENT).closest("tr");
      expect(refundedRow).not.toBeNull();
      expect(liveRow).not.toBeNull();

      expect(
        within(refundedRow as HTMLElement).getByText("Refunded"),
      ).toBeInTheDocument();
      expect(
        within(liveRow as HTMLElement).queryByText("Refunded"),
      ).not.toBeInTheDocument();
    });

    it("does not present a live profit for the refunded row, while the live row's profit stays live", () => {
      renderModal();

      const refundedRow = screen.getByText(REFUNDED_CLIENT).closest("tr");
      const liveRow = screen.getByText(LIVE_CLIENT).closest("tr");

      const refundedProfit = within(refundedRow as HTMLElement).getByText(
        "2.00 USD",
      );
      expect(refundedProfit.className).not.toContain("text-emerald-400");
      expect(refundedProfit.className).toContain("line-through");

      const liveProfit = within(liveRow as HTMLElement).getByText("1.00 USD");
      expect(liveProfit.className).toContain("text-emerald-400");
      expect(liveProfit.className).not.toContain("line-through");
    });
  });

  describe("Fee + Profit split mode (financial_services cost-flow rows — Katsh/iPick/Whish App)", () => {
    const transactions: FinancialTransaction[] = [
      {
        id: 3,
        provider: "Katsh",
        service_type: "SEND",
        amount: 10,
        currency: "USD",
        cost: 8,
        commission: 2,
        client_name: REFUNDED_CLIENT,
        created_at: "2026-08-10 20:00:00",
        is_refunded: 1,
        refunded_at: "2026-08-10 21:00:00",
      },
      {
        id: 4,
        provider: "Katsh",
        service_type: "SEND",
        amount: 10,
        currency: "USD",
        cost: 8,
        commission: 2,
        client_name: LIVE_CLIENT,
        created_at: "2026-08-10 19:00:00",
        is_refunded: 0,
        refunded_at: null,
      },
    ];

    it("neutralises the split Profit column (cost>0 branch) on the refunded row only", () => {
      render(
        <HistoryModal
          transactions={transactions}
          provider="Katsh"
          onClose={jest.fn()}
          onRefresh={jest.fn()}
          showFeeAndProfit
        />,
      );

      const refundedRow = screen.getByText(REFUNDED_CLIENT).closest("tr");
      const liveRow = screen.getByText(LIVE_CLIENT).closest("tr");

      const refundedProfit = within(refundedRow as HTMLElement).getByText(
        "2.00 USD",
      );
      expect(refundedProfit.className).not.toContain("text-emerald-400");
      expect(refundedProfit.className).toContain("line-through");

      const liveProfit = within(liveRow as HTMLElement).getByText("2.00 USD");
      expect(liveProfit.className).toContain("text-emerald-400");
      expect(liveProfit.className).not.toContain("line-through");
    });
  });
});
