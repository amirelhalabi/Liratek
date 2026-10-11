/**
 * LIRA-306 O-impl-A2-8 — writers the requestNow ratchet
 * (`utils/__tests__/requestNow.guard.test.ts`) EXEMPTS: they stamp the server
 * clock, which is correct because only ONLINE-ONLY channels reach them (a
 * PC refuses these offline, N2/O-new-9). `onlineOnlyExemptions.guard.test.ts`
 * fails if a recordable channel's binding ever reaches one of them.
 * Undo: remove an entry and sweep that method to `requestNow()`.
 */
export interface OnlineOnlyExemption {
  method: string;
  /** the online-only channels whose service path reaches it */
  channels: readonly string[];
}

export const ONLINE_ONLY_EXEMPT: Record<string, readonly OnlineOnlyExemption[]> = {
  "SupplierRepository.ts": [
    { method: "createSupplier", channels: ["suppliers:create"] },
    { method: "recordDebt", channels: ["suppliers:record-debt"] },
    { method: "settleTransactions", channels: ["suppliers:settle-transactions"] },
    { method: "settleAccount", channels: ["suppliers:settle-account"] },
    // reached from settleTransactions / settleAccount only
    { method: "_bookCommissionAtSettlement", channels: ["suppliers:settle-transactions", "suppliers:settle-account"] },
    { method: "_markFinancialServicesSettled", channels: ["suppliers:settle-transactions", "suppliers:settle-account"] },
    { method: "recordSupplierCashflow", channels: ["suppliers:record-cashflow"] },
    // reached from recordSupplierCashflow only
    { method: "_postSupplierDiscount", channels: ["suppliers:record-cashflow"] },
  ],
  "PartnerRepository.ts": [{ method: "create", channels: ["partners:create"] }],
};
