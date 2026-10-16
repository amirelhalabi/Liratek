/**
 * LIRA-312 — a MTC/Alfa card recharged onto the WRONG number from
 * iPick/Katsh/Whish App.
 *
 * The wasted card is a stock-use expense (`ExpenseRepository
 * .createStockExpense`, the loss). This repository owns the record that
 * links that expense — and, when marked from a saved sale, the sale — and
 * snapshots the card (`wrong_number_cards`). Credits sent back are
 * `WRONG_NUMBER_CREDITS` transactions (`source_table='wrong_number_cards'`):
 * the chosen shop line and its carrier drawer go up, and `profit_lbp` is
 * stamped at the resold-credit price so it nets against the loss.
 *
 * Every statement is scoped to the current tenant (`getCurrentTenantId()`).
 * Spec: `specs/312-wrong-number-recharge/`.
 */
import { BaseRepository } from "./BaseRepository.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import { requestNow } from "../utils/requestNow.js";
import { TRANSACTION_TYPES } from "../constants/transactionTypes.js";
import { getTransactionRepository } from "./TransactionRepository.js";
import {
  CARRIER_DRAWER_NAMES,
  getCarrierLineRepository,
  type CarrierLineEntity,
} from "./CarrierLineRepository.js";
import { applyDrawerDelta, insertPaymentRow } from "./moneyPosting.js";
import { getCarrierLineService } from "../services/CarrierLineService.js";
import { getUsdLbpSellRate } from "../utils/exchangeRate.js";
import { activeWrongNumberCreditsSql, reversedSql } from "./wrongNumberSql.js";
import {
  TRANSACTION_DETAILS_VERSION,
  type TransactionDetails,
} from "../validators/transactionDetails.js";
import type {
  ListWrongNumbersQuery,
  WrongNumberProvider,
  WrongNumberStatus,
} from "../validators/wrongNumber.js";

export type WrongNumberCarrier = "mtc" | "alfa";

/** The setting that holds the price of $1 of resold credit (owner decision
 *  2026-10-12: recovered credit is valued at this price). */
export const TELECOM_CREDIT_SELL_PRICE_SETTING = "telecom_credit_sell_price_lbp";
/** Its seeded default (TenantRepository, migration v140). */
export const TELECOM_CREDIT_SELL_PRICE_FALLBACK_LBP = 100000;

/**
 * LIRA-329 — the `wrong_number` details: the record (card) — once it exists
 * — the catalog item, both numbers, the sale it came from and the note.
 * Used for the record's own expense row (no record id yet) and for each
 * credits-received entry. Empty values are omitted.
 */
export function buildWrongNumberDetails(
  record: Pick<
    WrongNumberCardEntity,
    | "mobile_service_item_id"
    | "wrong_number"
    | "right_number"
    | "sale_transaction_id"
  > & { id?: number; note?: string | null },
): Extract<TransactionDetails, { kind: "wrong_number" }> {
  const wrong = record.wrong_number?.trim() ? record.wrong_number : undefined;
  const right = record.right_number?.trim() ? record.right_number : undefined;
  const note = record.note?.trim() ? record.note : undefined;
  return {
    v: TRANSACTION_DETAILS_VERSION,
    kind: "wrong_number",
    ...(record.id ? { cardId: record.id } : {}),
    ...(record.mobile_service_item_id
      ? { itemId: record.mobile_service_item_id }
      : {}),
    ...(wrong ? { wrongNumber: wrong } : {}),
    ...(right ? { rightNumber: right } : {}),
    ...(record.sale_transaction_id
      ? { saleTransactionId: record.sale_transaction_id }
      : {}),
    ...(note ? { note } : {}),
  };
}

export interface WrongNumberCardEntity {
  id: number;
  tenant_id: number;
  expense_id: number;
  expense_transaction_id: number;
  sale_transaction_id: number | null;
  provider: WrongNumberProvider;
  carrier: WrongNumberCarrier;
  mobile_service_item_id: number;
  card_label: string;
  card_cost_lbp: number;
  card_credit_usd: number;
  /** Optional (LIRA-325): null when it was not entered. Stored as '' (the
   *  column is NOT NULL) and read back as null — `WRONG_NUMBER_READ_SQL`. */
  wrong_number: string | null;
  right_number: string | null;
  created_at: string;
  updated_at: string;
}

/** One credits-received entry (an active `WRONG_NUMBER_CREDITS` row). */
export interface WrongNumberCreditEntry {
  transaction_id: number;
  amount_usd: number;
  recovered_value_lbp: number;
  carrier_line_id: number | null;
  created_at: string;
}

/** A record with its derived totals (data-model.md "Derived"). */
export interface WrongNumberCardRow extends WrongNumberCardEntity {
  total_recovered_usd: number;
  recovered_value_lbp: number;
  remaining_loss_lbp: number;
  status: WrongNumberStatus;
  credits: WrongNumberCreditEntry[];
}

/** An active MTC/Alfa card of the catalog. */
export interface WrongNumberCardItem {
  id: number;
  provider: string;
  category: string;
  subcategory: string;
  label: string;
  cost_lbp: number;
  credits: number | null;
}

/** What a sale row says it sold (LIRA-325): the per-unit `item_key` and/or
 *  the walk-in cart's `note`, from its `financial_services` row. */
export interface WrongNumberSaleCatalogRef {
  item_key: string | null;
  note: string | null;
}

/** The fields of a sale row the service checks. */
export interface WrongNumberSaleRow {
  id: number;
  type: string;
  metadata_json: string | null;
  is_reversed: number;
}

export interface InsertWrongNumberCardInput {
  expenseId: number;
  expenseTransactionId: number;
  saleTransactionId: number | null;
  provider: WrongNumberProvider;
  carrier: WrongNumberCarrier;
  mobileServiceItemId: number;
  cardLabel: string;
  cardCostLbp: number;
  cardCreditUsd: number;
  /** null when not entered (stored as ''). */
  wrongNumber: string | null;
  rightNumber: string | null;
}

export interface InsertCreditsReceivedInput {
  record: WrongNumberCardEntity;
  line: CarrierLineEntity;
  amountUsd: number;
  creditRateLbp: number;
  userId: number;
  today?: string;
}

export class WrongNumberRepository extends BaseRepository<WrongNumberCardEntity> {
  constructor() {
    super("wrong_number_cards", { softDelete: false });
  }

  protected getColumns(): string {
    return [
      "id",
      "tenant_id",
      "expense_id",
      "expense_transaction_id",
      "sale_transaction_id",
      "provider",
      "carrier",
      "mobile_service_item_id",
      "card_label",
      "card_cost_lbp",
      "card_credit_usd",
      `${wrongNumberReadSql("")} AS wrong_number`,
      "right_number",
      "created_at",
      "updated_at",
    ].join(", ");
  }

  /** Run `fn` in ONE database transaction (nests as a savepoint). */
  withTransaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  /** An active MTC/Alfa card of `provider` from the catalog, or null. */
  getCardItem(itemId: number, provider: string): WrongNumberCardItem | null {
    const row = this.db
      .prepare(
        `SELECT ${CARD_ITEM_COLUMNS}
           FROM mobile_service_items
          WHERE tenant_id = ? AND id = ? AND provider = ? AND is_active = 1`,
      )
      .get(getCurrentTenantId(), itemId, provider) as
      | WrongNumberCardItem
      | undefined;
    if (!row) return null;
    return isCarrierCard(row) ? row : null;
  }

  /** Every active MTC/Alfa card of `provider` with a cost (LIRA-325:
   *  matched against a walk-in cart's note). */
  listCardItems(provider: string): WrongNumberCardItem[] {
    const rows = this.db
      .prepare(
        `SELECT ${CARD_ITEM_COLUMNS}
           FROM mobile_service_items
          WHERE tenant_id = ? AND provider = ? AND is_active = 1
          ORDER BY sort_order, id`,
      )
      .all(getCurrentTenantId(), provider) as WrongNumberCardItem[];
    return rows.filter(isRecordableCard);
  }

  /**
   * The active MTC/Alfa cards (with a cost) of `provider` whose catalog key equals
   * `itemKey` (LIRA-325). The key is written by the Mobile Recharge forms as
   * `provider/category/subcategory/label` (`MobileServiceItemsContext`'s
   * `ServiceItem.key`) — it is built here from each row rather than split,
   * because a label may itself contain "/".
   */
  findCardItemsByKey(provider: string, itemKey: string): WrongNumberCardItem[] {
    const rows = this.db
      .prepare(
        `SELECT ${CARD_ITEM_COLUMNS}
           FROM mobile_service_items
          WHERE tenant_id = ? AND provider = ? AND is_active = 1
            AND provider || '/' || category || '/' || subcategory || '/' || label = ?`,
      )
      .all(getCurrentTenantId(), provider, itemKey) as WrongNumberCardItem[];
    return rows.filter(isRecordableCard);
  }

  /** What a FINANCIAL_SERVICE sale row recorded about its items (its
   *  `financial_services` row), or null when it has none. */
  getSaleCatalogRef(transactionId: number): WrongNumberSaleCatalogRef | null {
    return (
      (this.db
        .prepare(
          `SELECT f.item_key, f.note
             FROM transactions t
             JOIN financial_services f
               ON f.id = t.source_id AND f.tenant_id = t.tenant_id
            WHERE t.tenant_id = ? AND t.id = ?
              AND t.type = 'FINANCIAL_SERVICE'
              AND t.source_table = 'financial_services'`,
        )
        .get(getCurrentTenantId(), transactionId) as
        | WrongNumberSaleCatalogRef
        | undefined) ?? null
    );
  }

  /** The sale row a path-B record links to (with "already reversed"). */
  getSale(transactionId: number): WrongNumberSaleRow | null {
    return (
      (this.db
        .prepare(
          `SELECT t.id, t.type, t.metadata_json,
                  CASE WHEN ${reversedSql("t")} THEN 1 ELSE 0 END AS is_reversed
             FROM transactions t
            WHERE t.tenant_id = ? AND t.id = ?`,
        )
        .get(getCurrentTenantId(), transactionId) as
        | WrongNumberSaleRow
        | undefined) ?? null
    );
  }

  /** The unified transaction an expense row wrote. */
  getExpenseTransactionId(expenseId: number): number | null {
    const row = this.db
      .prepare(
        `SELECT id FROM transactions
          WHERE tenant_id = ? AND source_table = 'expenses' AND source_id = ?
          ORDER BY id LIMIT 1`,
      )
      .get(getCurrentTenantId(), expenseId) as { id: number } | undefined;
    return row?.id ?? null;
  }

  /** The price of $1 of resold credit, in LBP (default 100,000). */
  getCreditSellPriceLbp(): number {
    try {
      const row = this.db
        .prepare(
          `SELECT value FROM system_settings WHERE key_name = ? AND tenant_id = ?`,
        )
        .get(TELECOM_CREDIT_SELL_PRICE_SETTING, getCurrentTenantId()) as
        | { value?: string | null }
        | undefined;
      const parsed = Number(row?.value);
      return Number.isFinite(parsed) && parsed > 0
        ? parsed
        : TELECOM_CREDIT_SELL_PRICE_FALLBACK_LBP;
    } catch {
      return TELECOM_CREDIT_SELL_PRICE_FALLBACK_LBP;
    }
  }

  /** A shop line by id (any state — the service checks active/carrier). */
  getCarrierLine(id: number): CarrierLineEntity | null {
    return getCarrierLineRepository().getById(id) ?? null;
  }

  getRecord(id: number): WrongNumberCardEntity | null {
    return (
      (this.db
        .prepare(
          `SELECT ${this.getColumns()} FROM wrong_number_cards
            WHERE tenant_id = ? AND id = ?`,
        )
        .get(getCurrentTenantId(), id) as WrongNumberCardEntity | undefined) ??
      null
    );
  }

  /** The record whose loss is this expense transaction, or null. */
  getByExpenseTransactionId(transactionId: number): WrongNumberCardEntity | null {
    if (!this.tableExists("wrong_number_cards")) return null;
    return (
      (this.db
        .prepare(
          `SELECT ${this.getColumns()} FROM wrong_number_cards
            WHERE tenant_id = ? AND expense_transaction_id = ?`,
        )
        .get(getCurrentTenantId(), transactionId) as
        | WrongNumberCardEntity
        | undefined) ?? null
    );
  }

  /** The active credits-received entries of a record, oldest first. */
  getActiveCredits(recordId: number): WrongNumberCreditEntry[] {
    const tenantId = getCurrentTenantId();
    const rows = this.db
      .prepare(
        `SELECT t.id AS transaction_id, t.amount_usd,
                t.profit_lbp AS recovered_value_lbp,
                t.metadata_json, t.created_at
           FROM transactions t
          WHERE t.tenant_id = ? AND ${activeWrongNumberCreditsSql("t")}
          ORDER BY t.id`,
      )
      .all(tenantId, recordId) as Array<
      Omit<WrongNumberCreditEntry, "carrier_line_id"> & {
        metadata_json: string | null;
      }
    >;
    return rows.map(({ metadata_json, ...r }) => ({
      ...r,
      carrier_line_id: readCarrierLineId(metadata_json),
    }));
  }

  /** Whether the record behind this expense transaction still has active
   *  credits entries (the expense-void guard, research R6). */
  hasActiveCreditsForExpense(expenseTransactionId: number): boolean {
    const record = this.getByExpenseTransactionId(expenseTransactionId);
    if (!record) return false;
    return this.getActiveCredits(record.id).length > 0;
  }

  /** Records with derived totals, newest first. */
  list(query: ListWrongNumbersQuery = {}): WrongNumberCardRow[] {
    const tenantId = getCurrentTenantId();
    const params: unknown[] = [tenantId];
    let where = "w.tenant_id = ?";
    if (query.id !== undefined) {
      where += " AND w.id = ?";
      params.push(query.id);
    }
    if (query.sale_transaction_id !== undefined) {
      where += " AND w.sale_transaction_id = ?";
      params.push(query.sale_transaction_id);
    }
    if (query.expense_transaction_id !== undefined) {
      where += " AND w.expense_transaction_id = ?";
      params.push(query.expense_transaction_id);
    }
    const rows = this.db
      .prepare(
        `SELECT w.id, w.tenant_id, w.expense_id, w.expense_transaction_id,
                w.sale_transaction_id, w.provider, w.carrier,
                w.mobile_service_item_id, w.card_label, w.card_cost_lbp,
                w.card_credit_usd, ${wrongNumberReadSql("w.")} AS wrong_number,
                w.right_number,
                w.created_at, w.updated_at,
                CASE WHEN e.id IS NULL OR ${reversedSql("e")} THEN 1 ELSE 0 END
                  AS expense_reversed
           FROM wrong_number_cards w
           LEFT JOIN transactions e
             ON e.id = w.expense_transaction_id AND e.tenant_id = w.tenant_id
          WHERE ${where}
          ORDER BY w.id DESC`,
      )
      .all(...params) as Array<WrongNumberCardEntity & { expense_reversed: number }>;

    const out = rows.map(({ expense_reversed, ...record }) =>
      withTotals(record, this.getActiveCredits(record.id), expense_reversed === 1),
    );
    return query.status ? out.filter((r) => r.status === query.status) : out;
  }

  // ---------------------------------------------------------------------------
  // Writes (run inside the caller's `withTransaction`)
  // ---------------------------------------------------------------------------

  insertRecord(input: InsertWrongNumberCardInput): number {
    const now = requestNow();
    return Number(
      this.db
        .prepare(
          `INSERT INTO wrong_number_cards (
             tenant_id, expense_id, expense_transaction_id, sale_transaction_id,
             provider, carrier, mobile_service_item_id, card_label,
             card_cost_lbp, card_credit_usd, wrong_number, right_number,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          getCurrentTenantId(),
          input.expenseId,
          input.expenseTransactionId,
          input.saleTransactionId,
          input.provider,
          input.carrier,
          input.mobileServiceItemId,
          input.cardLabel,
          input.cardCostLbp,
          input.cardCreditUsd,
          // NOT NULL column: '' means "not entered" (read back as null).
          input.wrongNumber ?? "",
          input.rightNumber,
          now,
          now,
        ).lastInsertRowid,
    );
  }

  /**
   * Book one credits-received entry (research R4, the credit buy-back
   * shape). The service has validated the line and the cap; this posts:
   *
   * - one `WRONG_NUMBER_CREDITS` transaction (`profit_lbp = X × rate`);
   * - `+X` credits on the chosen shop line, tied to the transaction
   *   (`_reverseCarrierLineMovements` undoes it);
   * - a `+X` USD payments leg on the carrier drawer, plus a separate
   *   `<drawer>_LINE_DRIFT` leg when the drawer had already drifted from
   *   Σ active line credits (`_reversePayments` undoes both).
   */
  insertCreditsReceived(input: InsertCreditsReceivedInput): number {
    const tenantId = getCurrentTenantId();
    const { record, line, amountUsd: x, creditRateLbp, userId } = input;
    const carrier = record.carrier;
    const drawer = CARRIER_DRAWER_NAMES[carrier];
    const carrierLabel = carrier === "mtc" ? "MTC" : "Alfa";
    const recoveredLbp = Math.round(x * creditRateLbp);

    const transactionId = getTransactionRepository().createTransaction({
      type: TRANSACTION_TYPES.WRONG_NUMBER_CREDITS,
      source_table: "wrong_number_cards",
      source_id: record.id,
      user_id: userId,
      amount_usd: x,
      amount_lbp: 0,
      profit_usd: 0,
      profit_lbp: recoveredLbp,
      exchange_rate: getUsdLbpSellRate(this.db),
      summary: `Credits recovered: +$${x} on ${carrierLabel} line ${line.phone_number} (${record.wrong_number ? `wrong number ${record.wrong_number}, ` : "wrong-number card "}${record.card_label})`,
      metadata_json: {
        carrier,
        carrier_line_id: line.id,
        credit_rate_lbp: creditRateLbp,
        wrong_number_card_id: record.id,
        wrong_number: record.wrong_number,
        card_label: record.card_label,
      },
      // LIRA-329 — which card this recovers, both numbers and the sale.
      details: buildWrongNumberDetails(record),
    });

    const drawerRow = this.db
      .prepare(
        `SELECT balance FROM drawer_balances
          WHERE drawer_name = ? AND currency_code = 'USD' AND tenant_id = ?`,
      )
      .get(drawer, tenantId) as { balance: number } | undefined;
    const drawerBefore = drawerRow?.balance ?? 0;

    const moved = getCarrierLineService().applyMovement({
      carrierLineId: line.id,
      creditsDelta: x,
      validityDaysDelta: 0,
      reason: "WRONG_NUMBER_CREDITS",
      transactionId,
      today: input.today,
    });
    if (!moved.success) {
      throw new Error(moved.error ?? "Could not update the shop line.");
    }

    insertPaymentRow(this.db, {
      transactionId,
      method: drawer,
      drawerName: drawer,
      currencyCode: "USD",
      amount: x,
      note: `Credits recovered (wrong number): +${x}`,
      createdBy: userId,
      tenantId,
    });
    applyDrawerDelta(this.db, {
      drawerName: drawer,
      currencyCode: "USD",
      delta: x,
      tenantId,
    });

    // The drawer follows Σ active line credits (LIRA-252 §0.1). Any gap
    // that existed BEFORE this entry posts as its own, separately-labelled
    // correction leg — never folded into the credits amount (same as the
    // credit buy-back, owner report #10).
    const targetSum = getCarrierLineRepository().getCarrierCreditsSum(carrier);
    const drift = round2(targetSum - drawerBefore - x);
    if (drift !== 0) {
      insertPaymentRow(this.db, {
        transactionId,
        method: `${drawer}_LINE_DRIFT`,
        drawerName: drawer,
        currencyCode: "USD",
        amount: drift,
        note: `Carrier line drift correction (pre-existing, not part of these credits): ${drift > 0 ? "+" : ""}${drift}`,
        createdBy: userId,
        tenantId,
      });
      applyDrawerDelta(this.db, {
        drawerName: drawer,
        currencyCode: "USD",
        delta: drift,
        tenantId,
      });
    }

    return transactionId;
  }
}

/** The catalog columns of a wrong-number card. */
const CARD_ITEM_COLUMNS =
  "id, provider, category, subcategory, label, cost_lbp, credits";

/** Only MTC/Alfa cards can be recorded as a wrong number. */
function isCarrierCard(row: { category: string }): boolean {
  const carrier = row.category.toLowerCase();
  return carrier === "mtc" || carrier === "alfa";
}

/** A sold card the record could accept (LIRA-325): MTC/Alfa with a cost —
 *  a costless one would be refused, so it must not lock the panel. */
function isRecordableCard(row: { category: string; cost_lbp: number }): boolean {
  return isCarrierCard(row) && row.cost_lbp > 0;
}

/**
 * The wrong number as read back — '' (not entered; the column is NOT NULL)
 * becomes null. Defined once (rule 14); `a` is the table alias with its dot.
 */
function wrongNumberReadSql(a: string): string {
  return `NULLIF(${a}wrong_number, '')`;
}

/** Derived totals and status (data-model.md). */
export function withTotals(
  record: WrongNumberCardEntity,
  credits: WrongNumberCreditEntry[],
  expenseReversed: boolean,
): WrongNumberCardRow {
  const totalUsd = round2(credits.reduce((s, c) => s + c.amount_usd, 0));
  const valueLbp = credits.reduce((s, c) => s + c.recovered_value_lbp, 0);
  let status: WrongNumberStatus;
  if (expenseReversed) status = "VOIDED";
  else if (credits.length === 0) status = "WAITING";
  else if (totalUsd >= record.card_credit_usd) status = "RECOVERED";
  else status = "PARTLY_RECOVERED";
  return {
    ...record,
    total_recovered_usd: totalUsd,
    recovered_value_lbp: valueLbp,
    remaining_loss_lbp: record.card_cost_lbp - valueLbp,
    status,
    credits,
  };
}

function readCarrierLineId(metadata: string | null): number | null {
  if (!metadata) return null;
  try {
    const id = (JSON.parse(metadata) as { carrier_line_id?: unknown })
      .carrier_line_id;
    return typeof id === "number" ? id : null;
  } catch {
    return null;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// =============================================================================
// Singleton Instance
// =============================================================================

let wrongNumberRepositoryInstance: WrongNumberRepository | null = null;

export function getWrongNumberRepository(): WrongNumberRepository {
  if (!wrongNumberRepositoryInstance) {
    wrongNumberRepositoryInstance = new WrongNumberRepository();
  }
  return wrongNumberRepositoryInstance;
}

export function resetWrongNumberRepository(): void {
  wrongNumberRepositoryInstance = null;
}
