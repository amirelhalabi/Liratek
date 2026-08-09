/**
 * CustomServiceRepository — owner-facing CHARACTERIZATION MATRIX
 * (docs/plans/todo_plans/FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md)
 *
 * Owner ask, verbatim: "we should run a test in each scenario. each scenario
 * should include monitoring all drawers before and after the submission of
 * the service, and after refund of the transaction related to the service,
 * and monitor the partners page. scenarios must include all possible
 * business flows of the services page: for partner true and false /
 * different payment methods / preset, item from inventory, custom service."
 *
 * "The services page" here = module key `custom_services` (route
 * `/custom-services`, `CustomServiceRepository`) — NOT the `/services` route,
 * which is the OMT/Whish module.
 *
 * This file is a CHARACTERIZATION HARNESS, not a conventional pass/fail
 * spec: every scenario snapshots ALL drawers, runs the flow, snapshots
 * again, refunds, snapshots a third time, and prints a row to a table any
 * non-engineer can read. It still asserts three cross-cutting invariants
 * (see the header of each section below) — when a scenario violates one,
 * the failing assertion IS the deliverable: a live, runnable reproduction
 * of a real gap, not noise.
 *
 * ⚠ CONCURRENCY: FOR_PARTNER_AND_COST_UNIFICATION_PLAN §3 (guard
 * unification) is being shipped in parallel against `moneyPosting.ts`, the
 * money repositories and the validators. Some scenarios below (C3/C4)
 * characterize the EXACT gap that work is closing. If a scenario that
 * succeeds today starts throwing after that work lands, that is a valid,
 * expected outcome — not a broken test — and will show up as
 * `result: "REJECTED BY GUARD"` in the printed table instead of "OK".
 *
 * FINDING — input type is NOT visible at the repository layer (owner's
 * "preset / item from inventory / custom service" axis): the frontend
 * (CustomServices/index.tsx) resolves a preset-click or an inventory
 * SearchBar `onSelect` to the SAME five plain fields
 * (`description/cost_usd/cost_lbp/price_usd/price_lbp`) before the IPC call
 * — no `preset_id`/`product_id`/`item_id` is ever sent (confirmed against
 * `create_db.sql`'s `custom_services` table, which has no such column
 * either). `createCustomServiceSchema` and `CustomServiceRepository.
 * createService` have no way to tell the three apart. Section A below
 * proves this with a byte-identical-postings demonstration instead of
 * asserting it from prose.
 */

import Database from "better-sqlite3";
import { CustomServiceRepository } from "../CustomServiceRepository";
import { resetTransactionRepository } from "../TransactionRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import {
  createCustomServiceSchema,
  type CreateCustomServiceInput,
} from "../../validators/customService";

// ─── In-memory schema (superset of the two existing CustomServiceRepository
//     test schemas, plus every drawer this module could conceivably touch) ──

/** Every drawer this module (or a sibling money module) can post to. Custom
 * Services never routes through `resolveServiceCashDrawer` (no `provider`
 * concept exists in this module — confirmed by reading
 * `CustomServiceRepository.ts`, which calls `paymentMethodToDrawerName`
 * directly, never `resolveServiceCashDrawer`), so `OMT_System`/`Whish_System`
 * are seeded and monitored here purely to PROVE they stay untouched no
 * matter what a for-partner service's payment method or partner is — the
 * owner's exact worry about partner system-association driving drawer
 * choice does not apply to this module at all. */
const DRAWERS = [
  "General",
  "OMT_App",
  "Whish_App",
  "Binance",
  "OMT_System",
  "Whish_System",
] as const;
const CURRENCIES = ["USD", "LBP"] as const;

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL);
    INSERT INTO users (id, username) VALUES (1, 'admin');

    CREATE TABLE clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      phone_number TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO clients (id, full_name) VALUES (7, 'Matrix Client');

    CREATE TABLE partners (
      tenant_id INTEGER DEFAULT 1,
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      name               TEXT NOT NULL UNIQUE,
      phone              TEXT,
      notes              TEXT,
      is_active          INTEGER NOT NULL DEFAULT 1,
      system_association TEXT,
      created_at         TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at         TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE partner_ledger (
      tenant_id INTEGER DEFAULT 1,
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_id        INTEGER NOT NULL REFERENCES partners(id),
      transaction_type  TEXT,
      reference_table   TEXT,
      reference_id      INTEGER,
      amount            REAL NOT NULL,
      currency          TEXT NOT NULL DEFAULT 'USD',
      direction         TEXT NOT NULL CHECK(direction IN ('DEBIT', 'CREDIT')),
      covered_amount    REAL NOT NULL DEFAULT 0,
      notes             TEXT,
      user_id           INTEGER,
      settlement_method TEXT,
      created_at        TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE custom_services (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      description TEXT NOT NULL,
      cost_usd REAL NOT NULL DEFAULT 0,
      cost_lbp REAL NOT NULL DEFAULT 0,
      price_usd REAL NOT NULL DEFAULT 0,
      price_lbp REAL NOT NULL DEFAULT 0,
      profit_usd REAL,
      profit_lbp REAL,
      paid_by TEXT NOT NULL DEFAULT 'CASH',
      status TEXT NOT NULL DEFAULT 'completed',
      client_id INTEGER,
      client_name TEXT,
      phone_number TEXT,
      note TEXT,
      category TEXT,
      created_by INTEGER,
      edited_by TEXT,
      edited_at DATETIME,
      is_refunded INTEGER DEFAULT 0,
      refunded_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drawer_balances (
      tenant_id INTEGER NOT NULL DEFAULT 1,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, drawer_name, currency_code)
    );

    CREATE TABLE transactions (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      source_table TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL DEFAULT 1,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      profit_usd REAL,
      profit_lbp REAL,
      exchange_rate REAL,
      client_id INTEGER,
      client_name TEXT,
      client_phone TEXT,
      reverses_id INTEGER,
      summary TEXT,
      metadata_json TEXT,
      device_id TEXT,
      transaction_time DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE payments (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER,
      session_id     INTEGER,
      method TEXT NOT NULL,
      drawer_name TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Empty on purpose (same note as CustomServiceRepository.forPartner.test.ts):
    -- _cancelDebt (run by every void, via deleteService -> voidTransaction)
    -- queries this table unconditionally with no existence check.
    CREATE TABLE debt_ledger (
      tenant_id INTEGER DEFAULT 1,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER,
      transaction_type TEXT,
      amount_usd REAL,
      amount_lbp REAL,
      transaction_id INTEGER,
      note TEXT,
      created_by INTEGER,
      covered_usd REAL DEFAULT 0,
      covered_lbp REAL DEFAULT 0,
      is_refunded INTEGER DEFAULT 0,
      due_date DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const seedDrawer = db.prepare(
    `INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, ?, ?, 0)`,
  );
  for (const drawer of DRAWERS) {
    for (const currency of CURRENCIES) {
      seedDrawer.run(drawer, currency);
    }
  }

  return db;
}

// ─── Mock the connection module (identical pattern to the sibling
//     CustomServiceRepository test files) ──────────────────────────────────

jest.mock("../../db/connection", () => {
  let _db: Database.Database | null = null;
  return {
    getDatabase: () => {
      if (!_db) throw new Error("Test DB not initialized");
      return _db;
    },
    setDb: (db: Database.Database) => {
      _db = db;
    },
  };
});

// ─── Helpers ──────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function seedPartner(db: Database.Database, name: string): number {
  const res = db
    .prepare("INSERT INTO partners (name, is_active) VALUES (?, 1)")
    .run(name);
  return Number(res.lastInsertRowid);
}

type DrawerSnapshot = Record<string, number>;

function snapshotDrawers(db: Database.Database): DrawerSnapshot {
  const map: DrawerSnapshot = {};
  for (const drawer of DRAWERS) {
    for (const currency of CURRENCIES) {
      map[`${drawer}/${currency}`] = 0;
    }
  }
  const rows = db
    .prepare(
      `SELECT drawer_name, currency_code, balance FROM drawer_balances WHERE tenant_id = 1`,
    )
    .all() as Array<{
    drawer_name: string;
    currency_code: string;
    balance: number;
  }>;
  for (const r of rows) {
    map[`${r.drawer_name}/${r.currency_code}`] = r.balance;
  }
  return map;
}

/** Delta of every drawer/currency pair, non-zero entries only. */
function diffSnapshots(
  before: DrawerSnapshot,
  after: DrawerSnapshot,
): DrawerSnapshot {
  const out: DrawerSnapshot = {};
  for (const key of Object.keys(before)) {
    const d = round2((after[key] ?? 0) - (before[key] ?? 0));
    if (d !== 0) out[key] = d;
  }
  return out;
}

function fmtDelta(delta: DrawerSnapshot): string {
  const keys = Object.keys(delta);
  if (keys.length === 0) return "(none)";
  return keys
    .map((k) => `${k}:${delta[k] > 0 ? "+" : ""}${delta[k]}`)
    .join(", ");
}

interface PartnerRow {
  transaction_type: string | null;
  direction: "DEBIT" | "CREDIT";
  amount: number;
  currency: string;
}

interface DebtRow {
  transaction_type: string | null;
  amount_usd: number;
  amount_lbp: number;
}

function partnerLedgerRowsFor(
  db: Database.Database,
  serviceId: number,
): PartnerRow[] {
  return db
    .prepare(
      `SELECT transaction_type, direction, amount, currency FROM partner_ledger
       WHERE reference_table = 'custom_services' AND reference_id = ? ORDER BY id`,
    )
    .all(serviceId) as PartnerRow[];
}

function debtLedgerRowsFor(db: Database.Database, txnId: number): DebtRow[] {
  return db
    .prepare(
      `SELECT transaction_type, amount_usd, amount_lbp FROM debt_ledger
       WHERE transaction_id = ? ORDER BY id`,
    )
    .all(txnId) as DebtRow[];
}

function fmtLedgerRows(
  rows: Array<{ transaction_type: string | null; amount_usd?: number; amount_lbp?: number; amount?: number; currency?: string; direction?: string }>,
): string {
  if (rows.length === 0) return "(none)";
  return rows
    .map((r) => {
      if (r.direction) {
        return `${r.transaction_type} ${r.direction} ${r.amount}${r.currency}`;
      }
      const usd = r.amount_usd ?? 0;
      const lbp = r.amount_lbp ?? 0;
      const parts = [];
      if (usd) parts.push(`$${usd}`);
      if (lbp) parts.push(`${lbp}LBP`);
      return `${r.transaction_type} ${parts.join("+")}`;
    })
    .join("; ");
}

interface TxnRow {
  id: number;
  type: string;
  amount_usd: number;
  amount_lbp: number;
  profit_usd: number | null;
  profit_lbp: number | null;
  metadata_json: string | null;
}

function txnFor(db: Database.Database, serviceId: number): TxnRow | null {
  return (
    (db
      .prepare(
        `SELECT id, type, amount_usd, amount_lbp, profit_usd, profit_lbp, metadata_json
         FROM transactions WHERE source_table = 'custom_services' AND source_id = ?`,
      )
      .get(serviceId) as TxnRow | undefined) ?? null
  );
}

// ─── The printed table ──────────────────────────────────────────────────────

interface Row {
  id: string;
  inputType: string;
  forPartner: boolean;
  method: string;
  costUsd: number;
  priceUsd: number;
  result: "OK" | "REJECTED BY GUARD";
  error?: string;
  zodOk: boolean;
  createDelta: DrawerSnapshot;
  partnerRows: PartnerRow[];
  debtRows: DebtRow[];
  metaPaidBy: string | null;
  profitUsd: number | null;
  /** Whether `metaPaidBy` (if non-null) has ANY backing effect (a `payments`
   * row with that exact method, or a `debt_ledger` row for CUSTOMER_ACCOUNT/
   * GIFT_CARD) — computed BEFORE refund runs, since refund/void DELETES the
   * `payments` rows outright (see CustomServiceRepository.deleteService). */
  paidByHadEffect: boolean | null;
  /** Raw `payments` row count for this transaction at create time (before
   * refund deletes them) — lets a scenario prove "zero payment rows were
   * ever written" without racing the refund step. */
  paymentRowCountAtCreate: number;
  drawerNetsToZero: boolean | "N/A";
  partnerLedgerNetsToZero: boolean | "N/A";
  debtLedgerNetsToZero: boolean | "N/A";
  note: string;
}

const rows: Row[] = [];

function formatTable(allRows: Row[]): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(
    "=".repeat(150),
  );
  lines.push(
    "CUSTOM SERVICES ('Services' page, /custom-services) — CHARACTERIZATION MATRIX",
  );
  lines.push("=".repeat(150));
  for (const r of allRows) {
    lines.push("-".repeat(150));
    lines.push(
      `[${r.id}] input=${r.inputType} | forPartner=${r.forPartner} | method=${r.method} | cost=$${r.costUsd} price=$${r.priceUsd} | zodOk=${r.zodOk}`,
    );
    if (r.result === "REJECTED BY GUARD") {
      lines.push(`  RESULT: REJECTED BY GUARD — "${r.error}"`);
    } else {
      lines.push(`  RESULT: OK`);
      lines.push(`  Drawer Δ (submit):     ${fmtDelta(r.createDelta)}`);
      lines.push(`  Partner ledger rows:   ${fmtLedgerRows(r.partnerRows)}`);
      lines.push(`  Debt ledger rows:      ${fmtLedgerRows(r.debtRows)}`);
      lines.push(
        `  metadata_json.paid_by: ${r.metaPaidBy}  (had real effect? ${r.paidByHadEffect})   profit_usd: ${r.profitUsd}`,
      );
      lines.push(
        `  After refund — nets to 0?  drawers=${r.drawerNetsToZero}  partner_ledger=${r.partnerLedgerNetsToZero}  debt_ledger=${r.debtLedgerNetsToZero}`,
      );
    }
    if (r.note) lines.push(`  NOTE: ${r.note}`);
  }
  lines.push("=".repeat(150));
  return lines.join("\n");
}

// ─── Scenario driver ────────────────────────────────────────────────────────

interface RunOpts {
  id: string;
  inputType: string;
  forPartner: boolean;
  method: string;
  payload: CreateCustomServiceInput;
  note?: string;
  skipRefund?: boolean;
}

function runScenario(
  db: Database.Database,
  repo: CustomServiceRepository,
  opts: RunOpts,
): Row {
  const zodOk = createCustomServiceSchema.safeParse(opts.payload).success;
  const before = snapshotDrawers(db);
  const result = repo.createService(opts.payload, 1);
  const afterCreate = snapshotDrawers(db);
  const createDelta = diffSnapshots(before, afterCreate);

  const row: Row = {
    id: opts.id,
    inputType: opts.inputType,
    forPartner: opts.forPartner,
    method: opts.method,
    costUsd: opts.payload.cost_usd,
    priceUsd: opts.payload.price_usd,
    result: result.success ? "OK" : "REJECTED BY GUARD",
    error: result.error,
    zodOk,
    createDelta,
    partnerRows: [],
    debtRows: [],
    metaPaidBy: null,
    profitUsd: null,
    paidByHadEffect: null,
    paymentRowCountAtCreate: 0,
    drawerNetsToZero: "N/A",
    partnerLedgerNetsToZero: "N/A",
    debtLedgerNetsToZero: "N/A",
    note: opts.note ?? "",
  };

  if (result.success && result.id) {
    const serviceId = result.id;
    const txn = txnFor(db, serviceId);
    row.partnerRows = partnerLedgerRowsFor(db, serviceId);
    row.debtRows = txn ? debtLedgerRowsFor(db, txn.id) : [];
    row.metaPaidBy = txn?.metadata_json
      ? (JSON.parse(txn.metadata_json).paid_by ?? null)
      : null;
    row.profitUsd = txn?.profit_usd ?? null;

    // MUST run before refund: `deleteService` hard-DELETEs `payments` rows
    // (not a reversal row) — checking effect afterwards would always read
    // as "no effect", masking real postings as false positives for the
    // exact bug this harness exists to catch.
    if (txn) {
      row.paymentRowCountAtCreate = (
        db
          .prepare(`SELECT COUNT(*) c FROM payments WHERE transaction_id = ?`)
          .get(txn.id) as { c: number }
      ).c;
      row.paidByHadEffect = row.metaPaidBy
        ? methodHadEffect(db, txn.id, row.metaPaidBy)
        : null;
    }

    if (!opts.skipRefund) {
      repo.deleteService(serviceId);
      const afterRefund = snapshotDrawers(db);
      const refundDelta = diffSnapshots(before, afterRefund);
      row.drawerNetsToZero = Object.values(refundDelta).every(
        (v) => Math.abs(v) < 0.01,
      );

      const partnerRowsAfterRefund = partnerLedgerRowsFor(db, serviceId);
      const partnerNetByCurrency: Record<string, number> = {};
      for (const p of partnerRowsAfterRefund) {
        partnerNetByCurrency[p.currency] =
          (partnerNetByCurrency[p.currency] ?? 0) +
          (p.direction === "DEBIT" ? p.amount : -p.amount);
      }
      row.partnerLedgerNetsToZero = Object.values(
        partnerNetByCurrency,
      ).every((v) => Math.abs(v) < 0.01);

      const debtRowsAfterRefund = txn ? debtLedgerRowsFor(db, txn.id) : [];
      const debtNetUsd = debtRowsAfterRefund.reduce(
        (s, d) => s + d.amount_usd,
        0,
      );
      const debtNetLbp = debtRowsAfterRefund.reduce(
        (s, d) => s + d.amount_lbp,
        0,
      );
      row.debtLedgerNetsToZero =
        Math.abs(debtNetUsd) < 0.01 && Math.abs(debtNetLbp) < 0.01;
    }
  }

  rows.push(row);
  return row;
}

/** Whether the payments/debt_ledger rows for a transaction show ANY effect
 * attributable to `method` — used to check the "paid_by must not claim a
 * method with no effect" invariant. */
function methodHadEffect(
  db: Database.Database,
  txnId: number,
  method: string,
): boolean {
  const paymentRow = db
    .prepare(
      `SELECT COUNT(*) c FROM payments WHERE transaction_id = ? AND method = ?`,
    )
    .get(txnId, method) as { c: number };
  if (paymentRow.c > 0) return true;
  if (method === "CUSTOMER_ACCOUNT" || method === "GIFT_CARD") {
    const debtRow = db
      .prepare(`SELECT COUNT(*) c FROM debt_ledger WHERE transaction_id = ?`)
      .get(txnId) as { c: number };
    return debtRow.c > 0;
  }
  return false;
}

// ─── Test suite ─────────────────────────────────────────────────────────────

describe("CustomServiceRepository — owner-facing characterization matrix", () => {
  let db: Database.Database;
  let repo: CustomServiceRepository;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setDb } = require("../../db/connection");

  beforeEach(() => {
    db = createTestDb();
    setDb(db);
    resetTransactionRepository();
    initFixedTenantContext(1);
    repo = new CustomServiceRepository();
  });

  afterEach(() => {
    resetTenantContext();
    resetTransactionRepository();
    db.close();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION A — input type: preset vs inventory item vs free-text description
  //
  // FINDING: all three collapse to the same repository payload shape
  // (description/cost_usd/cost_lbp/price_usd/price_lbp) before the IPC call
  // is even made. Proven here by feeding the SAME numbers through 3
  // descriptions meant to represent each origin, and asserting the postings
  // are byte-identical. There is no `preset_id`/`product_id` column on
  // `custom_services` or `transactions` for the repository to have received
  // in the first place (checked against electron-app/create_db.sql).
  // ═══════════════════════════════════════════════════════════════════════
  describe("Section A — input type is indistinguishable at the repository layer", () => {
    it("A1/A2/A3: preset-derived, inventory-derived, and free-text payloads post identically", () => {
      const basePayload = (
        description: string,
      ): CreateCustomServiceInput => ({
        description,
        cost_usd: 2,
        cost_lbp: 0,
        price_usd: 10,
        price_lbp: 0,
        paid_by: "CASH",
        status: "completed",
      });

      const a1 = runScenario(db, repo, {
        id: "A1-preset",
        inputType: "preset",
        forPartner: false,
        method: "CASH",
        payload: basePayload("Preset: Screen Repair (from Presets manager)"),
        note: "Same shape as A2/A3 — repo cannot tell this came from a preset.",
      });
      const a2 = runScenario(db, repo, {
        id: "A2-inventory",
        inputType: "inventory item",
        forPartner: false,
        method: "CASH",
        payload: basePayload("iPhone 12 Screen (SKU-1042)"),
        note: "Same shape as A1/A3 — no product_id ever reaches the repo.",
      });
      const a3 = runScenario(db, repo, {
        id: "A3-freetext",
        inputType: "free-text",
        forPartner: false,
        method: "CASH",
        payload: basePayload("quick screen fix, walk-in"),
        note: "Same shape as A1/A2 — plain typed description.",
      });

      // The only thing that can differ is `description` — every money
      // effect must be byte-identical.
      expect(a2.createDelta).toEqual(a1.createDelta);
      expect(a3.createDelta).toEqual(a1.createDelta);
      expect(a2.profitUsd).toEqual(a1.profitUsd);
      expect(a3.profitUsd).toEqual(a1.profitUsd);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION B — For Partner = FALSE (walk-in), 3 payment methods × cost>0/=0
  // ═══════════════════════════════════════════════════════════════════════
  describe("Section B — walk-in (For Partner = false)", () => {
    const scenarios: Array<{
      id: string;
      method: string;
      costUsd: number;
      needsClient: boolean;
    }> = [
      { id: "B1", method: "CASH", costUsd: 2, needsClient: false },
      { id: "B2", method: "CASH", costUsd: 0, needsClient: false },
      { id: "B3", method: "CUSTOMER_ACCOUNT", costUsd: 2, needsClient: true },
      { id: "B4", method: "CUSTOMER_ACCOUNT", costUsd: 0, needsClient: true },
      { id: "B5", method: "OMT", costUsd: 2, needsClient: false },
      { id: "B6", method: "OMT", costUsd: 0, needsClient: false },
    ];

    for (const s of scenarios) {
      it(`${s.id}: walk-in, method=${s.method}, cost=$${s.costUsd} — invariants hold`, () => {
        const row = runScenario(db, repo, {
          id: s.id,
          inputType: "free-text",
          forPartner: false,
          method: s.method,
          payload: {
            description: `Walk-in ${s.method} cost=${s.costUsd}`,
            cost_usd: s.costUsd,
            cost_lbp: 0,
            price_usd: 10,
            price_lbp: 0,
            paid_by: s.method,
            status: "completed",
            ...(s.needsClient ? { client_id: 7 } : {}),
          },
        });

        expect(row.result).toBe("OK");

        // Invariant: never both a partner credit AND a customer debt for
        // the same money.
        expect(row.partnerRows.length === 0 || row.debtRows.length === 0).toBe(
          true,
        );

        // Invariant: metadata_json.paid_by must have had a real effect —
        // it always does on the walk-in path (cost model A: "cash now").
        expect(row.paidByHadEffect).toBe(true);

        // Rule 20: create -> reverse nets to 0 on every drawer/currency.
        expect(row.drawerNetsToZero).toBe(true);
        expect(row.partnerLedgerNetsToZero).toBe(true);
        expect(row.debtLedgerNetsToZero).toBe(true);
      });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION C — For Partner = TRUE
  //
  // C1/C2: the intended flow (no legacy paid_by leak) — cost>0 and cost=0.
  // C3/C4: reproduce the OWNER'S EXACT BUG (LIRA-114) — an explicit legacy
  //        `paid_by` set alongside `partnerMode: "FOR"` with NO payment legs.
  //        `assertNoCounterPayment` only inspects `data.payments` (plan
  //        §3), so this is NOT rejected today, and the dead value is
  //        stamped into `metadata_json.paid_by` regardless.
  // C5:    a leaked payments[] leg IS caught (assertNoCounterPayment).
  // C6:    a missing partnerId IS caught (assertPartnerIdRequired).
  // ═══════════════════════════════════════════════════════════════════════
  describe("Section C — For Partner = true", () => {
    it("C1: for-partner, default paid_by, cost>0 — cost posts for real, full price to partner tab", () => {
      const partnerId = seedPartner(db, "Partner C1");
      const row = runScenario(db, repo, {
        id: "C1",
        inputType: "free-text",
        forPartner: true,
        method: "CASH (default)",
        payload: {
          description: "For-partner job, default paid_by",
          cost_usd: 2,
          cost_lbp: 0,
          price_usd: 10,
          price_lbp: 0,
          paid_by: "CASH",
          status: "completed",
          partnerId,
          partnerMode: "FOR",
        },
      });

      expect(row.result).toBe("OK");
      expect(row.createDelta).toEqual({ "General/USD": -2 });
      expect(row.partnerRows).toHaveLength(1);
      expect(row.partnerRows[0].transaction_type).toBe("FOR_CUSTOM_SERVICE");
      expect(row.debtRows).toHaveLength(0);
      expect(row.partnerRows.length === 0 || row.debtRows.length === 0).toBe(
        true,
      );
      expect(row.drawerNetsToZero).toBe(true);
      expect(row.partnerLedgerNetsToZero).toBe(true);
    });

    it("C2: for-partner, default paid_by, cost=0 — no drawer touched at all, full price to partner tab", () => {
      const partnerId = seedPartner(db, "Partner C2");
      const row = runScenario(db, repo, {
        id: "C2",
        inputType: "free-text",
        forPartner: true,
        method: "CASH (default)",
        payload: {
          description: "For-partner job, no cost",
          cost_usd: 0,
          cost_lbp: 0,
          price_usd: 10,
          price_lbp: 0,
          paid_by: "CASH",
          status: "completed",
          partnerId,
          partnerMode: "FOR",
        },
      });

      expect(row.result).toBe("OK");
      // cost=0 => the cost-outflow `if ((data.cost_usd ?? 0) > 0)` guard
      // never fires => literally ZERO payments rows for this transaction,
      // yet metadata_json.paid_by still reads "CASH" (see the assertion
      // below) — the field claims a method that has ZERO backing rows.
      expect(row.createDelta).toEqual({});
      expect(row.partnerRows).toHaveLength(1);
      expect(row.metaPaidBy).toBe("CASH");
      expect(row.paymentRowCountAtCreate).toBe(0);
    });

    it("C3: for-partner + legacy paid_by=CUSTOMER_ACCOUNT, no legs — reproduces the owner's LIRA-114 report", () => {
      const partnerId = seedPartner(db, "Partner C3");
      const row = runScenario(db, repo, {
        id: "C3",
        inputType: "free-text",
        forPartner: true,
        method: "CUSTOMER_ACCOUNT (legacy leak)",
        payload: {
          description: "For-partner job, legacy CUSTOMER_ACCOUNT paid_by",
          cost_usd: 2,
          cost_lbp: 0,
          price_usd: 10,
          price_lbp: 0,
          paid_by: "CUSTOMER_ACCOUNT",
          status: "completed",
          partnerId,
          partnerMode: "FOR",
          // Deliberately NO client_id — the isForPartner branch never
          // checks it, unlike the walk-in CUSTOMER_ACCOUNT branch (B3/B4).
        },
        note: "createCustomServiceSchema would reject this at the API layer (paid_by=CUSTOMER_ACCOUNT requires client_id) — but the REPOSITORY, called directly, does not. zodOk column shows this.",
      });

      // Zod's cross-field refine (paid_by===CUSTOMER_ACCOUNT => client_id
      // required) fires regardless of partnerMode — the API layer WOULD
      // catch this specific combination even though the repository does not.
      expect(row.zodOk).toBe(false);

      if (row.result === "REJECTED BY GUARD") {
        // The parallel §3 guard-unification work has landed and now rejects
        // this at the repository layer too — a valid, expected outcome.
        expect(row.error).toBeTruthy();
        return;
      }

      // Pre-fix characterization: no counter payment took place (money-wise
      // this is safe — the full price still went to the partner, matching
      // C1) —
      expect(row.createDelta).toEqual({ "General/USD": -2 });
      expect(row.debtRows).toHaveLength(0);
      expect(row.partnerRows).toHaveLength(1);

      // THE BUG: metadata_json.paid_by claims CUSTOMER_ACCOUNT, but no
      // CUSTOMER_ACCOUNT leg and no debt_ledger row exist anywhere for this
      // transaction — the claimed method had ZERO effect. This assertion
      // documents the exact audit-trail gap FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md
      // §3 describes ("the audit trail records a payment method that never
      // executed") and is EXPECTED TO FAIL until that work either rejects
      // the combination or nulls `paid_by` before it reaches the row/metadata.
      expect(row.metaPaidBy).toBe("CUSTOMER_ACCOUNT");
      expect(row.paidByHadEffect).toBe(true);
    });

    it("C4: for-partner + legacy paid_by=OMT (wallet), no legs — same leak with a drawer-affecting method", () => {
      const partnerId = seedPartner(db, "Partner C4");
      const row = runScenario(db, repo, {
        id: "C4",
        inputType: "free-text",
        forPartner: true,
        method: "OMT (legacy leak)",
        payload: {
          description: "For-partner job, legacy OMT paid_by",
          cost_usd: 2,
          cost_lbp: 0,
          price_usd: 10,
          price_lbp: 0,
          paid_by: "OMT",
          status: "completed",
          partnerId,
          partnerMode: "FOR",
        },
        note: "No Zod cross-field rule exists for a wallet method + partnerMode:FOR (only CUSTOMER_ACCOUNT has one) — zodOk should read true, unlike C3.",
      });

      // No client_id is involved for a wallet method, so nothing in the
      // schema's refines fires — confirms the plan's "no schema anywhere
      // gates a payment-method field against partner mode" claim, for the
      // one case (wallet methods) the CUSTOMER_ACCOUNT refine doesn't cover.
      expect(row.zodOk).toBe(true);

      if (row.result === "REJECTED BY GUARD") {
        expect(row.error).toBeTruthy();
        return;
      }

      // OMT_App must be COMPLETELY untouched — the price was never
      // collected via OMT, only diverted to the partner.
      expect(row.createDelta).toEqual({ "General/USD": -2 });
      expect(row.partnerRows).toHaveLength(1);

      // THE BUG (same class as C3, drawer-affecting variant): metadata
      // claims "OMT" but OMT_App/USD delta is 0 and no `payments` row with
      // method="OMT" exists for this transaction. EXPECTED TO FAIL pre-fix.
      expect(row.metaPaidBy).toBe("OMT");
      expect(row.paidByHadEffect).toBe(true);
    });

    it("C5: for-partner + a leaked payments[] leg — REJECTED BY GUARD (assertNoCounterPayment)", () => {
      const partnerId = seedPartner(db, "Partner C5");
      const row = runScenario(db, repo, {
        id: "C5",
        inputType: "free-text",
        forPartner: true,
        method: "CASH (leaked leg)",
        payload: {
          description: "For-partner job with a leaked CASH leg",
          cost_usd: 0,
          cost_lbp: 0,
          price_usd: 10,
          price_lbp: 0,
          paid_by: "CASH",
          status: "completed",
          partnerId,
          partnerMode: "FOR",
          payments: [{ method: "CASH", currency_code: "USD", amount: 10 }],
        },
        skipRefund: true,
      });

      expect(row.result).toBe("REJECTED BY GUARD");
      expect(row.error).toMatch(/no counter payment/i);
      // Rejected inside a DB transaction => fully rolled back, no drawer moved.
      expect(row.createDelta).toEqual({});
    });

    it("C6: for-partner + no partnerId — REJECTED BY GUARD (assertPartnerIdRequired)", () => {
      const row = runScenario(db, repo, {
        id: "C6",
        inputType: "free-text",
        forPartner: true,
        method: "CASH",
        payload: {
          description: "For-partner job, missing partnerId",
          cost_usd: 0,
          cost_lbp: 0,
          price_usd: 10,
          price_lbp: 0,
          paid_by: "CASH",
          status: "completed",
          partnerMode: "FOR",
        },
        skipRefund: true,
      });

      expect(row.result).toBe("REJECTED BY GUARD");
      expect(row.error).toMatch(/partnerId is required/);
      expect(row.createDelta).toEqual({});
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Final: print the full table for the owner.
  // ═══════════════════════════════════════════════════════════════════════
  it("prints the full characterization matrix", () => {
    // eslint-disable-next-line no-console
    console.log(formatTable(rows));
    expect(rows.length).toBeGreaterThanOrEqual(14);
  });
});
