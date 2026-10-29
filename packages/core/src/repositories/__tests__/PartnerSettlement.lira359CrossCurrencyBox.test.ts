/**
 * LIRA-359 (owner decisions 2026-10-29) — a partner settle box may be paid in
 * the other currency, converted at the box's rate. Each box still pays only
 * its own currency's amount; the drawer moves in the currency actually paid.
 *
 * Found on Cornertech: RAWAD HMAIDI was owed $8 + 700,000 LBP and the shop
 * paid everything in LBP; the $8 box only took dollars.
 *
 * Every money check is a delta per currency (rule 15) plus the balance
 * invariant (Σ open remaining == partner balance). Each scenario is voided
 * and must net to zero per currency (rule 20). Rule 17: written before the
 * fix and run against the unfixed code first.
 */
import Database from "better-sqlite3";
import {
  initFixedTenantContext,
  resetTenantContext,
  runWithTenant,
} from "../../db/tenantContext";
import { buildDb, drawerTotals, fundDrawer } from "../testHelpers/omtAccountDb";
import {
  PartnerSettlementRepository,
  resetPartnerSettlementRepository,
  type PartnerSettleRow,
} from "../PartnerSettlementRepository";
import {
  PartnerRepository,
  resetPartnerRepository,
} from "../PartnerRepository";
import {
  TransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import { PartnerService } from "../../services/PartnerService";
import { buildDaySelections } from "../../utils/settleDaySelections";
import {
  partnerSettleDaysSchema,
  type PartnerSettleDaysPayload,
} from "../../validators/partner";

const UTC = { clientTzOffsetMinutes: 0 };
const RATE = 89_000;

type Leg = {
  currency_code: "USD" | "LBP";
  amount: number;
  direction?: "OUT";
};

describe("LIRA-359 — partner settle box paid in the other currency", () => {
  let db: Database.Database;
  let partnerRepo: PartnerRepository;
  let service: PartnerService;
  let txRepo: TransactionRepository;
  let partnerId: number;

  const run = <T>(fn: () => T, now = "2026-10-29 20:00:00"): T =>
    runWithTenant(1, fn, {
      ...UTC,
      effectiveNow: `${now.replace(" ", "T")}Z`,
    });

  beforeEach(() => {
    resetTransactionRepository();
    resetPartnerRepository();
    resetPartnerSettlementRepository();
    db = buildDb();
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    partnerRepo = new PartnerRepository();
    service = new PartnerService(partnerRepo, new PartnerSettlementRepository());
    txRepo = new TransactionRepository();
    fundDrawer(db, "General", "USD", 10_000);
    fundDrawer(db, "General", "LBP", 100_000_000);
    partnerId = run(() => partnerRepo.create({ name: "RAWAD HMAIDI" }).id);
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  /** The shop owes the partner `amount` (a THROUGH row, CREDIT). */
  function shopOwes(amount: number, currency: "USD" | "LBP", at: string) {
    db.prepare(
      `INSERT INTO partner_ledger
         (tenant_id, partner_id, transaction_type, reference_table, reference_id, amount, currency, direction, created_at)
       VALUES (1, ?, 'THROUGH_CUSTOM_SERVICE', 'custom_services', ?, ?, ?, 'CREDIT', ?)`,
    ).run(partnerId, Math.floor(Math.random() * 1e6), amount, currency, at);
  }

  const open = (): PartnerSettleRow[] =>
    run(() => service.getSettleOpenRows(partnerId));

  function balance(): { usd: number; lbp: number } {
    return run(() => {
      const b = partnerRepo.getBalance(partnerId);
      return { usd: b.usd, lbp: b.lbp };
    });
  }

  function expectInvariant(): void {
    const sum = open().reduce(
      (s, r) => ({ usd: s.usd + r.remaining_usd, lbp: s.lbp + r.remaining_lbp }),
      { usd: 0, lbp: 0 },
    );
    const b = balance();
    expect(sum.usd).toBeCloseTo(b.usd, 2);
    expect(sum.lbp).toBeCloseTo(b.lbp, 0);
  }

  /** The shop pays: each box gets its own lines (any currency). Parsed
   *  through the real schema, like both transports do. */
  function settle(boxes: { USD?: Leg[]; LBP?: Leg[] }, days: string[]) {
    const sel = buildDaySelections(open(), { pickedDays: days });
    const section = (legs: Leg[]) => ({
      payer: "SHOP" as const,
      payments: legs.map((l) => ({ method: "CASH", ...l })),
    });
    const payload: PartnerSettleDaysPayload = {
      partnerId,
      selections: sel.selections.map((s) => s.id),
      include_account_credits: true,
      credit_used: sel.credit_used,
      expected_owed: sel.expected_owed,
      per_currency: {
        ...(boxes.USD ? { USD: section(boxes.USD) } : {}),
        ...(boxes.LBP ? { LBP: section(boxes.LBP) } : {}),
      },
      exchange_rate: RATE,
    };
    const parsed = partnerSettleDaysSchema.parse(payload);
    const res = run(() => service.settleDays({ ...parsed, userId: 1 }));
    if (!res.success) throw new Error(res.error);
    return res.id!;
  }

  const settlementTxn = (): number =>
    (
      db
        .prepare(
          `SELECT id FROM transactions WHERE type = 'PARTNER_SETTLEMENT' ORDER BY id DESC LIMIT 1`,
        )
        .get() as { id: number }
    ).id;

  it("Rayan's case: $8 + 700,000 LBP, both boxes paid in LBP (712,000 + 700,000) — partner 0, drawer −1,412,000 LBP, $0; void nets to zero", () => {
    shopOwes(8, "USD", "2026-10-29 17:36:52");
    shopOwes(700_000, "LBP", "2026-10-29 17:39:03");
    expect(balance()).toEqual({ usd: -8, lbp: -700_000 });
    const drawer0 = drawerTotals(db);

    settle(
      {
        USD: [{ currency_code: "LBP", amount: 712_000 }],
        LBP: [{ currency_code: "LBP", amount: 700_000 }],
      },
      ["2026-10-29"],
    );

    expect(balance()).toEqual({ usd: 0, lbp: 0 });
    expect(open()).toEqual([]);
    const drawer1 = drawerTotals(db);
    expect(drawer1.usd - drawer0.usd).toBe(0);
    expect(drawer1.lbp - drawer0.lbp).toBe(-1_412_000);
    expectInvariant();

    run(() => txRepo.voidTransaction(settlementTxn(), 1));
    expect(balance()).toEqual({ usd: -8, lbp: -700_000 });
    expect(drawerTotals(db)).toEqual(drawer0);
    expectInvariant();
  });

  it("the LBP box paid in dollars: 700,000 LBP box paid $8 (712,000 at 89,000) leaves 12,000 LBP as partner credit", () => {
    shopOwes(700_000, "LBP", "2026-10-29 10:00:00");
    const drawer0 = drawerTotals(db);

    settle({ LBP: [{ currency_code: "USD", amount: 8 }] }, ["2026-10-29"]);

    // Extra paid stays in the box's own currency (LBP): the partner now
    // owes the shop 12,000 LBP.
    expect(balance()).toEqual({ usd: 0, lbp: 12_000 });
    const drawer1 = drawerTotals(db);
    expect(drawer1.usd - drawer0.usd).toBe(-8);
    expect(drawer1.lbp - drawer0.lbp).toBe(0);
    expectInvariant();

    run(() => txRepo.voidTransaction(settlementTxn(), 1));
    expect(balance()).toEqual({ usd: 0, lbp: -700_000 });
    expect(drawerTotals(db)).toEqual(drawer0);
  });

  it("part-pay in the other currency: $8 box paid 356,000 LBP pays $4.00, the rest stays open", () => {
    shopOwes(8, "USD", "2026-10-29 10:00:00");
    const drawer0 = drawerTotals(db);

    settle({ USD: [{ currency_code: "LBP", amount: 356_000 }] }, [
      "2026-10-29",
    ]);

    expect(balance()).toEqual({ usd: -4, lbp: 0 });
    expect(drawerTotals(db).lbp - drawer0.lbp).toBe(-356_000);
    expectInvariant();
  });

  it("converted amounts round to the cent: 300,000 LBP on a $8 box pays $3.37", () => {
    shopOwes(8, "USD", "2026-10-29 10:00:00");

    settle({ USD: [{ currency_code: "LBP", amount: 300_000 }] }, [
      "2026-10-29",
    ]);

    expect(balance().usd).toBeCloseTo(-4.63, 2);
    expectInvariant();
  });

  it("a box paid in its own currency is unchanged (no conversion)", () => {
    shopOwes(8, "USD", "2026-10-29 10:00:00");
    const drawer0 = drawerTotals(db);

    settle({ USD: [{ currency_code: "USD", amount: 8 }] }, ["2026-10-29"]);

    expect(balance()).toEqual({ usd: 0, lbp: 0 });
    expect(drawerTotals(db).usd - drawer0.usd).toBe(-8);
    expect(drawerTotals(db).lbp - drawer0.lbp).toBe(0);
  });

  it("a line in the other currency needs the box rate: refused without exchange_rate", () => {
    shopOwes(8, "USD", "2026-10-29 10:00:00");
    const sel = buildDaySelections(open(), { pickedDays: ["2026-10-29"] });
    const result = partnerSettleDaysSchema.safeParse({
      partnerId,
      selections: sel.selections.map((s) => s.id),
      include_account_credits: true,
      credit_used: sel.credit_used,
      expected_owed: sel.expected_owed,
      per_currency: {
        USD: {
          payer: "SHOP",
          payments: [{ method: "CASH", currency_code: "LBP", amount: 712_000 }],
        },
      },
    });
    expect(result.success).toBe(false);
  });
});
