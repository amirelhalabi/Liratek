/**
 * LIRA-327 — "For Partner" is basket-wide on Mobile Recharge: ONE submit
 * books every provider's partner sales (iPick, Katsh, Whish App — cards and
 * bills), each costed against its OWN provider drawer, the full selling price
 * on the partner's account, no counter payment. All or nothing.
 *
 * What this file pins:
 *   - each sale is the exact row today's per-tab partner submit writes
 *     (same FinancialService call, partnerMode FOR, no legs);
 *   - each provider drawer pays only its own cost; the partner owes the total;
 *     General never moves;
 *   - a failure on any sale books NOTHING (the earlier sales roll back);
 *   - every refusal writes nothing;
 *   - voiding each sale nets every ledger to 0 per currency (rule 20: the
 *     reversal owner stays the generic per-transaction void).
 *
 * Real production schema (create_db.sql + migrations).
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
  getFinancialService,
  resetFinancialService,
  type FinancialService,
} from "../FinancialService";
import {
  RechargePartnerOrderService,
  resetRechargePartnerOrderService,
  type RechargePartnerOrderRequest,
} from "../RechargePartnerOrderService";
import { resetDebtRepository } from "../../repositories/DebtRepository";
import { resetClientRepository } from "../../repositories/ClientRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../../repositories/TransactionRepository";
import { resetPartnerRepository } from "../../repositories/PartnerRepository";
import { resetSettingsRepository } from "../../repositories/SettingsRepository";
import { resetFinancialServiceRepository } from "../../repositories/FinancialServiceRepository";
import { resetSupplierRepository } from "../../repositories/SupplierRepository";
import {
  snapshotLedgers,
  ledgerDeltas,
  type LedgerSnapshot,
} from "../../repositories/testHelpers/postingAssert";
import type { RechargePartnerOrderPayload } from "../../validators/rechargeBasket";

const REPO_ROOT = path.join(__dirname, "../../../../..");
const CREATE_DB_SQL_PATH = path.join(REPO_ROOT, "electron-app/create_db.sql");

function buildDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(fs.readFileSync(CREATE_DB_SQL_PATH, "utf-8"));
  initDatabase(db);
  runMigrations(db);
  return db;
}

function resetAll(): void {
  resetRechargePartnerOrderService();
  resetFinancialService();
  resetDebtRepository();
  resetClientRepository();
  resetTransactionRepository();
  resetPartnerRepository();
  resetSettingsRepository();
  resetFinancialServiceRepository();
  resetSupplierRepository();
}

type Sale = RechargePartnerOrderPayload["sales"][number];

/** Today's per-tab partner submits, minus partnerId / partnerMode (the
 *  order stamps them on every sale). */
const katshCards: Sale = {
  provider: "Katsh",
  serviceType: "SEND",
  amount: 800_000,
  cost: 720_000,
  currency: "LBP",
  commission: 80_000,
  payments: [],
  note: "Pubg 60 UC x2",
};
const katshBill: Sale = {
  provider: "Katsh",
  serviceType: "BILL",
  amount: 500_000,
  cost: 500_000,
  price: 500_000,
  currency: "LBP",
  commission: 0,
  payments: [],
};
const ipickCards: Sale = {
  provider: "iPick",
  serviceType: "SEND",
  amount: 180_000,
  cost: 150_000,
  currency: "LBP",
  commission: 30_000,
  payments: [],
  note: "Free Fire 100 Diamonds",
};
const whishUnit: Sale = {
  provider: "WHISH_APP",
  serviceType: "SEND",
  amount: 10,
  cost: 9,
  currency: "USD",
  commission: 1,
  payments: [],
  itemKey: "WHISH_APP/Gaming/PSN/PSN $10",
  itemCategory: "Gaming",
  note: "PSN $10",
};

const ROW_COLUMNS = `provider, service_type, amount, cost, price, commission,
  commission_model, currency, partner_id, note`;

describe("RechargePartnerOrderService.submit — For Partner across the basket", () => {
  let db: Database.Database;
  let partnerId: number;

  beforeEach(() => {
    resetAll();
    db = buildDb();
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    partnerId = Number(
      db
        .prepare(
          `INSERT INTO partners (tenant_id, name) VALUES (1, 'Partner A')`,
        )
        .run().lastInsertRowid,
    );
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
    resetTenantContext();
    resetAll();
    db.close();
  });

  function submit(
    sales: Sale[],
    service: RechargePartnerOrderService = new RechargePartnerOrderService(),
  ) {
    // The service takes the PARSED order; the sales here are what a caller
    // sends (schema input) — their defaults are all supplied explicitly.
    return service.submit({
      partnerId,
      sales: sales as RechargePartnerOrderRequest["sales"],
      userId: 1,
    });
  }

  function count(table: string): number {
    return (
      db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }
    ).n;
  }

  function rows() {
    return db
      .prepare(`SELECT id, ${ROW_COLUMNS} FROM financial_services ORDER BY id`)
      .all() as Array<Record<string, unknown> & { id: number }>;
  }

  function expectNothingWritten(before: LedgerSnapshot) {
    expect(ledgerDeltas(before, snapshotLedgers(db))).toEqual({
      drawers: {},
      supplier: {},
      partner: {},
      debt: {},
    });
    expect(count("financial_services")).toBe(0);
    expect(count("transactions")).toBe(0);
    expect(count("payments")).toBe(0);
  }

  it("books every provider's sales in one submit: each drawer pays its own cost, the partner owes the total, General never moves", () => {
    const before = snapshotLedgers(db);
    const result = submit([katshCards, katshBill, ipickCards, whishUnit]);
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(result.ids).toHaveLength(4);

    expect(
      rows().map((r) => [r.provider, r.service_type, r.amount, r.partner_id]),
    ).toEqual([
      ["Katsh", "SEND", 800_000, partnerId],
      ["Katsh", "BILL", 500_000, partnerId],
      ["iPick", "SEND", 180_000, partnerId],
      ["WHISH_APP", "SEND", 10, partnerId],
    ]);

    const d = ledgerDeltas(before, snapshotLedgers(db));
    expect(d.drawers).toEqual({
      "Katsh|LBP": -(720_000 + 500_000),
      "iPick|LBP": -150_000,
      "Whish_App|USD": -9,
    });
    expect(d.partner).toEqual({
      [`${partnerId}|LBP`]: 800_000 + 500_000 + 180_000,
      [`${partnerId}|USD`]: 10,
    });
    expect(d.debt).toEqual({});
  });

  it("each sale is the exact row today's per-tab partner submit writes", () => {
    const service = new RechargePartnerOrderService();
    const result = submit([katshCards, katshBill, whishUnit], service);
    expect(result.success).toBe(true);
    const basketRows = rows();

    // Today's calls, one by one, straight through FinancialService.
    for (const sale of [katshCards, katshBill, whishUnit]) {
      const alone = getFinancialService().addTransaction({
        ...sale,
        partnerId,
        partnerMode: "FOR",
        userId: 1,
      } as never);
      expect(alone.success).toBe(true);
    }
    const all = rows();
    const strip = (r: Record<string, unknown>) => {
      const { id: _id, ...rest } = r;
      return rest;
    };
    expect(basketRows.map(strip)).toEqual(all.slice(3).map(strip));
  });

  it("a sale that fails books nothing — the sales before it roll back", () => {
    const real = getFinancialService();
    let calls = 0;
    const failingSecond = {
      addTransaction: (
        data: Parameters<FinancialService["addTransaction"]>[0],
      ) => {
        calls += 1;
        if (calls === 2) return { success: false, error: "Drawer is locked" };
        return real.addTransaction(data);
      },
    } as unknown as FinancialService;

    const before = snapshotLedgers(db);
    const result = submit(
      [katshCards, ipickCards, whishUnit],
      new RechargePartnerOrderService(failingSecond),
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Drawer is locked/);
    expect(calls).toBe(2);
    expectNothingWritten(before);
  });

  describe("refusals write nothing", () => {
    function expectRefused(sales: Sale[], error: RegExp) {
      const before = snapshotLedgers(db);
      const result = submit(sales);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(error);
      expectNothingWritten(before);
    }

    it("no sales", () => {
      expectRefused([], /nothing/i);
    });

    it("a provider outside the Mobile Recharge basket", () => {
      expectRefused(
        [katshCards, { ...whishUnit, provider: "OMT_APP" }],
        /iPick, Katsh and Whish App/i,
      );
    });

    it("a bill on Whish App", () => {
      expectRefused(
        [{ ...katshBill, provider: "WHISH_APP" }],
        /iPick and Katsh/i,
      );
    });

    it("a money-out (RECEIVE) sale", () => {
      expectRefused([{ ...katshCards, serviceType: "RECEIVE" }], /sale/i);
    });

    it("a customer payment leg (a partner order collects no counter cash)", () => {
      expectRefused(
        [
          {
            ...katshCards,
            payments: [{ method: "CASH", currencyCode: "LBP", amount: 1 }],
          },
        ],
        /payment/i,
      );
    });

    it("a walk-in customer on a sale", () => {
      expectRefused([{ ...katshCards, clientId: 3 }], /customer/i);
    });

    it("a sale naming another partner", () => {
      expectRefused(
        [{ ...katshCards, partnerId: partnerId + 1, partnerMode: "FOR" }],
        /partner/i,
      );
    });
  });

  it("voiding each sale nets every ledger back to 0 per currency (rule 20)", () => {
    const before = snapshotLedgers(db);
    const result = submit([katshCards, katshBill, ipickCards, whishUnit]);
    expect(result.success).toBe(true);
    const txnRepo = getTransactionRepository();
    for (const fsId of result.ids!) {
      const txn = txnRepo.getBySourceId("financial_services", fsId)!;
      txnRepo.voidTransaction(txn.id, 1);
    }
    expect(ledgerDeltas(before, snapshotLedgers(db))).toEqual({
      drawers: {},
      supplier: {},
      partner: {},
      debt: {},
    });
  });
});
