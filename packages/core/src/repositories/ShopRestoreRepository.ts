/**
 * LIRA-377 (web shop restore) — the data access behind `ShopRestoreService`
 * (rule 13): preparing a restore CANDIDATE file and computing its preview.
 *
 * A candidate is an earlier copy of ONE shop's file (Litestream point in
 * time, an uploaded backup, or a "before restore" copy) sitting on disk next
 * to the live file. Both are opened BY PATH, never through the tenant pool:
 * the candidate read-write, the current (live) file `readonly` — nothing here
 * can write the live shop. Rows are copied between the two handles (this
 * build of better-sqlite3 has no URI filenames, so a read-only `ATTACH` is
 * not available and a writable one onto the live file is not acceptable).
 *
 * Preparation (data-model §3, research R6–R8), ONE transaction on the
 * candidate, in this order:
 *   1. strip — empty every `SNAPSHOT_STRIPPED_TABLES` table (the Download
 *      backup list, rule 14): sessions, one-time tokens, sync plumbing,
 *      copy meta, platform-only tables, AND the offline set;
 *   2. carry the offline set (`OFFLINE_ID_EXCLUDED_TABLES` minus the PC-only
 *      `offline_copy_meta`) from the CURRENT file, ids kept — must run after
 *      1, which empties those tables too;
 *   3. secret `system_settings` keys (`isSnapshotSecretSettingKey`) from the
 *      current file — the candidate's own secret keys are dropped first;
 *   4. `user_identities` (Google sign-in links) from the current file, only
 *      for users that exist in the candidate;
 *   5. the local `tenants` mirror row overwritten from the platform row;
 *   6. every `sqlite_sequence` row set to MAX(current seq, candidate seq),
 *      so no id that ever existed in the live file is issued again (R7).
 * `idFloor` = the candidate's own MAX(id) per sequenced table, read BEFORE
 * step 1 (so the offline tables report the copy's value, not current's).
 *
 * Preview (FR-008/FR-010): the copy's last sale, and what the live file holds
 * that the copy does not. "Lost" rows are those with `id` above the
 * candidate's MAX(id) for that table: every business table is AUTOINCREMENT
 * and the candidate is an earlier state of the SAME file, so a higher id was
 * created after the copy was taken. Timestamps are NOT used — backdating
 * (`transaction_time`) and offline replay (`requestNow()` = the event time)
 * write past `created_at` values onto new rows.
 *
 * Every statement runs against one shop's own file (one tenant), so the
 * scoping checker's markers below say so. Server-only (`better-sqlite3`):
 * exported from `index.ts` only, never `browser.ts` (rule 29).
 */
import Database from "better-sqlite3";
import { quoteIdent } from "../db/tenantSplit.js";
import { isSnapshotSecretSettingKey, SNAPSHOT_STRIPPED_TABLES } from "../db/tenantSnapshot.js";
import { OFFLINE_ID_EXCLUDED_TABLES } from "../offline/idRange.js";
import { TRANSACTION_TYPES } from "../constants/transactionTypes.js";
import { customerCashLegSql, legsInSumSql, legsOutSumSql } from "./TransactionRepository.js";
import type { TenantEntity } from "./TenantRepository.js";
import { dbLogger } from "../utils/logger.js";

/** The PC-side table in `OFFLINE_ID_EXCLUDED_TABLES`: a server shop file
 * never carries one (it marks a desktop working copy), so it stays stripped. */
const PC_ONLY_OFFLINE_TABLE = "offline_copy_meta";

/** The till-PC state carried from the live file as ONE set (R7), in
 * parent→child order. Derived from the offline list (rule 14); any further
 * `offline_outbox*` table present in the file is appended at run time. */
export const RESTORE_CARRIED_OFFLINE_TABLES: readonly string[] = OFFLINE_ID_EXCLUDED_TABLES.filter(
  (t) => t !== PC_ONLY_OFFLINE_TABLE,
);

/** A sale that was actually recorded (not a parked draft). A voided sale is
 * `cancelled` — not money the shop took, so not "a sale" in the preview. */
const recordedSaleSql = (alias: string): string => `${alias}.status IN ('completed', 'refunded')`;

/** What the customer was charged for a sale: `final_amount_usd` excludes the
 * LIRA-319 extra, which `sales.extra_usd` holds for every sale (v213). */
const saleChargedUsdSql = (alias: string): string => `(COALESCE(${alias}.final_amount_usd, 0) + COALESCE(${alias}.extra_usd, 0))`;

/** One settlement action = ONE unified transaction of these types (each
 * settle writer creates exactly one; per-currency rows live underneath). */
const SETTLEMENT_KINDS = {
  suppliers: TRANSACTION_TYPES.SUPPLIER_SETTLEMENT, // suppliers incl. OMT / Whish accounts
  partners: TRANSACTION_TYPES.PARTNER_SETTLEMENT,
  loto: TRANSACTION_TYPES.LOTO_SETTLEMENT,
} as const;

/** The tenants columns the platform row owns (FR-003). */
const TENANT_MIRROR_COLUMNS = [
  "name",
  "slug",
  "status",
  "contact_name",
  "contact_phone",
  "notes",
  "contact_email",
  "google_signup_at",
  "created_at",
  "updated_at",
] as const;

export interface PrepareCandidateInput {
  /** The candidate file (already migrated to this server's schema). */
  candidatePath: string;
  /** The live shop file — opened read-only. */
  currentPath: string;
  /** The shop's row in the platform file. */
  platformTenant: TenantEntity;
}

export interface PrepareCandidateResult {
  /** `{ table: candidate MAX(id) }` before preparation (`id_floor_json`). */
  idFloor: Record<string, number>;
}

export interface RestoreLastSale {
  /** UTC ISO instant. */
  at: string;
  amount: number;
  currency: string;
  client: string | null;
}

export interface RestoreCurrencyTotal {
  currency: string;
  amount: number;
}

export interface RestoreLostSales {
  count: number;
  /** Sum of what the customers were charged (final + extra). */
  totalUsd: number;
}

export interface RestoreLostSettlements {
  suppliers: number;
  partners: number;
  loto: number;
}

export interface RestoreLostSummary {
  sales: RestoreLostSales;
  /** Customer-facing payment legs (IN and OUT). */
  payments: number;
  expenses: number;
  /** Shop days among the lost drawer checkpoints (distinct `closing_date`). */
  dayClosings: number;
  /** Drawer checkpoints / counts (`daily_closings` rows). */
  checkpoints: number;
  settlements: RestoreLostSettlements;
  /** Gross IN legs per currency (customer paid). */
  moneyIn: RestoreCurrencyTotal[];
  /** Gross OUT legs per currency (change returned, payouts), positive. */
  moneyOut: RestoreCurrencyTotal[];
}

export interface RestorePreviewInput {
  candidatePath: string;
  currentPath: string;
  tenantId: number;
  /** The admin asking; `youAreMissing` when absent from the candidate. */
  userId: number;
}

export interface RestorePreviewData {
  lastSaleInCopy: RestoreLastSale | null;
  lost: RestoreLostSummary;
  youAreMissing: boolean;
}

export interface ShopRestoreRepositoryOptions {
  /** Injectable for backend jest, which maps `better-sqlite3` to a mock. */
  DatabaseCtor?: typeof Database;
}

function tableExists(db: Database.Database, table: string): boolean {
  return (
    db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table) !== undefined
  );
}

function columnsOf(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all() as { name: string }[]).map((c) => c.name);
}

function maxRowId(db: Database.Database, table: string): number {
  return (
    db.prepare(`SELECT COALESCE(MAX(rowid), 0) AS m FROM ${quoteIdent(table)}` /* tenant-exempt: one shop's own file */).get() as {
      m: number;
    }
  ).m;
}

function readSequences(db: Database.Database): Map<string, number> {
  if (!tableExists(db, "sqlite_sequence")) return new Map();
  const rows = db.prepare(`SELECT name, seq FROM sqlite_sequence`).all() as { name: string; seq: number }[];
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.name, Math.max(out.get(r.name) ?? 0, r.seq));
  return out;
}

/** `YYYY-MM-DD HH:MM:SS` (SQLite UTC text) → ISO `…Z`; anything else as is. */
function sqliteUtcToIso(value: string): string {
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(" ", "T")}Z` : value;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export class ShopRestoreRepository {
  private readonly DatabaseCtor: typeof Database;

  constructor(opts: ShopRestoreRepositoryOptions = {}) {
    this.DatabaseCtor = opts.DatabaseCtor ?? Database;
  }

  private openCurrent(currentPath: string): Database.Database {
    return new this.DatabaseCtor(currentPath, { readonly: true, fileMustExist: true });
  }

  /** The offline set as present in the current file, parent→child. */
  private carriedOfflineTables(current: Database.Database, candidate: Database.Database): string[] {
    const extraOutbox = (
      current
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'offline\\_outbox%' ESCAPE '\\' ORDER BY name`)
        .all() as { name: string }[]
    )
      .map((r) => r.name)
      .filter((t) => !RESTORE_CARRIED_OFFLINE_TABLES.includes(t));
    return [...RESTORE_CARRIED_OFFLINE_TABLES, ...extraOutbox].filter(
      (t) => tableExists(current, t) && tableExists(candidate, t),
    );
  }

  /** Copies every `where`-matching row of `table` from current, ids kept,
   * over the columns both files have. */
  private copyRows(
    current: Database.Database,
    candidate: Database.Database,
    table: string,
    opts: { where?: string; params?: unknown[]; keep?: (row: unknown[], cols: string[]) => boolean } = {},
  ): number {
    const curCols = new Set(columnsOf(current, table));
    const cols = columnsOf(candidate, table).filter((c) => curCols.has(c));
    const list = cols.map(quoteIdent).join(", ");
    const select = current
      .prepare(`SELECT ${list} FROM ${quoteIdent(table)} ${opts.where ?? ""}` /* tenant-exempt: one shop's own file */)
      .raw(true);
    const insert = candidate.prepare(
      `INSERT INTO ${quoteIdent(table)} (${list}) VALUES (${cols.map(() => "?").join(", ")})` /* tenant-exempt: one shop's own file */,
    );
    let n = 0;
    for (const row of select.iterate(...(opts.params ?? [])) as IterableIterator<unknown[]>) {
      if (opts.keep && !opts.keep(row, cols)) continue;
      insert.run(...row);
      n++;
    }
    return n;
  }

  prepareCandidate(input: PrepareCandidateInput): PrepareCandidateResult {
    const candidate = new this.DatabaseCtor(input.candidatePath, { fileMustExist: true });
    let current: Database.Database | null = null;
    try {
      current = this.openCurrent(input.currentPath);
      const cur = current;
      // Set outside the transaction (the pragma is a no-op inside one).
      candidate.pragma("foreign_keys = ON");

      const curSeq = readSequences(cur);
      const candSeq = readSequences(candidate);
      const sequenced = [...new Set([...curSeq.keys(), ...candSeq.keys()])].filter((t) => tableExists(candidate, t));
      const idFloor: Record<string, number> = {};
      for (const t of sequenced) idFloor[t] = maxRowId(candidate, t);

      const carried: Record<string, number> = {};
      candidate.transaction(() => {
        // The strip deletes parents before children (offline_devices first);
        // checks run at COMMIT, after the carry has refilled them.
        candidate.pragma("defer_foreign_keys = ON");

        // 1. strip
        for (const t of SNAPSHOT_STRIPPED_TABLES) {
          if (tableExists(candidate, t)) candidate.exec(`DELETE FROM ${quoteIdent(t)}` /* tenant-exempt: whole restore candidate */);
        }

        // 2. offline set from current
        for (const t of this.carriedOfflineTables(cur, candidate)) carried[t] = this.copyRows(cur, candidate, t);

        // 3. secret settings from current
        if (tableExists(candidate, "system_settings")) {
          const keys = candidate.prepare(`SELECT id, key_name FROM system_settings` /* tenant-exempt: one shop's own file */).all() as {
            id: number;
            key_name: string;
          }[];
          const del = candidate.prepare(`DELETE FROM system_settings WHERE id = ?` /* tenant-exempt: one shop's own file */);
          for (const k of keys) if (isSnapshotSecretSettingKey(k.key_name)) del.run(k.id);
          if (tableExists(cur, "system_settings")) {
            carried.system_settings = this.copyRows(cur, candidate, "system_settings", {
              keep: (row, cols) => isSnapshotSecretSettingKey(String(row[cols.indexOf("key_name")])),
            });
          }
        }

        // 4. Google links whose user exists in the candidate
        if (tableExists(candidate, "user_identities") && tableExists(cur, "user_identities")) {
          const userExists = candidate.prepare(`SELECT 1 FROM users WHERE id = ?` /* tenant-exempt: one shop's own file */);
          carried.user_identities = this.copyRows(cur, candidate, "user_identities", {
            keep: (row, cols) => userExists.get(row[cols.indexOf("user_id")]) !== undefined,
          });
        }

        // 5. tenants mirror from the platform row
        const t = input.platformTenant;
        const tenantCols = new Set(columnsOf(candidate, "tenants"));
        const cols = TENANT_MIRROR_COLUMNS.filter((c) => tenantCols.has(c));
        const changed = candidate
          .prepare(`UPDATE tenants SET ${cols.map((c) => `${quoteIdent(c)} = ?`).join(", ")} WHERE id = ?`)
          .run(...cols.map((c) => t[c] ?? null), t.id).changes;
        if (changed !== 1) {
          throw new Error(`prepareCandidate: the copy has no tenants row for shop ${t.id}`);
        }

        // 6. sequences: never reissue an id the live file has used
        const update = candidate.prepare(`UPDATE sqlite_sequence SET seq = ? WHERE name = ?`);
        const insert = candidate.prepare(`INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)`);
        const afterCarry = readSequences(candidate);
        for (const name of sequenced) {
          const seq = Math.max(curSeq.get(name) ?? 0, candSeq.get(name) ?? 0, afterCarry.get(name) ?? 0);
          if (afterCarry.has(name)) update.run(seq, name);
          else insert.run(name, seq);
        }
      })();

      dbLogger.info({ tenantId: input.platformTenant.id, carried }, "restore candidate prepared");
      return { idFloor };
    } finally {
      current?.close();
      candidate.close();
    }
  }

  previewCandidate(input: RestorePreviewInput): RestorePreviewData {
    const candidate = new this.DatabaseCtor(input.candidatePath, { readonly: true, fileMustExist: true });
    let current: Database.Database | null = null;
    try {
      current = this.openCurrent(input.currentPath);
      const { tenantId } = input;

      const last = candidate
        .prepare(
          `SELECT s.created_at AS at, ${saleChargedUsdSql("s")} AS amount, c.full_name AS client
             FROM sales s
             LEFT JOIN clients c ON c.id = s.client_id AND c.tenant_id = s.tenant_id
            WHERE ${recordedSaleSql("s")} AND s.tenant_id = ?
            ORDER BY s.id DESC
            LIMIT 1`,
        )
        .get(tenantId) as { at: string; amount: number | null; client: string | null } | undefined;

      const floor = (table: string): number => (tableExists(candidate, table) ? maxRowId(candidate, table) : 0);
      const lostCount = (table: string): number =>
        tableExists(current!, table)
          ? (
              current!
                .prepare(`SELECT COUNT(*) AS c FROM ${quoteIdent(table)} WHERE id > ? AND tenant_id = ?`)
                .get(floor(table), tenantId) as { c: number }
            ).c
          : 0;

      const paymentsFloor = floor("payments");
      const legs = current
        .prepare(
          `SELECT p.currency_code AS currency, COUNT(*) AS n,
                  ${legsInSumSql("p")} AS money_in, ${legsOutSumSql("p")} AS money_out
             FROM payments p
            WHERE p.id > ? AND p.tenant_id = ? AND ${customerCashLegSql("p")}
            GROUP BY p.currency_code
            ORDER BY p.currency_code`,
        )
        .all(paymentsFloor, tenantId) as { currency: string; n: number; money_in: number; money_out: number }[];
      const perCurrency = (pick: (r: (typeof legs)[number]) => number): RestoreCurrencyTotal[] =>
        legs.filter((r) => pick(r) > 0).map((r) => ({ currency: r.currency, amount: round2(pick(r)) }));

      const sales = current
        .prepare(
          `SELECT COUNT(*) AS n, COALESCE(SUM(${saleChargedUsdSql("s")}), 0) AS total
             FROM sales s
            WHERE s.id > ? AND s.tenant_id = ? AND ${recordedSaleSql("s")}`,
        )
        .get(floor("sales"), tenantId) as { n: number; total: number };

      const closings = current
        .prepare(
          `SELECT COUNT(*) AS n, COUNT(DISTINCT closing_date) AS days
             FROM daily_closings WHERE id > ? AND tenant_id = ?`,
        )
        .get(floor("daily_closings"), tenantId) as { n: number; days: number };

      const transactionsFloor = floor("transactions");
      const settled = current.prepare(`SELECT COUNT(*) AS c FROM transactions WHERE id > ? AND tenant_id = ? AND type = ?`);
      const settlementCount = (type: string): number =>
        (settled.get(transactionsFloor, tenantId, type) as { c: number }).c;

      const userPresent =
        candidate.prepare(`SELECT 1 FROM users WHERE id = ? AND tenant_id = ?`).get(input.userId, tenantId) !== undefined;

      return {
        lastSaleInCopy: last
          ? { at: sqliteUtcToIso(last.at), amount: round2(last.amount ?? 0), currency: "USD", client: last.client ?? null }
          : null,
        lost: {
          sales: { count: sales.n, totalUsd: round2(sales.total) },
          payments: legs.reduce((n, r) => n + r.n, 0),
          expenses: lostCount("expenses"),
          dayClosings: closings.days,
          checkpoints: closings.n,
          settlements: {
            suppliers: settlementCount(SETTLEMENT_KINDS.suppliers),
            partners: settlementCount(SETTLEMENT_KINDS.partners),
            loto: settlementCount(SETTLEMENT_KINDS.loto),
          },
          moneyIn: perCurrency((r) => r.money_in),
          moneyOut: perCurrency((r) => r.money_out),
        },
        youAreMissing: !userPresent,
      };
    } finally {
      current?.close();
      candidate.close();
    }
  }
}

let instance: ShopRestoreRepository | null = null;

export function getShopRestoreRepository(): ShopRestoreRepository {
  if (!instance) instance = new ShopRestoreRepository();
  return instance;
}

export function resetShopRestoreRepository(): void {
  instance = null;
}
