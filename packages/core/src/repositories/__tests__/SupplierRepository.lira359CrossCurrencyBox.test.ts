/**
 * LIRA-359 (owner decisions 2026-10-29) — a supplier settle box may be paid
 * in the other currency, converted at the box's rate, for every calendar
 * supplier EXCEPT the OMT account (OMT is always given exact USD and LBP).
 *
 * Built like the sheet builds it: open queue → `buildDaySelections` → the
 * core schema's `parse` → the service. Money is checked as deltas per
 * currency (rule 15) and create + void must net to zero (rule 20).
 *
 * RULE 17 — NOT proven failing-first: the SupplierRepository conversion was
 * written before this file (the partner half, PartnerSettlement.lira359…,
 * was proven failing first).
 */
import Database from "better-sqlite3";
import {
  initFixedTenantContext,
  resetTenantContext,
  runWithTenant,
} from "../../db/tenantContext";
import {
  SupplierRepository,
  type AccountUnsettledRow,
  type SettleAccountRequest,
} from "../SupplierRepository";
import { getTransactionRepository } from "../TransactionRepository";
import {
  getSupplierService,
  resetSupplierService,
} from "../../services/SupplierService";
import { buildDaySelections } from "../../utils/settleDaySelections";
import { supplierSettleAccountSchema } from "../../validators/supplier";
import {
  buildDb,
  drawerTotals,
  fundDrawer,
  memberBalance,
  omtAccount,
  resetAll,
  seedLedgerRow,
  seedOmtSend,
} from "../testHelpers/omtAccountDb";

const UTC = { clientTzOffsetMinutes: 0 };
const RATE = 89_000;

type Leg = { currency_code: "USD" | "LBP"; amount: number };

describe("LIRA-359 — supplier settle box paid in the other currency", () => {
  let db: Database.Database;
  let repo: SupplierRepository;

  beforeEach(() => {
    resetAll();
    resetSupplierService();
    db = buildDb();
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    repo = new SupplierRepository();
    for (const d of ["General", "OMT_System", "OMT_App"]) {
      fundDrawer(db, d, "USD", 10_000);
      fundDrawer(db, d, "LBP", 100_000_000);
    }
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  const productSupplier = (name: string): number =>
    Number(
      db
        .prepare(
          `INSERT INTO suppliers (tenant_id, name, is_system, is_active) VALUES (1, ?, 0, 1)`,
        )
        .run(name).lastInsertRowid,
    );

  const queue = (supplierId: number): AccountUnsettledRow[] =>
    runWithTenant(1, () => repo.getAccountUnsettled(supplierId), UTC);

  function payload(
    supplierId: number,
    days: string[],
    boxes: { USD?: Leg[]; LBP?: Leg[] },
    rate: number | null = RATE,
  ): SettleAccountRequest {
    const built = buildDaySelections(queue(supplierId), {
      pickedDays: days,
      creditUsed: { usd: 0, lbp: 0 },
    });
    const section = (legs: Leg[]) => ({
      direction: "PAY" as const,
      payments: legs.map((l) => ({ method: "CASH", ...l })),
    });
    const parsed = supplierSettleAccountSchema.parse({
      account_supplier_id: supplierId,
      per_currency: {
        ...(boxes.USD ? { USD: section(boxes.USD) } : {}),
        ...(boxes.LBP ? { LBP: section(boxes.LBP) } : {}),
      },
      selections: built.selections,
      include_account_credits: true,
      credit_used: built.credit_used,
      expected_owed: built.expected_owed,
      ...(rate ? { exchange_rate: rate } : {}),
    });
    return { ...parsed, created_by: 1 } as SettleAccountRequest;
  }

  function settle(p: SettleAccountRequest): void {
    const res = runWithTenant(1, () => getSupplierService().settleAccount(p), UTC);
    if (!res.success) throw new Error(res.error);
  }

  const lastSettlementTxn = (): number =>
    (
      db
        .prepare(
          `SELECT transaction_id AS id FROM supplier_ledger
            WHERE transaction_id IS NOT NULL ORDER BY id DESC LIMIT 1`,
        )
        .get() as { id: number }
    ).id;

  it("product supplier owed $200 + 900,000 LBP: the $ box paid 17,800,000 LBP, the LBP box 900,000 — both close, drawer −18,700,000 LBP / $0; void nets to zero", () => {
    const acme = productSupplier("Acme Phones");
    seedLedgerRow(db, acme, {
      entry_type: "STOCK_INTAKE",
      amount_usd: 200,
      created_at: "2026-10-05 09:00:00",
    });
    seedLedgerRow(db, acme, {
      entry_type: "STOCK_INTAKE",
      amount_lbp: 900_000,
      created_at: "2026-10-05 10:00:00",
    });
    const drawer0 = drawerTotals(db);
    const balance0 = memberBalance(db, acme);

    settle(
      payload(acme, ["2026-10-05"], {
        USD: [{ currency_code: "LBP", amount: 17_800_000 }],
        LBP: [{ currency_code: "LBP", amount: 900_000 }],
      }),
    );

    expect(queue(acme)).toEqual([]);
    expect(memberBalance(db, acme)).toEqual({ usd: 0, lbp: 0 });
    const drawer1 = drawerTotals(db);
    expect(drawer1.usd - drawer0.usd).toBe(0);
    expect(drawer1.lbp - drawer0.lbp).toBe(-18_700_000);

    runWithTenant(
      1,
      () => getTransactionRepository().voidTransaction(lastSettlementTxn(), 1),
      UTC,
    );
    expect(memberBalance(db, acme)).toEqual(balance0);
    expect(drawerTotals(db)).toEqual(drawer0);
  });

  it("product supplier: the $200 box part-paid with 8,900,000 LBP pays $100, the rest stays open", () => {
    const acme = productSupplier("Acme Phones");
    const row = seedLedgerRow(db, acme, {
      entry_type: "STOCK_INTAKE",
      amount_usd: 200,
      created_at: "2026-10-05 09:00:00",
    });

    settle(
      payload(acme, ["2026-10-05"], {
        USD: [{ currency_code: "LBP", amount: 8_900_000 }],
      }),
    );

    expect(queue(acme).find((r) => r.id === row)?.remaining_usd).toBeCloseTo(
      100,
      2,
    );
  });

  it("product supplier: a line in the other currency without the rate is refused", () => {
    const acme = productSupplier("Acme Phones");
    seedLedgerRow(db, acme, {
      entry_type: "STOCK_INTAKE",
      amount_usd: 200,
      created_at: "2026-10-05 09:00:00",
    });
    const res = runWithTenant(
      1,
      () =>
        getSupplierService().settleAccount(
          payload(
            acme,
            ["2026-10-05"],
            { USD: [{ currency_code: "LBP", amount: 17_800_000 }] },
            null,
          ),
        ),
      UTC,
    );
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/exchange rate/i);
  });

  it("OMT is unchanged: an LBP line in the OMT $ box does not pay the dollars", () => {
    const { omtId } = omtAccount(db);
    seedOmtSend(db, omtId, {
      amount: 100,
      created_at: "2026-10-05 09:00:00",
    });
    const usdBefore = queue(omtId).reduce((s, r) => s + r.remaining_usd, 0);

    // The server refuses it (the schema can't know the supplier is OMT).
    expect(() =>
      settle(
        payload(omtId, ["2026-10-05"], {
          USD: [{ currency_code: "LBP", amount: 8_900_000 }],
        }),
      ),
    ).toThrow(/each currency on its own/);

    const usdAfter = queue(omtId).reduce((s, r) => s + r.remaining_usd, 0);
    expect(usdAfter).toBeCloseTo(usdBefore, 2);
  });
});
