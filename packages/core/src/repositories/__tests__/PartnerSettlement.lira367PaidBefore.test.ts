/**
 * LIRA-367 — found on Cornertech (SAMER, 31 Oct 2026): a settlement paid
 * the partner $4,072 for $3,088 of picked days. The extra $984 stays as an
 * open ACCOUNT row (the partner owes it back) and was meant for two OMT
 * receives (24 Oct $784, 27 Oct $200) that were re-entered and not ticked.
 *
 * Ticking those days later with NO money must close them against the $984
 * (allocator step 1c), move no cash, and leave the balance unchanged; void
 * puts everything back (rule 20). Deltas per currency (rule 15).
 *
 * Rule 17: this pins the SERVER behaviour the sheet fix relies on. It
 * passed on first run — the server already netted; the defect was the
 * sheet asking for the money again (partnerSettleDaysPayload LIRA-367
 * tests, proven failing first). So this file is not proven failing-first.
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

type Leg = {
  currency_code: "USD" | "LBP";
  amount: number;
  direction?: "OUT";
};

describe("LIRA-367 — money already paid to a partner covers picked days", () => {
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
    service = new PartnerService(
      partnerRepo,
      new PartnerSettlementRepository(),
    );
    txRepo = new TransactionRepository();
    fundDrawer(db, "General", "USD", 10_000);
    fundDrawer(db, "General", "LBP", 100_000_000);
    partnerId = run(() => partnerRepo.create({ name: "SAMER" }).id);
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
      (s, r) => ({
        usd: s.usd + r.remaining_usd,
        lbp: s.lbp + r.remaining_lbp,
      }),
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

  it("Samer: $984 paid on 31 Oct closes 24 Oct ($784) + 27 Oct ($200) with no money; void puts it back", () => {
    shopOwes(3_088, "USD", "2026-10-30 12:00:00");
    // 31 Oct: the shop pays $4,072 for the 30 Oct day — $984 extra.
    settle({ USD: [{ currency_code: "USD", amount: 4_072 }] }, ["2026-10-30"]);
    expect(balance()).toEqual({ usd: 984, lbp: 0 });

    // The two re-entered receives, on their own (older) days.
    shopOwes(784, "USD", "2026-10-24 18:04:00");
    shopOwes(200, "USD", "2026-10-27 19:27:00");
    expect(balance()).toEqual({ usd: 0, lbp: 0 });
    const drawer0 = drawerTotals(db);

    settle({ USD: [] }, ["2026-10-24", "2026-10-27"]);

    expect(open()).toEqual([]);
    expect(balance()).toEqual({ usd: 0, lbp: 0 });
    expect(drawerTotals(db)).toEqual(drawer0);
    expectInvariant();

    run(() => txRepo.voidTransaction(settlementTxn(), 1));
    expect(balance()).toEqual({ usd: 0, lbp: 0 });
    expect(drawerTotals(db)).toEqual(drawer0);
    // The two days are open again, and so is the $984 extra (ACCOUNT).
    const reopened = open();
    expect(
      reopened
        .filter((r) => r.row_scope === "DAY")
        .map((r) => r.shop_day)
        .sort(),
    ).toEqual(["2026-10-24", "2026-10-27"]);
    expect(
      reopened
        .filter((r) => r.row_scope === "ACCOUNT")
        .reduce((x, r) => x + r.remaining_usd, 0),
    ).toBeCloseTo(984, 2);
    expectInvariant();
  });
});
