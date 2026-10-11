/**
 * LIRA-306 T026 guard — replayed work must carry the event's own time
 * (FR-021, R11): every business timestamp an offline-family repository
 * writes goes through `requestNow()` (or a time the user typed), never the
 * server clock.
 *
 * Over the repositories of the channel-policy families, this fails on:
 *   (1) `new Date()` / `Date.now()` — the machine's "now";
 *   (2) `CURRENT_TIMESTAMP` / `datetime('now')` in an INSERT or UPDATE,
 *       except for the allow-listed bookkeeping columns (`updated_at`, …);
 *   (3) an INSERT into a table whose business-time column has a SQL clock
 *       default (create_db.sql) without naming that column — the default
 *       would stamp the server's now (the void reversal row was one).
 * And over ALL of packages/core/src:
 *   (4) a raw `exchange_rates` read outside `utils/exchangeRate.ts`
 *       (`getUsdLbpSellRate`) and `RateRepository` (FR-021a).
 *
 * `PENDING` is a RATCHET: the exact number of offences each file still has.
 * A family task that sweeps a path lowers its count; an unlisted offender or
 * a count that no longer matches fails. It must be EMPTY when Phase 6 ends
 * (T077).
 */
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve(__dirname, "../..");
const REPO = path.join(SRC, "repositories");
const CREATE_DB_SQL = fs.readFileSync(path.join(SRC, "../../../electron-app/create_db.sql"), "utf8");

/** Repositories written by the offline/checkpoint channel families. */
const FAMILY_FILES = [
  "ClientRepository.ts",
  "TransactionRepository.ts",
  "SalesRepository.ts",
  "CustomerSessionRepository.ts",
  "SessionPaymentRepository.ts",
  "FinancialServiceRepository.ts",
  "WalletExchangeRepository.ts",
  "RechargeRepository.ts",
  "CarrierLineRepository.ts",
  "CarrierLineMovementRepository.ts",
  "CarrierLineOwedDeliveryRepository.ts",
  "DebtRepository.ts",
  "ExpenseRepository.ts",
  "ExchangeRepository.ts",
  "ExchangeLotRepository.ts",
  "MaintenanceRepository.ts",
  "WarrantyClaimRepository.ts",
  "DefectiveItemRepository.ts",
  "CustomServiceRepository.ts",
  "LotoTicketRepository.ts",
  "LotoCashPrizeRepository.ts",
  "LotoMonthlyFeeRepository.ts",
  "ProductRepository.ts",
  "ProductUnitRepository.ts",
  "StockAdjustmentRepository.ts",
  "StockBatchRepository.ts",
  "DrawerCashoutRepository.ts",
  "DrawerTopUpRepository.ts",
  "HoldMoneyRepository.ts",
  "VoucherRepository.ts",
  "ClosingRepository.ts",
  "LotoCheckpointRepository.ts",
  "SupplierRepository.ts",
  "PartnerRepository.ts",
  "moneyPosting.ts",
  "keptChange.ts",
  "expenseStock.ts",
  "maintenancePartsStock.ts",
];

/** Config tables whose clock default is not business time (never read by a
 *  day filter): auto-registering a currency during an exchange/top-up
 *  (LIRA-306 T091; ~29 legacy test fixtures build `currencies` without a
 *  created_at column, so naming it there would break them for no gain). */
const CONFIG_TABLES = new Set(["currencies"]);

/** Bookkeeping columns a write may stamp with the clock. */
const ALLOWED_CLOCK_COLUMNS = new Set(["updated_at", "edited_at", "last_activity_at"]);

/** Exact offences left per file (ratchet). Lowered by each family task. */
const PENDING: Record<string, number> = {
  // T083 swept addLedgerEntry (shared auto-sibling writer); A2 swept the
  // offline-reached recordStockIntake + attachRecordedDebtToIntake. The 13
  // left are ONLINE-ONLY writers (createSupplier ×2, recordDebt, settlements,
  // commission allocation, settled_at, discounts, cashflow) — kept on the
  // clock by decision (no offline action reaches them).
  "SupplierRepository.ts": 13,
  // A2 swept addLedgerEntry (for-partner sales, reached offline); the one
  // left is createPartner (online-only).
  "PartnerRepository.ts": 1,
};

// ---------------------------------------------------------------------------

function clockDefaultColumns(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const re = /CREATE TABLE IF NOT EXISTS (\w+)\s*\(([\s\S]*?)\n\);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(CREATE_DB_SQL)) !== null) {
    const cols: string[] = [];
    for (const line of m[2].split("\n")) {
      const c = line.trim().match(/^(\w+)\s+\w+.*DEFAULT\s*\(?\s*(CURRENT_TIMESTAMP|datetime\('now'\))/i);
      if (c && !ALLOWED_CLOCK_COLUMNS.has(c[1])) cols.push(c[1]);
    }
    if (cols.length) out.set(m[1], cols);
  }
  return out;
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Template / string literals that contain SQL writes. */
function writeStatements(src: string): string[] {
  const out: string[] = [];
  const re = /`([^`]*)`|"((?:[^"\\\n]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const s = m[1] ?? m[2] ?? "";
    if (/\b(INSERT\s+(OR\s+\w+\s+)?INTO|UPDATE\s+\w+\s+SET)\b/i.test(s)) out.push(s);
  }
  return out;
}

const CLOCK = /CURRENT_TIMESTAMP|datetime\(\s*'now'/gi;

function clockOffences(stmt: string): string[] {
  const out: string[] = [];
  const ins = stmt.match(/INSERT\s+(?:OR\s+\w+\s+)?INTO\s+(\w+)\s*\(([^)]*)\)\s*(?:VALUES\s*\(([\s\S]*)\)|SELECT)/i);
  if (ins) {
    const cols = ins[2].split(",").map((c) => c.trim());
    const vals = ins[3] ? splitTopLevel(ins[3]) : [];
    vals.forEach((v, i) => {
      if (CLOCK.test(v) && !ALLOWED_CLOCK_COLUMNS.has(cols[i] ?? "")) out.push(`clock value for ${ins[1]}.${cols[i] ?? "?"}`);
      CLOCK.lastIndex = 0;
    });
    if (!ins[3] && CLOCK.test(stmt)) out.push(`clock in INSERT…SELECT into ${ins[1]}`);
    CLOCK.lastIndex = 0;
    return out;
  }
  const upd = stmt.match(/UPDATE\s+(\w+)\s+SET\s+([\s\S]*?)(\bWHERE\b|$)/i);
  if (upd) {
    for (const a of splitTopLevel(upd[2])) {
      const col = a.split("=")[0]?.trim();
      if (CLOCK.test(a) && !ALLOWED_CLOCK_COLUMNS.has(col)) out.push(`clock value for ${upd[1]}.${col}`);
      CLOCK.lastIndex = 0;
    }
  }
  return out;
}

function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

function defaultOffences(stmt: string, defaults: Map<string, string[]>): string[] {
  const ins = stmt.match(/INSERT\s+(?:OR\s+\w+\s+)?INTO\s+(\w+)\s*\(([^)]*)\)/i);
  if (!ins) return [];
  const need = defaults.get(ins[1]);
  if (!need || CONFIG_TABLES.has(ins[1])) return [];
  const cols = new Set(ins[2].split(",").map((c) => c.trim()));
  return need.filter((c) => !cols.has(c)).map((c) => `INSERT into ${ins[1]} relies on the clock default of ${c}`);
}

/** `${this.tableName}`-style placeholders → the table they name in this file. */
function resolveTableNames(src: string): string {
  const names = new Map<string, string>();
  const sup = src.match(/super\(\s*"(\w+)"/);
  if (sup) {
    names.set("this.tableName", sup[1]);
    names.set("tableName", sup[1]);
  }
  for (const m of src.matchAll(/(\w*[Tt]ableName)\s*(?::\s*string)?\s*=\s*"(\w+)"/g)) {
    names.set(`this.${m[1]}`, m[2]);
    names.set(m[1], m[2]);
  }
  return src.replace(/INTO\s+\$\{\s*([\w.]+)\s*\}/g, (all, ref: string) =>
    names.has(ref) ? `INTO ${names.get(ref)}` : `INTO __unresolved_${ref.replace(/\W/g, "_")}`,
  );
}

export function offencesOf(file: string, defaults = clockDefaultColumns()): string[] {
  const src = resolveTableNames(stripComments(fs.readFileSync(path.join(REPO, file), "utf8")));
  const out: string[] = [];
  for (const u of src.match(/INTO __unresolved_\w+/g) ?? []) out.push(`dynamic INSERT target not resolvable: ${u}`);
  // BaseRepository.create() stamps created_at with datetime('now').
  for (const c of src.match(/\b(this|super)\.create\(/g) ?? []) out.push(`generic ${c} stamps datetime('now')`);
  const nowCalls = src.match(/new Date\(\s*\)|Date\.now\(\s*\)/g) ?? [];
  for (const n of nowCalls) out.push(`machine clock: ${n}`);
  for (const stmt of writeStatements(src)) {
    out.push(...clockOffences(stmt), ...defaultOffences(stmt, defaults));
  }
  return out;
}

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "__tests__" || e.name === "migrations" || e.name === "testHelpers") continue;
      out.push(...walkTs(p));
    } else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

describe("requestNow guard (FR-021)", () => {
  const defaults = clockDefaultColumns();

  it("finds the clock-default columns of create_db.sql (not vacuous)", () => {
    expect(defaults.get("transactions")).toContain("created_at");
    expect(FAMILY_FILES.every((f) => fs.existsSync(path.join(REPO, f)))).toBe(true);
  });

  it("family repositories write business time through requestNow() — exact ratchet", () => {
    const actual: Record<string, number> = {};
    const detail: Record<string, string[]> = {};
    for (const f of FAMILY_FILES) {
      const o = offencesOf(f, defaults);
      if (o.length) {
        actual[f] = o.length;
        detail[f] = o;
      }
    }
    if (process.env.REQUEST_NOW_GUARD_DUMP) process.stdout.write(JSON.stringify(detail, null, 1) + "\n");
    const report = Object.entries(actual)
      .filter(([f, n]) => PENDING[f] !== n)
      .map(([f, n]) => `${f}: ${n} (pending ${PENDING[f] ?? 0})\n    ${detail[f].slice(0, 6).join("\n    ")}`);
    const stale = Object.keys(PENDING).filter((f) => !(f in actual)).map((f) => `${f}: now clean — remove it from PENDING`);
    expect([...report, ...stale]).toEqual([]);
  });

  it("no raw exchange_rates read outside getUsdLbpSellRate() / RateRepository (FR-021a)", () => {
    const allowed = new Set([
      path.join(SRC, "utils", "exchangeRate.ts"),
      path.join(SRC, "repositories", "RateRepository.ts"),
    ]);
    const offenders = walkTs(SRC)
      .filter((f) => !allowed.has(f))
      .filter((f) => /FROM\s+exchange_rates\b/i.test(stripComments(fs.readFileSync(f, "utf8"))))
      .map((f) => path.relative(SRC, f));
    expect(offenders).toEqual([]);
  });
});
