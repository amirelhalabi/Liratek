/** @jest-environment jsdom */

/**
 * CryptoForm — Binance history mapping drops is_refunded/refunded_at
 * (LIRA-131 follow-on finding, beyond the audit's original table).
 *
 * The audit that produced this ticket characterized `financial_services` as
 * fixed by ONE repository projection change plus lighting up an
 * already-dead badge. That is true for the iPick/Katsh/Whish App surfaces
 * (KatchForm/FinancialForm/OmtWhishAppTransferForm all pass `finTransactions`
 * — the RAW `api.getOMTHistory()` response, spread with `...h` — straight
 * into `HistoryModal`, so the repository fix alone restores their badge).
 *
 * The Binance/Crypto surface is different: `Recharge/index.tsx`'s
 * `loadBinanceData` hand-builds a NEW `BinanceTransaction` object per row
 * (rather than spreading `...tx`), and CryptoForm.tsx then hand-builds a
 * SECOND new object (`FinancialTransaction`) from THAT to satisfy
 * HistoryModal's prop type — TWO extra translation steps neither of which
 * carried `is_refunded`/`refunded_at`, so the badge stayed dark for Binance
 * even after the repository projection fix (proven separately in
 * FinancialServiceRepository.refundedRead.test.ts) landed. Both mappings are
 * now fixed (this test proves CryptoForm's own re-mapping step; the
 * Recharge/index.tsx half is a one-line, by-inspection change of the exact
 * same shape).
 *
 * Rule 17 (failing-first): temporarily removing the two added lines
 * (`is_refunded: tx.is_refunded ?? 0, refunded_at: tx.refunded_at ?? null`)
 * from CryptoForm.tsx's `binanceTransactions.map(...)` makes this test fail
 * — `is_refunded` reads back `undefined` on the captured HistoryModal props
 * instead of `1` — confirmed manually, then reverted (see task report for
 * the exact captured output).
 */

import { render } from "@testing-library/react";
import { CryptoForm } from "../CryptoForm";
import type { BinanceTransaction } from "../../types";

const mockHistoryModal = jest.fn((_props: unknown) => null);

jest.mock("../HistoryModal", () => ({
  // Spy that captures the exact `transactions` prop CryptoForm computes,
  // without re-testing HistoryModal's own rendering (already covered by
  // HistoryModal.refundedBadge.test.tsx).
  HistoryModal: (props: unknown) => {
    mockHistoryModal(props);
    return null;
  },
}));

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    getClients: jest.fn().mockResolvedValue([]),
  }),
}));

jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({ activeSession: null }),
}));

jest.mock("../PaymentSheet", () => ({ PaymentSheet: () => null }));

jest.mock("@/shared/components/TransactionTimeOverride", () => ({
  TransactionTimeOverride: () => null,
}));

jest.mock("@/shared/components/ClientAutocompleteInput", () => ({
  ClientAutocompleteInput: () => null,
}));

jest.mock("@/features/partners/components/ForPartnerToggle", () => ({
  ForPartnerToggle: () => null,
  ForPartnerNotice: () => null,
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

const REFUNDED_BINANCE_TX: BinanceTransaction = {
  id: 1,
  type: "SEND",
  amount: 100,
  currency_code: "USDT",
  description: null,
  client_name: "Refunded Client",
  commission: 4,
  paid_by: "CASH",
  created_at: "2026-08-10 20:00:00",
  is_refunded: 1,
  refunded_at: "2026-08-10 21:00:00",
};

const LIVE_BINANCE_TX: BinanceTransaction = {
  id: 2,
  type: "SEND",
  amount: 50,
  currency_code: "USDT",
  description: null,
  client_name: "Live Client",
  commission: 2,
  paid_by: "CASH",
  created_at: "2026-08-10 19:00:00",
  is_refunded: 0,
  refunded_at: null,
};

function noop() {}

describe("CryptoForm — Binance history re-mapping preserves is_refunded/refunded_at (LIRA-131)", () => {
  it("passes is_refunded/refunded_at through to HistoryModal's transactions prop for both a refunded and a live Binance row", () => {
    render(
      <CryptoForm
        activeConfig={{
          key: "BINANCE",
          label: "Binance",
          module: "binance",
          drawer: "Binance",
          formMode: "crypto",
          color: "text-amber-400",
          bgTint: "bg-amber-400/10",
          activeBg: "bg-amber-600",
          activeText: "text-white",
          badgeCls: "bg-amber-400/10 text-amber-400",
          iconKey: "Bitcoin",
          hasSupplier: false,
        }}
        cryptoType="SEND"
        setCryptoType={noop}
        cryptoAmount=""
        setCryptoAmount={noop}
        cryptoClientName=""
        setCryptoClientName={noop}
        cryptoClientPhone=""
        setCryptoClientPhone={noop}
        cryptoClientId={null}
        setCryptoClientId={noop}
        cryptoDescription=""
        setCryptoDescription={noop}
        cryptoFee=""
        setCryptoFee={noop}
        feeIncluded={false}
        setFeeIncluded={noop}
        feeCollectedSeparately={false}
        setFeeCollectedSeparately={noop}
        onFeePaymentLinesChange={noop}
        feePaymentMethods={[]}
        handleCryptoSubmit={noop}
        isSubmitting={false}
        binanceTransactions={[REFUNDED_BINANCE_TX, LIVE_BINANCE_TX]}
        loadCryptoData={noop}
        showHistory={true}
        setShowHistory={noop}
        paymentMethods={[]}
        onPaymentLinesChange={noop}
        exchangeRate={89500}
      />,
    );

    expect(mockHistoryModal).toHaveBeenCalled();
    const lastCallProps = mockHistoryModal.mock.calls[
      mockHistoryModal.mock.calls.length - 1
    ][0] as { transactions: Array<Record<string, unknown>> };

    const refunded = lastCallProps.transactions.find(
      (t) => t.client_name === "Refunded Client",
    );
    const live = lastCallProps.transactions.find(
      (t) => t.client_name === "Live Client",
    );

    expect(refunded).toBeDefined();
    expect(refunded?.is_refunded).toBe(1);
    expect(refunded?.refunded_at).toBe("2026-08-10 21:00:00");

    expect(live).toBeDefined();
    expect(live?.is_refunded).toBe(0);
    expect(live?.refunded_at).toBeNull();
  });
});
