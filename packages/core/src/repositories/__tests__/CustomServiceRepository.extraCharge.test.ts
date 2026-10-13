/**
 * LIRA-319 US4 (T039) + US5 (T053, Custom Services slice) — a custom service
 * with an extra charge.
 *
 * Owner shape: a service priced $9 (cost $7); the cashier adds a $1 extra
 * and the customer pays $10. The custom_services row keeps price 9 / cost 7;
 * the unified CUSTOM_SERVICE row's amount includes the extra (10), its
 * profit does not (2 = service margin), and the extra is stamped on its own
 * column (research R2). On account, the client's debt includes the extra;
 * a void brings every ledger back to 0 (rule 20).
 *
 * Real production schema (create_db.sql + migrations); nothing is mocked.
 * Field names come from `createCustomServiceSchema` — fixtures are typed as
 * the schema's input and parsed through it (rule 24). Refusals only the
 * repository can enforce (session-basket item, a caller that skips the
 * schema) call `createService` directly.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { initDatabase } from "../../db/connection";
import { runMigrations } from "../../db/migrations/index";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import {
  CustomServiceRepository,
  resetCustomServiceRepository,
} from "../CustomServiceRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import { resetPartnerRepository } from "../PartnerRepository";
import { resetStockBatchRepository } from "../StockBatchRepository";
import { resetDebtRepository } from "../DebtRepository";
import { resetDebtService } from "../../services/DebtService";
import {
  createCustomServiceSchema,
  type CreateCustomServiceInput,
  type CreateCustomServicePayload,
} from "../../validators/customService";
import {
  snapshotLedgers,
  ledgerDeltas,
  expectPostings,
} from "../testHelpers/postingAssert";

const REPO_ROOT = path.join(__dirname, "../../../../..");
const CREATE_DB_SQL_PATH = path.join(REPO_ROOT, "electron-app/create_db.sql");
const USER_ID = 1;
const RATE = 89_500;

let db: Database.Database;
let repo: CustomServiceRepository;

function buildDb(): Database.Database {
  const d = new Database(":memory:");
  d.exec(fs.readFileSync(CREATE_DB_SQL_PATH, "utf-8"));
  initDatabase(d);
  runMigrations(d);
  return d;
}

function resetAll(): void {
  resetCustomServiceRepository();
  resetTransactionRepository();
  resetPartnerRepository();
  resetStockBatchRepository();
  resetDebtRepository();
  resetDebtService();
}

function addClient(): number {
  return Number(
    db
      .prepare(
        `INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (1, ?, ?)`,
      )
      .run(`Client ${Math.random()}`, `03${Math.floor(Math.random() * 1e6)}`)
      .lastInsertRowid,
  );
}

function addPartner(): number {
  return Number(
    db
      .prepare(`INSERT INTO partners (tenant_id, name) VALUES (1, ?)`)
      .run(`Partner ${Math.random()}`).lastInsertRowid,
  );
}

/** A $9 service (cost $7) as the Services page sends it. */
function payload(
  patch: Partial<CreateCustomServicePayload>,
): CreateCustomServicePayload {
  return {
    description: "Screen protector fitting",
    cost_usd: 7,
    price_usd: 9,
    paid_by: "CASH",
    exchange_rate: RATE,
    ...patch,
  };
}

function parsed(
  patch: Partial<CreateCustomServicePayload>,
): CreateCustomServiceInput {
  return createCustomServiceSchema.parse(payload(patch));
}

/** A request the schema would refuse, sent straight to the repository. */
function raw(patch: Partial<CreateCustomServiceInput>): CreateCustomServiceInput {
  return { ...parsed({}), ...patch };
}

interface TxnRow {
  id: number;
  amount_usd: number;
  amount_lbp: number;
  profit_usd: number;
  profit_lbp: number;
  extra_usd: number;
  extra_lbp: number;
  metadata_json: string | null;
}

function serviceTxn(serviceId: number): TxnRow {
  return db
    .prepare(
      `SELECT id, amount_usd, amount_lbp, profit_usd, profit_lbp, extra_usd, extra_lbp, metadata_json
         FROM transactions
        WHERE source_table = 'custom_services' AND source_id = ? AND type = 'CUSTOM_SERVICE'`,
    )
    .get(serviceId) as TxnRow;
}

function count(table: "transactions" | "custom_services"): number {
  return (
    db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }
  ).c;
}

beforeEach(() => {
  resetAll();
  db = buildDb();
  initFixedTenantContext(1);
  repo = new CustomServiceRepository();
});

afterEach(() => {
  resetTenantContext();
  resetAll();
  db.close();
});

describe("T039 — a $9 service (cost $7) with a $1 extra (failing-first)", () => {
  it("cash $10: row amount 10, profit 2, extra 1; General +10; service price 9 / cost 7", () => {
    const before = snapshotLedgers(db);
    const res = repo.createService(
      parsed({
        extra_usd: 1,
        payments: [{ method: "CASH", currency_code: "USD", amount: 10 }],
      }),
      USER_ID,
    );
    expect(res).toEqual({ success: true, id: expect.any(Number) });
    const txn = serviceTxn(res.id!);
    expect(txn.amount_usd).toBeCloseTo(10, 6);
    expect(txn.amount_lbp).toBe(0);
    expect(txn.profit_usd).toBeCloseTo(2, 6);
    expect(txn.extra_usd).toBeCloseTo(1, 6);
    expect(txn.extra_lbp).toBe(0);
    expect(JSON.parse(txn.metadata_json ?? "{}")).toMatchObject({
      price_usd: 9,
      extra_usd: 1,
    });
    expectPostings(before, snapshotLedgers(db), {
      drawers: { "General|USD": 10 },
    });
    const row = db
      .prepare(
        `SELECT price_usd, cost_usd FROM custom_services WHERE id = ?`,
      )
      .get(res.id) as { price_usd: number; cost_usd: number };
    expect(row).toEqual({ price_usd: 9, cost_usd: 7 });
  });

  it("no payment legs (paid_by CASH only): General +10", () => {
    const before = snapshotLedgers(db);
    const res = repo.createService(parsed({ extra_usd: 1 }), USER_ID);
    expect(res.success).toBe(true);
    expect(serviceTxn(res.id!).amount_usd).toBeCloseTo(10, 6);
    expectPostings(before, snapshotLedgers(db), {
      drawers: { "General|USD": 10 },
    });
  });

  it("an LBP service: 900,000 + 100,000 extra → amount 1,000,000, extra_lbp 100,000", () => {
    const before = snapshotLedgers(db);
    const res = repo.createService(
      parsed({
        cost_usd: 0,
        price_usd: 0,
        cost_lbp: 700_000,
        price_lbp: 900_000,
        extra_lbp: 100_000,
        payments: [{ method: "CASH", currency_code: "LBP", amount: 1_000_000 }],
      }),
      USER_ID,
    );
    expect(res.success).toBe(true);
    const txn = serviceTxn(res.id!);
    expect(txn.amount_lbp).toBe(1_000_000);
    expect(txn.profit_lbp).toBe(200_000);
    expect(txn.extra_lbp).toBe(100_000);
    expectPostings(before, snapshotLedgers(db), {
      drawers: { "General|LBP": 1_000_000 },
    });
  });

  it("kept change reconciles against price + extra: $12 paid, $1.50 back, $0.50 kept", () => {
    const res = repo.createService(
      parsed({
        extra_usd: 1,
        payments: [
          { method: "CASH", currency_code: "USD", amount: 12 },
          { method: "CASH", currency_code: "USD", amount: 1.5, direction: "OUT" },
        ],
        kept_change_usd: 0.5,
      }),
      USER_ID,
    );
    expect(res.success).toBe(true);
    const txn = serviceTxn(res.id!);
    expect(txn.amount_usd).toBeCloseTo(10, 6);
    // margin 2 + kept 0.50; the extra is NOT in profit
    expect(txn.profit_usd).toBeCloseTo(2.5, 6);
    expect(txn.extra_usd).toBeCloseTo(1, 6);
  });

  it("void: every ledger nets to 0", () => {
    const before = snapshotLedgers(db);
    const res = repo.createService(
      parsed({
        extra_usd: 1,
        payments: [{ method: "CASH", currency_code: "USD", amount: 10 }],
      }),
      USER_ID,
    );
    getTransactionRepository().voidTransaction(serviceTxn(res.id!).id, USER_ID);
    expect(ledgerDeltas(before, snapshotLedgers(db))).toEqual({
      drawers: {},
      supplier: {},
      partner: {},
      debt: {},
    });
  });

  it("an extra equal to the price is accepted (the cap is inclusive)", () => {
    const res = repo.createService(
      parsed({
        extra_usd: 9,
        payments: [{ method: "CASH", currency_code: "USD", amount: 18 }],
      }),
      USER_ID,
    );
    expect(res.success).toBe(true);
  });
});

describe("T039/T040 — refusals: nothing is written (failing-first)", () => {
  function expectRefused(
    request: CreateCustomServiceInput,
    message: string,
  ): void {
    const before = snapshotLedgers(db);
    const txnsBefore = count("transactions");
    const servicesBefore = count("custom_services");
    const res = repo.createService(request, USER_ID);
    expect(res.success).toBe(false);
    expect(res.error).toBe(message);
    expectPostings(before, snapshotLedgers(db), {});
    expect(count("transactions")).toBe(txnsBefore);
    expect(count("custom_services")).toBe(servicesBefore);
  }

  describe("schema (both transports)", () => {
    function messages(patch: Partial<CreateCustomServicePayload>): string[] {
      const r = createCustomServiceSchema.safeParse(payload(patch));
      return r.success ? [] : r.error.issues.map((i) => i.message);
    }

    it("discount + extra", () => {
      expect(messages({ discount_usd: 1, price_usd: 8, extra_usd: 1 })).toContain(
        "A sale can have a discount or an extra, not both.",
      );
    });

    it("extra above the price", () => {
      expect(messages({ extra_usd: 9.01 })).toContain(
        "The extra can't be more than the sale itself.",
      );
    });

    it("an LBP extra on a USD-priced service (above its LBP price of 0)", () => {
      expect(messages({ extra_lbp: 10_000 })).toContain(
        "The extra can't be more than the sale itself.",
      );
    });

    it("extra on a for-partner service", () => {
      expect(
        messages({ extra_usd: 1, partnerId: 3, partnerMode: "FOR" }),
      ).toContain("No extra on a for-partner sale.");
    });

    it("extra on a via-partner service", () => {
      expect(
        messages({ extra_usd: 1, partnerId: 3, partnerMode: "VIA" }),
      ).toContain("No extra on a for-partner sale.");
    });

    it("a negative extra", () => {
      expect(messages({ extra_usd: -1 }).length).toBeGreaterThan(0);
    });

    it("no extra sent: no extra key invented (no default — offline replay)", () => {
      const out = createCustomServiceSchema.parse(payload({}));
      expect(out).not.toHaveProperty("extra_usd");
      expect(out).not.toHaveProperty("extra_lbp");
      expect(out).not.toHaveProperty("discount_usd");
    });
  });

  describe("repository (server-side, whatever the caller)", () => {
    it("discount + extra", () => {
      expectRefused(
        raw({ discount_usd: 1, price_usd: 8, extra_usd: 1 }),
        "A sale can have a discount or an extra, not both.",
      );
    });

    it("extra above the price", () => {
      expectRefused(
        raw({
          extra_usd: 9.01,
          payments: [{ method: "CASH", currency_code: "USD", amount: 18.01 }],
        }),
        "The extra can't be more than the sale itself.",
      );
    });

    it("extra on a for-partner service", () => {
      expectRefused(
        raw({ extra_usd: 1, partnerId: addPartner(), partnerMode: "FOR" }),
        "No extra on a for-partner sale.",
      );
    });

    it("extra on a via-partner service", () => {
      expectRefused(
        raw({
          extra_usd: 1,
          partnerId: addPartner(),
          partnerMode: "VIA",
          payments: [{ method: "CASH", currency_code: "USD", amount: 10 }],
        }),
        "No extra on a for-partner sale.",
      );
    });

    it("extra on a session-basket item", () => {
      expectRefused(
        raw({ extra_usd: 1, deferPayment: true }),
        "Add the extra at the session checkout.",
      );
    });
  });
});

describe("T053 — on account: the client's debt includes the extra; void → 0 (failing-first)", () => {
  /** $6 service (cost $5) + $1 extra, the owner's T053 shape. */
  const SIX = { cost_usd: 5, price_usd: 6, extra_usd: 1 } as const;

  it("legs: all $7 on the client's account → debt +7; void → every ledger 0", () => {
    const clientId = addClient();
    const before = snapshotLedgers(db);
    const res = repo.createService(
      parsed({
        ...SIX,
        client_id: clientId,
        paid_by: "CUSTOMER_ACCOUNT",
        payments: [
          { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 7 },
        ],
      }),
      USER_ID,
    );
    expect(res.success).toBe(true);
    expectPostings(before, snapshotLedgers(db), {
      debt: { [`${clientId}|USD`]: 7 },
    });
    getTransactionRepository().voidTransaction(serviceTxn(res.id!).id, USER_ID);
    expectPostings(before, snapshotLedgers(db), {});
  });

  it("no legs (paid_by CUSTOMER_ACCOUNT only) → debt +7; void → every ledger 0", () => {
    const clientId = addClient();
    const before = snapshotLedgers(db);
    const res = repo.createService(
      parsed({ ...SIX, client_id: clientId, paid_by: "CUSTOMER_ACCOUNT" }),
      USER_ID,
    );
    expect(res.success).toBe(true);
    expectPostings(before, snapshotLedgers(db), {
      debt: { [`${clientId}|USD`]: 7 },
    });
    getTransactionRepository().voidTransaction(serviceTxn(res.id!).id, USER_ID);
    expectPostings(before, snapshotLedgers(db), {});
  });

  it("$6 cash paid with a client → the $1 extra goes on the account", () => {
    const clientId = addClient();
    const before = snapshotLedgers(db);
    const res = repo.createService(
      parsed({
        ...SIX,
        client_id: clientId,
        payments: [
          { method: "CASH", currency_code: "USD", amount: 6 },
          { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 1 },
        ],
      }),
      USER_ID,
    );
    expect(res.success).toBe(true);
    expectPostings(before, snapshotLedgers(db), {
      drawers: { "General|USD": 6 },
      debt: { [`${clientId}|USD`]: 1 },
    });
  });
});
