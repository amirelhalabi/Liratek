/**
 * v133 / v134 — data-repair migrations for the settlement money fixes
 *
 * v133: deletes the phantom auto TOP_UP/PAYMENT supplier-ledger rows that
 *       wallet-provider (OMT_APP / WHISH_APP / BINANCE) transfers used to
 *       book (Fix B). Manual rows, BILL commissions (SUPPLIER_PAYS_US) and
 *       legacy cost-flow SALE_COST rows must survive.
 *
 * v134: adds the provider fee to auto TOP_UP rows of UNSETTLED OMT/WHISH
 *       SEND transactions that a C3-era build booked at the bare amount
 *       (Fix C repair). Pre-C3 rows (already gross) and settled rows must
 *       not be touched; the repair must be idempotent.
 */

import Database from "better-sqlite3";
import { MIGRATIONS } from "../index";

function migration(version: number) {
  const m = MIGRATIONS.find((x) => x.version === version);
  if (!m) throw new Error(`migration v${version} not found`);
  return m;
}

function createDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      name TEXT NOT NULL,
      provider TEXT,
      is_active INTEGER DEFAULT 1,
      is_system INTEGER DEFAULT 0
    );
    CREATE TABLE supplier_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      supplier_id INTEGER NOT NULL,
      entry_type TEXT NOT NULL,
      amount_usd REAL NOT NULL DEFAULT 0,
      amount_lbp REAL NOT NULL DEFAULT 0,
      note TEXT,
      created_by INTEGER,
      transaction_id INTEGER,
      is_auto INTEGER NOT NULL DEFAULT 0,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      refunded_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE financial_services (
      supplier_debt_booked INTEGER NOT NULL DEFAULT 0,
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER DEFAULT 1,
      provider TEXT NOT NULL,
      service_type TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'USD',
      commission REAL DEFAULT 0,
      cost REAL DEFAULT 0,
      omt_fee REAL,
      whish_fee REAL,
      is_settled INTEGER NOT NULL DEFAULT 1,
      settlement_id INTEGER,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO suppliers (name, provider, is_system) VALUES
      ('OMT', 'OMT', 1), ('OMT App', 'OMT_APP', 1), ('Whish App', 'WHISH_APP', 1),
      ('WHISH', 'WHISH', 1);
  `);
  return db;
}

const T = "2026-07-10 12:00:00";

describe("v133 — delete phantom wallet-provider ledger entries", () => {
  it("deletes auto TOP_UP/PAYMENT for wallet suppliers, keeps everything else", () => {
    const db = createDb();
    db.exec(`
      -- phantom rows (must be deleted)
      INSERT INTO supplier_ledger (supplier_id, entry_type, amount_usd, is_auto, note)
        VALUES (2, 'TOP_UP', 20, 1, 'Auto: SEND via OMT_APP');
      INSERT INTO supplier_ledger (supplier_id, entry_type, amount_usd, is_auto, note)
        VALUES (3, 'PAYMENT', -100, 1, 'Auto: RECEIVE via WHISH_APP');
      -- survivors
      INSERT INTO supplier_ledger (supplier_id, entry_type, amount_usd, is_auto, note)
        VALUES (2, 'SALE_COST', 15, 1, 'legacy cost-flow item sale');
      INSERT INTO supplier_ledger (supplier_id, entry_type, amount_lbp, is_auto, note)
        VALUES (3, 'SUPPLIER_PAYS_US', -20000, 1, 'Auto: BILL commission');
      INSERT INTO supplier_ledger (supplier_id, entry_type, amount_usd, is_auto, note)
        VALUES (2, 'PAYMENT', -50, 0, 'manual pay-down');
      -- classic OMT auto TOP_UP (non-wallet supplier — must survive)
      INSERT INTO supplier_ledger (supplier_id, entry_type, amount_usd, is_auto, note)
        VALUES (1, 'TOP_UP', 105, 1, 'Auto: SEND via OMT');
    `);

    migration(133).up(db);

    const remaining = db
      .prepare(`SELECT note FROM supplier_ledger ORDER BY id`)
      .all() as Array<{ note: string }>;
    expect(remaining.map((r) => r.note)).toEqual([
      "legacy cost-flow item sale",
      "Auto: BILL commission",
      "manual pay-down",
      "Auto: SEND via OMT",
    ]);
    db.close();
  });
});

describe("v134 — true-up under-booked OMT/WHISH SEND supplier debt", () => {
  function seedSend(
    db: Database.Database,
    opts: {
      provider: "OMT" | "WHISH";
      amount: number;
      fee: number;
      currency?: string;
      settlementId?: number | null;
      ledgerAmount: number; // what the auto TOP_UP was booked at
    },
  ) {
    const currency = opts.currency ?? "USD";
    db.prepare(
      `INSERT INTO financial_services
         (provider, service_type, amount, currency, omt_fee, whish_fee, settlement_id, created_at)
       VALUES (?, 'SEND', ?, ?, ?, ?, ?, ?)`,
    ).run(
      opts.provider,
      opts.amount,
      currency,
      opts.provider === "OMT" ? opts.fee : null,
      opts.provider === "WHISH" ? opts.fee : null,
      opts.settlementId ?? null,
      T,
    );
    db.prepare(
      `INSERT INTO supplier_ledger
         (supplier_id, entry_type, amount_usd, amount_lbp, is_auto, note, created_at)
       VALUES (?, 'TOP_UP', ?, ?, 1, 'Auto: SEND via ' || ?, ?)`,
    ).run(
      opts.provider === "OMT" ? 1 : 4,
      currency === "USD" ? opts.ledgerAmount : 0,
      currency === "LBP" ? opts.ledgerAmount : 0,
      opts.provider,
      T,
    );
  }

  it("adds the fee to bare-booked unsettled rows; leaves gross and settled rows alone; idempotent", () => {
    const db = createDb();
    // C3-era row: booked bare 100, fee 5 → must become 105.
    seedSend(db, { provider: "OMT", amount: 100, fee: 5, ledgerAmount: 100 });
    // Pre-C3 row: already gross 205 for amount 200 fee 5 → untouched.
    seedSend(db, { provider: "OMT", amount: 200, fee: 5, ledgerAmount: 205 });
    // Settled row booked bare → deliberately untouched.
    seedSend(db, {
      provider: "OMT",
      amount: 300,
      fee: 5,
      settlementId: 99,
      ledgerAmount: 300,
    });
    // LBP WHISH row booked bare 1,000,000 with 50,000 fee → 1,050,000.
    seedSend(db, {
      provider: "WHISH",
      amount: 1_000_000,
      fee: 50_000,
      currency: "LBP",
      ledgerAmount: 1_000_000,
    });

    migration(134).up(db);

    const amounts = () =>
      db
        .prepare(
          `SELECT amount_usd, amount_lbp FROM supplier_ledger ORDER BY id`,
        )
        .all() as Array<{ amount_usd: number; amount_lbp: number }>;

    let a = amounts();
    expect(a[0].amount_usd).toBeCloseTo(105, 4); // repaired
    expect(a[1].amount_usd).toBeCloseTo(205, 4); // already gross
    expect(a[2].amount_usd).toBeCloseTo(300, 4); // settled — untouched
    expect(a[3].amount_lbp).toBeCloseTo(1_050_000, 4); // LBP repaired

    // Idempotent: a second run must change nothing (repaired rows no longer
    // match the bare amount).
    migration(134).up(db);
    a = amounts();
    expect(a[0].amount_usd).toBeCloseTo(105, 4);
    expect(a[1].amount_usd).toBeCloseTo(205, 4);
    expect(a[2].amount_usd).toBeCloseTo(300, 4);
    expect(a[3].amount_lbp).toBeCloseTo(1_050_000, 4);
    db.close();
  });

  it("two identical same-second sends each get their fee exactly once", () => {
    const db = createDb();
    seedSend(db, { provider: "OMT", amount: 29, fee: 1, ledgerAmount: 29 });
    seedSend(db, { provider: "OMT", amount: 29, fee: 1, ledgerAmount: 29 });

    migration(134).up(db);

    const rows = db
      .prepare(`SELECT amount_usd FROM supplier_ledger ORDER BY id`)
      .all() as Array<{ amount_usd: number }>;
    expect(rows).toHaveLength(2);
    expect(rows[0].amount_usd).toBeCloseTo(30, 4);
    expect(rows[1].amount_usd).toBeCloseTo(30, 4);
    db.close();
  });
});
