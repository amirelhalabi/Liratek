/**
 * LIRA-305 — Syria remittance corridor: a Pay out's commission counts once the
 * partner's account (same currency) no longer owes that money — by cash OR by
 * netting against what the shop owes the same partner for SENDs (owner
 * decisions Y6 / Y13 / Y14, `docs/plans/OVERNIGHT_DECISIONS_2026-10-11.md` §3).
 *
 * The corridor, as built (Route A, v185 — nothing new is booked here):
 *   - SEND    = Custom Services → Via Partner. The customer pays the price into
 *               General; the shop owes the partner the cost (THROUGH_CUSTOM_SERVICE
 *               CREDIT). Commission counts at once.
 *   - RECEIVE = Via Partner + Pay out (`direction: "OUT"`). The shop pays the
 *               recipient the cost from General; the partner owes the shop the
 *               amount that arrived (THROUGH_CUSTOM_SERVICE DEBIT, an obligation
 *               head since LIRA-258 D5). Commission waits for the partner.
 *
 * The rule under test is read-time only (`partnerEffectiveCoveredSql`,
 * `constants/partnerObligation.ts`): nothing is stored, so every void/refund
 * re-derives on the next read (rule 20 needs no new reversal owner).
 *
 * Real writers + the real fresh schema (`electron-app/create_db.sql`); inputs
 * parsed through `createCustomServiceSchema` so the field names come from the
 * schema (rule 24). Expected values per case and their failing-first status
 * are recorded in `specs/305-syria-remittance/tasks.md` (T004 completion note).
 */

import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { performance } from "perf_hooks";
import { CustomServiceRepository } from "../CustomServiceRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import { ProfitRepository } from "../ProfitRepository";
import { PartnerRepository } from "../PartnerRepository";
import { ProfitService } from "../../services/ProfitService";
import { PartnerService } from "../../services/PartnerService";
import { RechargeService } from "../../services/RechargeService";
import { runWithTenant } from "../../db/tenantContext";
import {
  createCustomServiceSchema,
  type CreateCustomServiceInput,
} from "../../validators/customService";
import {
  partnerEffectiveCoveredSql,
  partnerNettingBalanceSql,
  partnerObligationCoverableSql,
  partnerObligationHeadRowSql,
  partnerPayoutUncoveredSql,
  payoutNewerSumSql,
} from "../../constants/partnerObligation";

const CREATE_DB_SQL_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "electron-app",
  "create_db.sql",
);

const DAY = "2026-09-10";
const MIDDAY = `${DAY}T12:00:00.000Z`;
const FULL_DAY_FROM = `${DAY} 00:00:00`;
const FULL_DAY_TO = `${DAY} 23:59:59`;

type Currency = "USD" | "LBP";

let db: Database.Database;
let partnerId: number;

function t<T>(fn: () => T): T {
  return runWithTenant(1, fn);
}

function at(hhmm: string): string {
  return `${DAY}T${hhmm}:00.000Z`;
}

function addPartner(name: string): number {
  const res = db
    .prepare(`INSERT INTO partners (tenant_id, name) VALUES (1, ?)`)
    .run(name);
  return Number(res.lastInsertRowid);
}

function create(input: Record<string, unknown>): number {
  const parsed = createCustomServiceSchema.parse(
    input,
  ) as CreateCustomServiceInput;
  const res = t(() => new CustomServiceRepository().createService(parsed, 1));
  if (!res.success || !res.id) {
    throw new Error(`createService failed: ${res.error}`);
  }
  return res.id;
}

function amountFields(
  cost: number,
  price: number,
  currency: Currency,
): Record<string, number> {
  return currency === "USD"
    ? { cost_usd: cost, price_usd: price }
    : { cost_lbp: cost, price_lbp: price };
}

/** SEND: Via Partner, customer pays `price` in cash; shop owes the partner `cost`. */
function send(
  cost: number,
  price: number,
  currency: Currency = "USD",
  time: string = MIDDAY,
  onPartner: number = partnerId,
): number {
  return create({
    description: "Syria send",
    ...amountFields(cost, price, currency),
    partnerMode: "VIA",
    partnerId: onPartner,
    payments: [{ method: "CASH", currency_code: currency, amount: price }],
    transaction_time: time,
  });
}

/** RECEIVE: Via Partner + Pay out — `arrived` is owed by the partner, `paidOut` leaves General. */
function receive(
  arrived: number,
  paidOut: number,
  currency: Currency = "USD",
  time: string = MIDDAY,
  onPartner: number = partnerId,
): number {
  return create({
    description: "Syria receive",
    ...amountFields(paidOut, arrived, currency),
    partnerMode: "VIA",
    partnerId: onPartner,
    direction: "OUT",
    transaction_time: time,
  });
}

function profit(): { usd: number; lbp: number } {
  const rows = t(() =>
    new ProfitService(new ProfitRepository()).getByModule(DAY, DAY),
  );
  const row = rows.find((r) => r.module === "CUSTOM_SERVICE");
  return { usd: row?.profit_usd ?? 0, lbp: row?.profit_lbp ?? 0 };
}

function profitUsd(): number {
  return profit().usd;
}

function settle(amount: number, currency: Currency = "USD"): number {
  const entry = t(() =>
    new PartnerService(new PartnerRepository()).settle({
      partnerId,
      amount,
      currency,
      settlementMethod: "CASH",
      userId: 1,
    }),
  );
  return entry.id;
}

function manualEntry(opts: {
  amount: number;
  direction: "DEBIT" | "CREDIT";
  moveCash: boolean;
  transactionType?: "ADJUSTMENT" | "THROUGH_OMT_SEND";
}): number {
  const entry = t(() =>
    new PartnerService(new PartnerRepository()).recordPartnerTransaction({
      partnerId,
      transactionType: opts.transactionType ?? "ADJUSTMENT",
      amount: opts.amount,
      currency: "USD",
      direction: opts.direction,
      userId: 1,
      moveCash: opts.moveCash,
    }),
  );
  return entry.id;
}

function txnIdOf(sourceTable: string, sourceId: number): number {
  const txn = t(() =>
    getTransactionRepository().getBySourceId(sourceTable, sourceId),
  );
  if (!txn) throw new Error(`no transaction for ${sourceTable}#${sourceId}`);
  return txn.id;
}

function voidTxn(txnId: number): void {
  t(() => getTransactionRepository().voidTransaction(txnId, 1));
}

function general(currency: Currency): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(balance), 0) AS b FROM drawer_balances
       WHERE drawer_name = 'General' AND currency_code = ?`,
    )
    .get(currency) as { b: number };
  return row.b;
}

function partnerBalance(id: number = partnerId): { usd: number; lbp: number } {
  const b = t(() => new PartnerRepository().getBalance(id));
  return { usd: b.usd, lbp: b.lbp };
}

interface MoneySnapshot {
  generalUsd: number;
  generalLbp: number;
  partnerUsd: number;
  partnerLbp: number;
}

function snapshot(): MoneySnapshot {
  const p = partnerBalance();
  return {
    generalUsd: general("USD"),
    generalLbp: general("LBP"),
    partnerUsd: p.usd,
    partnerLbp: p.lbp,
  };
}

function expectSnapshot(before: MoneySnapshot): void {
  const now = snapshot();
  expect(now.generalUsd).toBeCloseTo(before.generalUsd, 2);
  expect(now.generalLbp).toBeCloseTo(before.generalLbp, 0);
  expect(now.partnerUsd).toBeCloseTo(before.partnerUsd, 2);
  expect(now.partnerLbp).toBeCloseTo(before.partnerLbp, 0);
}

// ── Scenarios shared by the behaviour cases and the invariant/pin cases ────

const scenarios: Record<string, () => void> = {
  a: () => {
    send(150, 155);
    receive(100, 97);
    settle(50);
  },
  b: () => {
    send(100, 103);
    receive(100, 97);
  },
  c: () => {
    send(40, 42);
    receive(100, 97);
    settle(60);
  },
  d: () => {
    send(100, 103);
    settle(100);
    receive(100, 97);
  },
  e: () => {
    receive(100, 97, "USD", at("09:00"));
    receive(100, 96, "USD", at("10:00"));
    send(100, 103, "USD", at("11:00"));
  },
  g: () => {
    create({
      description: "For-partner service",
      price_usd: 100,
      cost_usd: 90,
      partnerMode: "FOR",
      partnerId,
      transaction_time: MIDDAY,
    });
    send(200, 205);
  },
};

interface HeadRow {
  id: number;
  transaction_type: string;
  direction: string;
  currency: string;
  created_jd: number;
  eff: number;
  cov: number;
  cash: number;
}

function heads(): HeadRow[] {
  return db
    .prepare(
      `SELECT plr.id, plr.transaction_type, plr.direction, plr.currency,
              julianday(plr.created_at) AS created_jd,
              ${partnerEffectiveCoveredSql("plr")} AS eff,
              ${partnerObligationCoverableSql("plr")} AS cov,
              MIN(plr.covered_amount, ${partnerObligationCoverableSql("plr")}) AS cash
         FROM partner_ledger plr
        WHERE ${partnerObligationHeadRowSql("plr")}`,
    )
    .all() as HeadRow[];
}

function isPayoutHead(h: HeadRow): boolean {
  return (
    h.transaction_type === "THROUGH_CUSTOM_SERVICE" && h.direction === "DEBIT"
  );
}

function nettingBalance(currency: Currency, id: number = partnerId): number {
  const row = db
    .prepare(
      `SELECT ${partnerNettingBalanceSql("x")} AS n FROM partner_ledger x
        WHERE x.partner_id = ? AND x.currency = ? LIMIT 1`,
    )
    .get(id, currency) as { n: number } | undefined;
  return row?.n ?? 0;
}

function checkInvariants(): void {
  const hs = heads();
  for (const h of hs) {
    expect(h.eff).toBeGreaterThanOrEqual(-0.005);
    expect(h.eff).toBeLessThanOrEqual(h.cov + 0.005);
    expect(h.eff).toBeGreaterThanOrEqual(h.cash - 0.005);
    if (!isPayoutHead(h)) expect(h.eff).toBeCloseTo(h.cash, 6);
  }
  for (const currency of ["USD", "LBP"] as const) {
    const payouts = hs.filter(
      (h) => isPayoutHead(h) && h.currency === currency,
    );
    if (payouts.length === 0) continue;
    const held = payouts.reduce((s, h) => s + (h.cov - h.eff), 0);
    const uncovered = payouts.reduce((s, h) => s + (h.cov - h.cash), 0);
    const n = nettingBalance(currency);
    expect(held).toBeCloseTo(Math.min(Math.max(0, n), uncovered), 4);
  }
}

/** A fresh in-memory DB from the real schema, with one partner. */
function freshDb(): void {
  if (db) db.close();
  db = new Database(":memory:");
  db.exec(fs.readFileSync(CREATE_DB_SQL_PATH, "utf8"));
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  resetTransactionRepository();
  partnerId = addPartner("7welet souria");
}

beforeEach(() => {
  freshDb();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  resetTransactionRepository();
  db.close();
  db = undefined as unknown as Database.Database;
});

describe("LIRA-305 — netting counts as the partner paying (Pay out commission)", () => {
  it("(a) shop is the net payer: 8 before settling, still 8 after the shop settles 50", () => {
    send(150, 155);
    receive(100, 97);
    expect(partnerBalance().usd).toBeCloseTo(-50, 2);
    expect(profitUsd()).toBeCloseTo(8, 2);
    settle(50);
    expect(partnerBalance().usd).toBeCloseTo(0, 2);
    expect(profitUsd()).toBeCloseTo(8, 2);
  });

  it("(b) balanced corridor: 6, and By Date / By Cashier carry the same +3", () => {
    scenarios.b();
    expect(profitUsd()).toBeCloseTo(6, 2);
    const svc = new ProfitService(new ProfitRepository());
    const byDate = t(() => svc.getByDate(DAY, DAY));
    expect(byDate.reduce((s, r) => s + r.profit_usd, 0)).toBeCloseTo(6, 2);
    const byUser = t(() => svc.getByUser(DAY, DAY));
    expect(byUser.reduce((s, r) => s + r.profit_usd, 0)).toBeCloseTo(6, 2);
  });

  it("(c) partner is the net payer: 3.2 before settling, 5 after the partner settles 60", () => {
    send(40, 42);
    receive(100, 97);
    expect(profitUsd()).toBeCloseTo(3.2, 2);
    settle(60);
    expect(partnerBalance().usd).toBeCloseTo(0, 2);
    expect(profitUsd()).toBeCloseTo(5, 2);
  });

  it("(d) SEND paid in cash first: the later RECEIVE still waits (3)", () => {
    scenarios.d();
    expect(partnerBalance().usd).toBeCloseTo(100, 2);
    expect(profitUsd()).toBeCloseTo(3, 2);
  });

  it("(e) oldest Pay out counts first: the newest is held (6)", () => {
    scenarios.e();
    expect(profitUsd()).toBeCloseTo(6, 2);
  });

  it("(f) currencies never net: USD send + LBP receive → LBP 0, USD 3", () => {
    send(100, 103, "USD");
    receive(9_000_000, 8_700_000, "LBP");
    const p = profit();
    expect(p.lbp).toBeCloseTo(0, 0);
    expect(p.usd).toBeCloseTo(3, 2);
  });

  it("(g) For Partner rows keep the cash-only rule (5, the FOR 10 not counted)", () => {
    scenarios.g();
    expect(profitUsd()).toBeCloseTo(5, 2);
  });
});

describe("LIRA-305 — reversals re-derive on the next read (rule 20)", () => {
  it("(h1) void the SEND of a balanced corridor → 0, money back", () => {
    receive(100, 97);
    const before = snapshot();
    const sendId = send(100, 103);
    expect(profitUsd()).toBeCloseTo(6, 2);
    voidTxn(txnIdOf("custom_services", sendId));
    expect(profitUsd()).toBeCloseTo(0, 2);
    expectSnapshot(before);
  });

  it("(h2) void the partner's 60 settlement → back to 3.2, money back", () => {
    send(40, 42);
    receive(100, 97);
    const before = snapshot();
    const entryId = settle(60);
    expect(profitUsd()).toBeCloseTo(5, 2);
    voidTxn(txnIdOf("partner_ledger", entryId));
    expect(profitUsd()).toBeCloseTo(3.2, 2);
    expectSnapshot(before);
  });

  it("(h3) refund the RECEIVE of a balanced corridor → 3, money back", () => {
    send(100, 103);
    const before = snapshot();
    const recvId = receive(100, 97);
    expect(profitUsd()).toBeCloseTo(6, 2);
    t(() =>
      getTransactionRepository().refundTransaction(
        txnIdOf("custom_services", recvId),
        1,
      ),
    );
    expect(profitUsd()).toBeCloseTo(3, 2);
    expectSnapshot(before);
  });

  it("(h4) LBP corridor: 600,000, void the RECEIVE → 300,000, money back", () => {
    send(9_000_000, 9_300_000, "LBP");
    const before = snapshot();
    const recvId = receive(9_000_000, 8_700_000, "LBP");
    expect(profit().lbp).toBeCloseTo(600_000, 0);
    voidTxn(txnIdOf("custom_services", recvId));
    expect(profit().lbp).toBeCloseTo(300_000, 0);
    expectSnapshot(before);
  });

  it("(q) a cash-moved DEBIT holds half the receive; voiding it restores 6 and the money", () => {
    scenarios.b();
    expect(profitUsd()).toBeCloseTo(6, 2);
    const before = snapshot();
    const entryId = manualEntry({
      amount: 50,
      direction: "DEBIT",
      moveCash: true,
    });
    expect(profitUsd()).toBeCloseTo(4.5, 2);
    voidTxn(txnIdOf("partner_ledger", entryId));
    expect(profitUsd()).toBeCloseTo(6, 2);
    expectSnapshot(before);
  });

  it("(r) a Whish App top-up from the partner counts, and its void is symmetric", () => {
    scenarios.b();
    expect(profitUsd()).toBeCloseTo(6, 2);
    const res = t(() =>
      new RechargeService().topUpFromPartner({
        provider: "WHISH_APP",
        partnerId,
        amount: 40,
        currency: "USD",
        userId: 1,
      }),
    );
    expect(res.success).toBe(true);
    expect(partnerBalance().usd).toBeCloseTo(-40, 2);
    expect(profitUsd()).toBeCloseTo(6, 2);
    const rechargeId = (
      db.prepare(`SELECT MAX(id) AS id FROM recharges`).get() as { id: number }
    ).id;
    voidTxn(txnIdOf("recharges", rechargeId));
    expect(profitUsd()).toBeCloseTo(6, 2);
    expect(partnerBalance().usd).toBeCloseTo(0, 2);
  });

  it("(s) a voided RECEIVE frees the SEND to net a new RECEIVE (6)", () => {
    send(100, 103);
    const recvId = receive(100, 97);
    voidTxn(txnIdOf("custom_services", recvId));
    expect(profitUsd()).toBeCloseTo(3, 2);
    receive(100, 97);
    expect(profitUsd()).toBeCloseTo(6, 2);
  });
});

describe("LIRA-305 — paper entries never release profit (Y13)", () => {
  it("(l) paper CREDIT → 0", () => {
    receive(100, 97);
    manualEntry({ amount: 100, direction: "CREDIT", moveCash: false });
    expect(profitUsd()).toBeCloseTo(0, 2);
  });

  it("(l) cash-moved CREDIT → 3", () => {
    receive(100, 97);
    manualEntry({ amount: 100, direction: "CREDIT", moveCash: true });
    expect(profitUsd()).toBeCloseTo(3, 2);
  });

  it("(l) paper CREDIT typed THROUGH_OMT_SEND → still 0 (the rule keys on the link, not the type)", () => {
    receive(100, 97);
    manualEntry({
      amount: 100,
      direction: "CREDIT",
      moveCash: false,
      transactionType: "THROUGH_OMT_SEND",
    });
    expect(profitUsd()).toBeCloseTo(0, 2);
  });

  it("(l-legacy) a pre-LIRA-066 paper CREDIT (no transactions row) → 0", () => {
    receive(100, 97);
    db.prepare(
      `INSERT INTO partner_ledger
         (tenant_id, partner_id, transaction_type, reference_table, reference_id,
          amount, currency, direction, user_id)
       VALUES (1, ?, 'ADJUSTMENT', NULL, NULL, 100, 'USD', 'CREDIT', 1)`,
    ).run(partnerId);
    expect(profitUsd()).toBeCloseTo(0, 2);
  });
});

describe("LIRA-305 — ordering and the deferred bucket", () => {
  it("(m) newer means julianday, not text order (ISO vs space format) → 6", () => {
    receive(100, 97, "USD", at("09:00"));
    const later = receive(100, 96, "USD", at("10:00"));
    send(100, 103, "USD", at("11:00"));
    db.prepare(
      `UPDATE partner_ledger SET created_at = ?
        WHERE reference_table = 'custom_services' AND reference_id = ?`,
    ).run(`${DAY} 10:00:00`, later);
    // Held = the 10:00 receive (commission 4). Text order would hold the
    // 09:00Z one instead and give 7.
    expect(profitUsd()).toBeCloseTo(6, 2);
  });

  it("(j) deferred bucket agrees: balanced corridor defers 0; a lone receive elsewhere defers 3", () => {
    scenarios.b();
    const repo = new ProfitRepository();
    expect(
      t(() => repo.getDeferredProfit(FULL_DAY_FROM, FULL_DAY_TO))
        .partner_profit_usd,
    ).toBeCloseTo(0, 2);
    expect(profitUsd()).toBeCloseTo(6, 2);

    const other = addPartner("Another corridor");
    receive(100, 97, "USD", MIDDAY, other);
    expect(
      t(() => repo.getDeferredProfit(FULL_DAY_FROM, FULL_DAY_TO))
        .partner_profit_usd,
    ).toBeCloseTo(3, 2);
    expect(profitUsd()).toBeCloseTo(6, 2);
  });
});

describe("LIRA-305 — invariants and rule-14 pins on the fragments", () => {
  it("(i) data-model invariants 1–4 hold on the end states of (a)–(e) and (g)", () => {
    for (const key of ["a", "b", "c", "d", "e", "g"]) {
      freshDb();
      scenarios[key]();
      checkInvariants();
    }
  });

  it("(i) existing G16 numbers: lone receive 0; partner pays 50 → 1.5", () => {
    receive(100, 97);
    expect(profitUsd()).toBeCloseTo(0, 2);
    settle(50);
    expect(profitUsd()).toBeCloseTo(1.5, 2);
  });

  it("(n) every NEW sub-query carries its tenant filter", () => {
    expect(partnerNettingBalanceSql("x")).toContain(
      "plb.tenant_id = x.tenant_id",
    );
    expect(partnerNettingBalanceSql("x")).toContain(
      "+plb_tx.tenant_id = plb.tenant_id",
    );
    expect(partnerNettingBalanceSql("x")).toContain(
      "+plb_tx2.tenant_id = plb.tenant_id",
    );
    expect(partnerPayoutUncoveredSql("x")).toContain(
      "ph.tenant_id = x.tenant_id",
    );
    expect(payoutNewerSumSql("x")).toContain("pg.tenant_id = x.tenant_id");
  });

  it("(o) partnerPayoutUncoveredSql = cov − cash and payoutNewerSumSql = the JS sum (a)–(e)", () => {
    for (const key of ["a", "b", "c", "d", "e"]) {
      freshDb();
      scenarios[key]();
      const rows = db
        .prepare(
          `SELECT plr.id, julianday(plr.created_at) AS jd,
                  ${partnerPayoutUncoveredSql("plr")} AS unc,
                  ${payoutNewerSumSql("plr")} AS newer,
                  ${partnerObligationCoverableSql("plr")}
                    - MIN(plr.covered_amount, ${partnerObligationCoverableSql("plr")}) AS expected_unc
             FROM partner_ledger plr
            WHERE ${partnerObligationHeadRowSql("plr")}
              AND plr.transaction_type = 'THROUGH_CUSTOM_SERVICE'
              AND plr.direction = 'DEBIT'`,
        )
        .all() as Array<{
        id: number;
        jd: number;
        unc: number;
        newer: number;
        expected_unc: number;
      }>;
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        expect(r.unc).toBeCloseTo(r.expected_unc, 6);
        const expectedNewer = rows
          .filter((o) => o.jd > r.jd || (o.jd === r.jd && o.id > r.id))
          .reduce((s, o) => s + o.unc, 0);
        expect(r.newer).toBeCloseTo(expectedNewer, 6);
      }
    }
  });

  it("(p) netting balance = getBalance with no paper credits; a paper CREDIT of 100 makes it exactly 100 higher", () => {
    send(40, 42);
    receive(100, 97);
    expect(nettingBalance("USD")).toBeCloseTo(partnerBalance().usd, 6);
    manualEntry({ amount: 100, direction: "CREDIT", moveCash: false });
    expect(nettingBalance("USD") - partnerBalance().usd).toBeCloseTo(100, 6);
  });
});

/** (k) fixture: 300 send(10,11) + 300 receive(10,9.7), alternating times. */
function buildSquareCorridor(): void {
  const base = Date.parse(`${DAY}T00:00:00.000Z`);
  for (let i = 0; i < 300; i += 1) {
    send(10, 11, "USD", new Date(base + 2 * i * 30_000).toISOString());
    receive(
      10,
      9.7,
      "USD",
      new Date(base + (2 * i + 1) * 30_000).toISOString(),
    );
  }
}

// The SC-004 budgets (3 s / 10 s) were measured on the owner's Mac. GitHub's
// ubuntu runners are ~1.4x slower on this query (CI run 38140093646: 4.1 s and
// 14.6 s), so on CI the same budgets are scaled — they still catch a query
// plan regression (that is an order of magnitude, not 40%), without failing
// on runner speed. Locally the original budgets apply unchanged.
const BUDGET_SCALE = process.env.CI ? 2.5 : 1;

describe("LIRA-305 — performance budgets (SC-004) and the query plan", () => {
  it("(k) square account, 300 + 300: getByModule < 3000 ms, profit 390", () => {
    buildSquareCorridor();
    const start = performance.now();
    const usd = profitUsd();
    const ms = performance.now() - start;
    process.stdout.write(`LIRA-305 (k) getByModule: ${ms.toFixed(0)} ms\n`);
    expect(usd).toBeCloseTo(390, 2);
    expect(ms).toBeLessThan(3000 * BUDGET_SCALE);
  }, 120_000);

  it("(k2) partner owes, + 150 unpaid receives: < 10000 ms, profit 390, deferred 45", () => {
    buildSquareCorridor();
    const base = Date.parse(`${DAY}T06:00:00.000Z`);
    for (let i = 0; i < 150; i += 1) {
      receive(10, 9.7, "USD", new Date(base + i * 30_000).toISOString());
    }
    const start = performance.now();
    const usd = profitUsd();
    const ms = performance.now() - start;
    process.stdout.write(`LIRA-305 (k2) getByModule: ${ms.toFixed(0)} ms\n`);
    expect(usd).toBeCloseTo(390, 2);
    expect(ms).toBeLessThan(10000 * BUDGET_SCALE);
    expect(
      t(() =>
        new ProfitRepository().getDeferredProfit(FULL_DAY_FROM, FULL_DAY_TO),
      ).partner_profit_usd,
    ).toBeCloseTo(45, 2);
  }, 180_000);

  it("(t) the paper-credit look-ups use idx_transactions_source, not a tenant scan", () => {
    buildSquareCorridor();
    const plan = db
      .prepare(
        `EXPLAIN QUERY PLAN SELECT ${partnerNettingBalanceSql("x")} FROM partner_ledger x`,
      )
      .all() as Array<{ detail: string }>;
    const details = plan.map((p) => p.detail);
    for (const alias of ["plb_tx", "plb_tx2"]) {
      const lookups = details.filter((d) =>
        new RegExp(`\\b${alias}\\b`).test(d),
      );
      expect(lookups.length).toBeGreaterThan(0);
      for (const d of lookups) {
        expect(d).toMatch(/idx_transactions_source/);
        expect(d).not.toMatch(/idx_transactions_tenant_id/);
      }
    }
  }, 120_000);
});
