import { BaseRepository } from "./BaseRepository.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import { getTransactionRepository } from "./TransactionRepository.js";
import { TRANSACTION_TYPES } from "../constants/transactionTypes.js";
import { applyDrawerDelta, insertPaymentRow } from "./moneyPosting.js";

export type WalletDrawerName = "OMT_App" | "Whish_App";
export type WalletCurrency = "USD" | "LBP";

export interface WalletExchangeEntity {
  id: number;
  drawer_name: WalletDrawerName;
  from_currency: WalletCurrency;
  to_currency: WalletCurrency;
  amount_in: number;
  amount_out: number;
  rate: number;
  note: string | null;
  created_by: number | null;
  is_refunded: number;
  refunded_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateWalletExchangeData {
  drawerName: WalletDrawerName;
  fromCurrency: WalletCurrency;
  toCurrency: WalletCurrency;
  /** Amount of fromCurrency being converted (positive). */
  amountIn: number;
  /** Already-computed resulting amount of toCurrency (positive) — the
   *  service layer owns the rate math, this repository only persists it. */
  amountOut: number;
  rate: number;
  note?: string;
  transaction_time?: string;
}

/** Distinguishes these legs from real payment methods (CASH/OMT/WHISH/...) —
 *  no physical cash or customer payment is involved, so `isCashTransaction`
 *  (which gates the "Cash only (till)" filter) correctly excludes them. */
const WALLET_EXCHANGE_METHOD = "WALLET_EXCHANGE";

export class WalletExchangeRepository extends BaseRepository<WalletExchangeEntity> {
  constructor() {
    super("wallet_exchanges");
  }

  protected getColumns(): string {
    return "id, drawer_name, from_currency, to_currency, amount_in, amount_out, rate, note, created_by, is_refunded, refunded_at, created_at, updated_at";
  }

  /**
   * Current wallet balance for one currency. A missing drawer_balances row
   * (wallet never funded in that currency) is treated as 0 — never
   * fabricated as a phantom negative balance (mirrors
   * DrawerCashoutRepository.getGeneralBalance).
   */
  private getWalletBalance(
    drawerName: WalletDrawerName,
    currencyCode: WalletCurrency,
    tenantId: number,
  ): number {
    const row = this.db
      .prepare(
        `SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ? AND tenant_id = ?`,
      )
      .get(drawerName, currencyCode, tenantId) as
      | { balance: number }
      | undefined;
    return row?.balance ?? 0;
  }

  /**
   * Convert `amountIn` of fromCurrency into `amountOut` of toCurrency, both
   * legs posted against the SAME wallet drawer (OMT_App or Whish_App) —
   * never General, never a customer. No spread/profit: profit_usd/profit_lbp
   * are always 0 on the unified row (this moves the shop's own money between
   * its own currency buckets; it doesn't sell anything to anyone).
   *
   * The insufficient-funds guard runs FIRST, inside the same db transaction,
   * before any row is written (mirrors DrawerCashoutRepository.createCashout).
   */
  createTransaction(data: CreateWalletExchangeData, userId: number): number {
    const tenantId = getCurrentTenantId();
    return this.db.transaction(() => {
      const available = this.getWalletBalance(
        data.drawerName,
        data.fromCurrency,
        tenantId,
      );
      if (data.amountIn > available) {
        const fmt = (n: number, currency: WalletCurrency) =>
          currency === "LBP"
            ? `${Math.round(n).toLocaleString()} LBP`
            : `$${n.toFixed(2)}`;
        throw new Error(
          `Insufficient ${data.fromCurrency} balance in ${data.drawerName.replace("_", " ")}: requested ${fmt(data.amountIn, data.fromCurrency)}, available ${fmt(available, data.fromCurrency)}`,
        );
      }

      const insert = this.db.prepare(`
        INSERT INTO wallet_exchanges (
          tenant_id, drawer_name, from_currency, to_currency,
          amount_in, amount_out, rate, note, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)
      `);
      const result = insert.run(
        tenantId,
        data.drawerName,
        data.fromCurrency,
        data.toCurrency,
        data.amountIn,
        data.amountOut,
        data.rate,
        data.note ?? null,
        userId,
        data.transaction_time ?? null,
      );
      const id = Number(result.lastInsertRowid);

      // fromCurrency/toCurrency are always exactly {USD, LBP} in some order
      // (WalletExchangeService enforces this) — one is always the negative
      // outflow, the other the positive inflow, on the unified ledger's own
      // amount_usd/amount_lbp columns.
      const amountUsd =
        data.fromCurrency === "USD" ? -data.amountIn : data.amountOut;
      const amountLbp =
        data.fromCurrency === "LBP" ? -data.amountIn : data.amountOut;

      const drawerLabel = data.drawerName.replace("_", " ");
      const txnId = getTransactionRepository().createTransaction({
        type: TRANSACTION_TYPES.WALLET_EXCHANGE,
        source_table: "wallet_exchanges",
        source_id: id,
        user_id: userId,
        amount_usd: amountUsd,
        amount_lbp: amountLbp,
        profit_usd: 0,
        profit_lbp: 0,
        exchange_rate: data.rate,
        summary: `${drawerLabel} Exchange: ${data.amountIn.toLocaleString()} ${data.fromCurrency} → ${data.amountOut.toLocaleString()} ${data.toCurrency}`,
        metadata_json: {
          drawer_name: data.drawerName,
          from_currency: data.fromCurrency,
          to_currency: data.toCurrency,
          amount_in: data.amountIn,
          amount_out: data.amountOut,
          rate: data.rate,
        },
        transaction_time: data.transaction_time,
      });

      const note =
        data.note ??
        `Wallet exchange: ${data.fromCurrency} → ${data.toCurrency}`;

      // Leg 1 — OUT: source currency leaves the wallet.
      insertPaymentRow(this.db, {
        transactionId: txnId,
        method: WALLET_EXCHANGE_METHOD,
        drawerName: data.drawerName,
        currencyCode: data.fromCurrency,
        amount: -data.amountIn,
        note,
        createdBy: userId,
        tenantId,
      });
      applyDrawerDelta(this.db, {
        drawerName: data.drawerName,
        currencyCode: data.fromCurrency,
        delta: -data.amountIn,
        tenantId,
      });

      // Leg 2 — IN: destination currency arrives in the SAME wallet.
      insertPaymentRow(this.db, {
        transactionId: txnId,
        method: WALLET_EXCHANGE_METHOD,
        drawerName: data.drawerName,
        currencyCode: data.toCurrency,
        amount: data.amountOut,
        note,
        createdBy: userId,
        tenantId,
      });
      applyDrawerDelta(this.db, {
        drawerName: data.drawerName,
        currencyCode: data.toCurrency,
        delta: data.amountOut,
        tenantId,
      });

      return id;
    })();
  }

  getHistory(
    drawerName?: WalletDrawerName,
    limit: number = 50,
  ): WalletExchangeEntity[] {
    const tenantId = getCurrentTenantId();
    if (drawerName) {
      return this.db
        .prepare(
          `SELECT ${this.getColumns()} FROM wallet_exchanges
           WHERE tenant_id = ? AND drawer_name = ?
           ORDER BY created_at DESC LIMIT ?`,
        )
        .all(tenantId, drawerName, limit) as WalletExchangeEntity[];
    }
    return this.db
      .prepare(
        `SELECT ${this.getColumns()} FROM wallet_exchanges
         WHERE tenant_id = ?
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(tenantId, limit) as WalletExchangeEntity[];
  }
}

// Singleton
let walletExchangeRepositoryInstance: WalletExchangeRepository | null = null;

export function getWalletExchangeRepository(): WalletExchangeRepository {
  if (!walletExchangeRepositoryInstance) {
    walletExchangeRepositoryInstance = new WalletExchangeRepository();
  }
  return walletExchangeRepositoryInstance;
}

export function resetWalletExchangeRepository(): void {
  walletExchangeRepositoryInstance = null;
}
