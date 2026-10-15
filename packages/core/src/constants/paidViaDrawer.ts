/**
 * LIRA-323 — "paid through this wallet" on the Transactions page Type filter.
 *
 * Every Type-filter option of a wallet (OMT App, Whish App, Binance) carries
 * `paid_via_drawer` = that wallet's drawer. Selecting it shows the option's
 * own rows AND rows of other types whose visible payment detail moved money
 * through that drawer (a Maintenance job paid with OMT Wallet, a refund paid
 * out by OMT Wallet, a session basket paid by OMT Wallet).
 *
 * `PAID_VIA_DRAWER_OWN_TUPLES` is the ONE definition (rule 14) of a wallet's
 * "own" rows: a row matching any of these tuples is never added through the
 * drawer route — it shows only under its own option. Consumed by
 * `TransactionRepository.getRecent` (SQL) and `useTransactionRows.ts`
 * (client twin); `auditConstants.ts`' FILTER_GROUPS tags the same options,
 * and `paidViaDrawerOptions.guard.test.ts` (frontend) fails if the two lists
 * ever disagree.
 *
 * Leaf module (rule 29): type-only imports, reachable from `browser.ts`.
 */
import type { TransactionType } from "./transactionTypes.js";

export const PAID_VIA_DRAWERS = ["OMT_App", "Whish_App", "Binance"] as const;
export type PaidViaDrawer = (typeof PAID_VIA_DRAWERS)[number];

/** Same shape as one `typeFilters` tuple (validators/transaction.ts). */
export interface PaidViaDrawerOwnTuple {
  type: TransactionType;
  provider?: string;
  service_type?: string;
  has_item_key?: boolean;
}

export const PAID_VIA_DRAWER_OWN_TUPLES: Readonly<
  Record<PaidViaDrawer, readonly PaidViaDrawerOwnTuple[]>
> = {
  OMT_App: [
    { type: "FINANCIAL_SERVICE", provider: "OMT_APP", service_type: "SEND" },
    { type: "FINANCIAL_SERVICE", provider: "OMT_APP", service_type: "RECEIVE" },
    { type: "RECHARGE_TOPUP", provider: "OMT_APP" },
    { type: "WALLET_CASHOUT" },
  ],
  Whish_App: [
    {
      type: "FINANCIAL_SERVICE",
      provider: "WHISH_APP",
      service_type: "SEND",
      has_item_key: false,
    },
    {
      type: "FINANCIAL_SERVICE",
      provider: "WHISH_APP",
      service_type: "RECEIVE",
      has_item_key: false,
    },
    { type: "FINANCIAL_SERVICE", provider: "WHISH_APP", has_item_key: true },
    { type: "RECHARGE_TOPUP", provider: "WHISH_APP" },
  ],
  Binance: [
    { type: "FINANCIAL_SERVICE", provider: "BINANCE", service_type: "SEND" },
    { type: "FINANCIAL_SERVICE", provider: "BINANCE", service_type: "RECEIVE" },
  ],
};
