/**
 * LIRA-306 — the duplicate fingerprint (R8, FR-025, N7, O-new-18).
 *
 * ONE definition, computed from BOOKED rows: the replay books an event in a
 * savepoint, fingerprints the rows it just made, and compares them with the
 * fingerprints of rows already there — both through `build()` below, so the
 * two sides can never drift (rule 14).
 *
 * Fields (N7): every event — type, totals per currency, payment legs
 * (method, currency, amount), client id or phone; sale — items (product,
 * quantity, price); transfer — provider, direction, amount, fee, sender and
 * receiver phone; recharge — carrier, phone, amount; expense — category,
 * description, amount; repayment — client, amount, ticked items; exchange —
 * currencies, amounts, rate. The transfer reference and the recharge
 * carrier/phone/amount are carried separately for the "certain" rules.
 * Order-free lists (items, legs, ticks) are sorted.
 */
import type Database from "better-sqlite3";
import { getDatabase } from "../db/connection.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import { isAutoRow } from "../utils/transactionVisibility.js";

export type DuplicateFamily = "sale" | "transfer" | "recharge" | "expense" | "repayment" | "exchange";

export interface DuplicateFingerprint {
  transactionId: number;
  family: DuplicateFamily;
  sourceTable: string | null;
  sourceId: number | null;
  /** business time: the transaction's `created_at` (SQLite UTC text) */
  at: string;
  userId: number | null;
  fields: Record<string, unknown>;
  /** transfer: the OMT/Whish reference (certain rule), trimmed; null when empty */
  reference: string | null;
  /** recharge: carrier (lower case), phone, amount (certain rule) */
  recharge: { carrier: string; phone: string; amount: number } | null;
}

/** Which unified rows are a money event of each family — defined once. */
const FAMILY_SQL: Record<DuplicateFamily, string> = {
  sale: `t.type = 'SALE' AND t.source_table = 'sales'`,
  transfer: `t.type = 'FINANCIAL_SERVICE' AND t.source_table = 'financial_services'`,
  recharge: `t.type = 'RECHARGE' AND t.source_table = 'recharges'`,
  expense: `(t.type = 'EXPENSE' OR t.type LIKE 'EXPENSE\\_%' ESCAPE '\\') AND t.source_table = 'expenses'`,
  repayment: `t.type = 'DEBT_REPAYMENT'`,
  exchange: `t.type = 'EXCHANGE' AND t.source_table = 'exchange_transactions'`,
};

function familyOf(row: TxRow): DuplicateFamily | null {
  const s = row.source_table;
  if (row.type === "SALE" && s === "sales") return "sale";
  if (row.type === "FINANCIAL_SERVICE" && s === "financial_services") return "transfer";
  if (row.type === "RECHARGE" && s === "recharges") return "recharge";
  if ((row.type === "EXPENSE" || row.type.startsWith("EXPENSE_")) && s === "expenses") return "expense";
  if (row.type === "DEBT_REPAYMENT") return "repayment";
  if (row.type === "EXCHANGE" && s === "exchange_transactions") return "exchange";
  return null;
}

interface TxRow {
  id: number;
  type: string;
  source_table: string | null;
  source_id: number | null;
  user_id: number | null;
  amount_usd: number | null;
  amount_lbp: number | null;
  client_id: number | null;
  client_phone: string | null;
  reverses_id: number | null;
  metadata_json: string | null;
  created_at: string;
}

const TX_COLS = `t.id, t.type, t.source_table, t.source_id, t.user_id, t.amount_usd, t.amount_lbp, t.client_id,
  t.client_phone, t.reverses_id, t.metadata_json, t.created_at`;

const r4 = (v: unknown): number => Math.round(Number(v ?? 0) * 10_000) / 10_000;
const txt = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v);
  return s === "" ? null : s;
};
const sortTuples = <T extends unknown[]>(list: T[]): T[] =>
  [...list].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

export class DuplicateFingerprintRepository {
  private get db(): Database.Database {
    return getDatabase();
  }

  /** The fingerprint of an action's main money row among the transactions it created. */
  fingerprint(transactionIds: readonly number[]): DuplicateFingerprint | null {
    if (transactionIds.length === 0) return null;
    const marks = transactionIds.map(() => "?").join(", ");
    const rows = this.db
      .prepare(`SELECT ${TX_COLS} FROM transactions t WHERE t.tenant_id = ? AND t.id IN (${marks}) ORDER BY t.id`)
      .all(getCurrentTenantId(), ...transactionIds) as TxRow[];
    for (const row of rows) {
      if (row.reverses_id != null || isAutoRow(row.metadata_json)) continue;
      const family = familyOf(row);
      if (family) return this.build(row, family);
    }
    return null;
  }

  /** Rows of a family already booked: above a copy's high-water mark and/or
   *  inside a business-time window, minus the given transactions. */
  candidates(f: {
    family: DuplicateFamily;
    aboveTransactionId: number | null;
    from: string | null;
    to: string | null;
    excludeTransactionIds: readonly number[];
    /** transfers only: rows with this reference (case/space-insensitive),
     *  whatever their time — the "certain" rule (instead of the window) */
    reference?: string | null;
  }): DuplicateFingerprint[] {
    const ref = f.family === "transfer" && f.reference ? f.reference.trim().toLowerCase() : null;
    const rows = this.db
      .prepare(
        `SELECT ${TX_COLS} FROM transactions t
          WHERE t.tenant_id = ? AND t.reverses_id IS NULL AND ${FAMILY_SQL[f.family]}
            AND (? IS NULL OR t.id > ?)
            AND (? IS NULL OR t.created_at >= ?)
            AND (? IS NULL OR t.created_at <= ?)
            AND (? IS NULL OR t.source_id IN (
                  SELECT fs.id FROM financial_services fs
                   WHERE fs.tenant_id = t.tenant_id AND lower(trim(fs.reference_number)) = ?))
          ORDER BY t.id`,
      )
      .all(
        getCurrentTenantId(),
        f.aboveTransactionId,
        f.aboveTransactionId,
        f.from,
        f.from,
        f.to,
        f.to,
        ref,
        ref,
      ) as TxRow[];
    const exclude = new Set(f.excludeTransactionIds);
    return rows
      .filter((r) => !exclude.has(r.id) && !isAutoRow(r.metadata_json))
      .map((r) => this.build(r, f.family));
  }

  // ---------------------------------------------------------------------------

  private build(row: TxRow, family: DuplicateFamily): DuplicateFingerprint {
    const tenantId = getCurrentTenantId();
    const legs = sortTuples(
      (
        this.db
          .prepare(`SELECT method, currency_code, amount FROM payments WHERE tenant_id = ? AND transaction_id = ?`)
          .all(tenantId, row.id) as Array<{ method: string; currency_code: string; amount: number }>
      ).map((p) => [p.method, p.currency_code, r4(p.amount)]),
    );
    const extra: Record<string, unknown> = {};
    let reference: string | null = null;
    let recharge: DuplicateFingerprint["recharge"] = null;
    let familyPhone: string | null = null;
    const src = row.source_id;

    if (family === "sale" && src != null) {
      extra.items = sortTuples(
        (
          this.db
            .prepare(`SELECT product_id, quantity, sold_price_usd FROM sale_items WHERE tenant_id = ? AND sale_id = ?`)
            .all(tenantId, src) as Array<{ product_id: number; quantity: number; sold_price_usd: number }>
        ).map((i) => [i.product_id, r4(i.quantity), r4(i.sold_price_usd)]),
      );
    } else if (family === "transfer" && src != null) {
      const fs = this.db
        .prepare(
          `SELECT provider, service_type, amount, currency, commission, omt_fee, whish_fee, sender_phone, receiver_phone,
                  reference_number, phone_number
             FROM financial_services WHERE tenant_id = ? AND id = ?`,
        )
        .get(tenantId, src) as Record<string, unknown> | undefined;
      extra.provider = txt(fs?.provider);
      extra.direction = txt(fs?.service_type);
      extra.amount = r4(fs?.amount);
      extra.currency = txt(fs?.currency);
      extra.fee = [r4(fs?.commission), r4(fs?.omt_fee), r4(fs?.whish_fee)];
      extra.senderPhone = txt(fs?.sender_phone);
      extra.receiverPhone = txt(fs?.receiver_phone);
      reference = txt(fs?.reference_number);
      familyPhone = txt(fs?.phone_number);
    } else if (family === "recharge" && src != null) {
      const rc = this.db
        .prepare(`SELECT carrier, phone_number, amount FROM recharges WHERE tenant_id = ? AND id = ?`)
        .get(tenantId, src) as { carrier: string | null; phone_number: string | null; amount: number } | undefined;
      const carrier = (txt(rc?.carrier) ?? "").toLowerCase();
      const phone = txt(rc?.phone_number) ?? "";
      extra.carrier = carrier;
      extra.phone = phone;
      extra.amount = r4(rc?.amount);
      recharge = { carrier, phone, amount: r4(rc?.amount) };
      familyPhone = phone || null;
    } else if (family === "expense" && src != null) {
      const ex = this.db
        .prepare(`SELECT category, description, amount_usd, amount_lbp FROM expenses WHERE tenant_id = ? AND id = ?`)
        .get(tenantId, src) as Record<string, unknown> | undefined;
      extra.category = txt(ex?.category);
      extra.description = txt(ex?.description);
      extra.expenseUsd = r4(ex?.amount_usd);
      extra.expenseLbp = r4(ex?.amount_lbp);
    } else if (family === "repayment") {
      let targets: Array<{ kind?: unknown; id?: unknown }> = [];
      try {
        const meta = JSON.parse(row.metadata_json ?? "{}") as { targets?: Array<{ kind?: unknown; id?: unknown }> };
        targets = Array.isArray(meta.targets) ? meta.targets : [];
      } catch {
        targets = [];
      }
      extra.ticked = sortTuples(targets.map((t) => [String(t.kind ?? ""), Number(t.id ?? 0)]));
    } else if (family === "exchange" && src != null) {
      const ex = this.db
        .prepare(
          `SELECT from_currency, to_currency, amount_in, amount_out, rate FROM exchange_transactions WHERE tenant_id = ? AND id = ?`,
        )
        .get(tenantId, src) as Record<string, unknown> | undefined;
      extra.fromCurrency = txt(ex?.from_currency);
      extra.toCurrency = txt(ex?.to_currency);
      extra.amountIn = r4(ex?.amount_in);
      extra.amountOut = r4(ex?.amount_out);
      extra.rate = r4(ex?.rate);
    }

    const phone = txt(row.client_phone) ?? familyPhone;
    return {
      transactionId: row.id,
      family,
      sourceTable: row.source_table,
      sourceId: row.source_id,
      at: row.created_at,
      userId: row.user_id,
      reference,
      recharge,
      fields: {
        type: row.type,
        amountUsd: r4(row.amount_usd),
        amountLbp: r4(row.amount_lbp),
        client: row.client_id != null ? `client:${row.client_id}` : phone ? `phone:${phone}` : null,
        legs,
        ...extra,
      },
    };
  }
}

let instance: DuplicateFingerprintRepository | null = null;
export function getDuplicateFingerprintRepository(): DuplicateFingerprintRepository {
  if (!instance) instance = new DuplicateFingerprintRepository();
  return instance;
}
export function resetDuplicateFingerprintRepository(): void {
  instance = null;
}
