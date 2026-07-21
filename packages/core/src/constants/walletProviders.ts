/**
 * Wallet (prepaid-balance) providers.
 *
 * OMT_APP / WHISH_APP / BINANCE are app or exchange wallets the shop OWNS
 * balance in: a transfer consumes (SEND) or grows (RECEIVE) the shop's own
 * wallet drawer, and the manual fee is kept entirely as shop profit. The
 * provider is NOT a creditor for transfers — no supplier debt exists in
 * either direction, so the auto supplier-ledger block and every
 * "owed to supplier" computation must treat wallet-provider transfer rows
 * as zero. (Wallet top-ups are plain drawer transfers — see
 * RechargeRepository.topUpApp — unlike Katsh/iPick supplier-credit top-ups,
 * which DO book a TOP_UP debt.)
 *
 * This list is the single definition (CLAUDE.md rule 14) consumed by:
 *  - FinancialServiceRepository's auto supplier-ledger guard,
 *  - the SUPPLIER_OWED_SQL projection (Settle tab / Outstanding / FIFO math).
 */
export const WALLET_PROVIDERS = ["OMT_APP", "WHISH_APP", "BINANCE"] as const;

export type WalletProvider = (typeof WALLET_PROVIDERS)[number];

export function isWalletProvider(provider: string): provider is WalletProvider {
  return WALLET_PROVIDERS.includes(provider as WalletProvider);
}

/** SQL IN-list literal built from WALLET_PROVIDERS — for query fragments. */
export const WALLET_PROVIDERS_SQL_LIST = WALLET_PROVIDERS.map(
  (p) => `'${p}'`,
).join(", ");
