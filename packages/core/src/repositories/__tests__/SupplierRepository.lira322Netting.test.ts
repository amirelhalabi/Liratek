/**
 * LIRA-322 Phase 6 (US3) + T043 (US4) — credits net first, OMT pays the
 * shop, and one settlement that pays in one currency and collects in the
 * other (tasks T033 (a)–(e), T034 (f)–(j), T043 (k); research R3/R5/R7).
 *
 * The test shop's account: six USD transfers $152/$101/$101/$101/$21/$21
 * (oldest first, $497 owed) on the OMT counter, commission model 1. Each
 * case adds the credits / LBP rows it needs.
 *
 * Every case asserts DELTAS (rule 15) and the balance invariant
 * (data-model.md invariant 1): per member and currency, the ledger sum
 * equals Σ remaining over that member's open queue rows. Voids prove
 * create + reverse nets to 0 per member per currency (rule 20).
 */
import Database from "better-sqlite3";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import {
  SupplierRepository,
  type SettleAccountRequest,
} from "../SupplierRepository";
import { getTransactionRepository } from "../TransactionRepository";
import {
  buildDb,
  coverageRows,
  drawerTotals,
  fundDrawer,
  memberBalance,
  omtAccount,
  profitTotals,
  resetAll,
  seedLedgerRow,
  seedOmtSend,
  settlementTxn,
  writeCounts,
  type CurrencyPair,
  type OmtAccount,
} from "../testHelpers/omtAccountDb";

const USD_ROWS = [152, 101, 101, 101, 21, 21];
const RATE = 89000;

describe("LIRA-322 — netting, COLLECT and two directions (SupplierRepository)", () => {
  let db: Database.Database;
  let repo: SupplierRepository;
  let acc: OmtAccount;
  let usd: number[];

  beforeEach(() => {
    resetAll();
    db = buildDb();
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    repo = new SupplierRepository();
    acc = omtAccount(db);
    for (const d of ["OMT_System", "General"]) {
      fundDrawer(db, d, "USD", 10000);
      fundDrawer(db, d, "LBP", 100_000_000);
    }
    usd = USD_ROWS.map((amount, i) =>
      seedOmtSend(db, acc.omtId, {
        amount,
        created_at: `2026-10-01 0${i + 1}:00:00`,
      }),
    );
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  // ── helpers ──────────────────────────────────────────────────────────────

  const cashUsd = (amount: number) => ({
    method: "CASH",
    currency_code: "USD",
    amount,
  });
  const cashLbp = (amount: number) => ({
    method: "CASH",
    currency_code: "LBP",
    amount,
  });
  const changeLbp = (amount: number) => ({
    method: "CASH",
    currency_code: "LBP",
    amount,
    direction: "OUT" as const,
  });

  function queueOwed(
    selections?: SettleAccountRequest["selections"],
  ): CurrencyPair {
    let q = repo.getAccountUnsettled(acc.omtId);
    if (selections) {
      const keys = new Set(selections.map((s) => `${s.kind}:${s.id}`));
      q = q.filter((r) => keys.has(`${r.kind}:${r.id}`));
    }
    return {
      usd: q.reduce((s, r) => s + r.remaining_usd, 0),
      lbp: q.reduce((s, r) => s + r.remaining_lbp, 0),
    };
  }

  function settle(
    per_currency: SettleAccountRequest["per_currency"],
    extra: Partial<SettleAccountRequest> = {},
  ): number {
    return repo.settleAccount({
      account_supplier_id: acc.omtId,
      per_currency,
      expected_owed: queueOwed(extra.selections),
      exchange_rate: RATE,
      created_by: 1,
      ...extra,
    }).id;
  }

  const members = (): number[] => [acc.omtId, acc.appId, acc.ipickId];

  /** data-model.md invariant 1, for every member. */
  function expectBalanceInvariant(): void {
    const q = repo.getAccountUnsettled(acc.omtId);
    for (const member of members()) {
      const bal = memberBalance(db, member);
      const rows = q.filter((r) => r.supplier_id === member);
      expect({ member, usd: round2(bal.usd) }).toEqual({
        member,
        usd: round2(rows.reduce((s, r) => s + r.remaining_usd, 0)),
      });
      expect({ member, lbp: Math.round(bal.lbp) }).toEqual({
        member,
        lbp: Math.round(rows.reduce((s, r) => s + r.remaining_lbp, 0)),
      });
    }
  }

  function round2(v: number): number {
    return Math.round(v * 100) / 100 + 0;
  }

  function balances(): Record<number, CurrencyPair> {
    const out: Record<number, CurrencyPair> = {};
    for (const m of members()) out[m] = memberBalance(db, m);
    return out;
  }

  function expectNetZero(
    before: {
      drawers: CurrencyPair;
      balances: Record<number, CurrencyPair>;
      profit: CurrencyPair;
    },
  ): void {
    const d = drawerTotals(db);
    expect(round2(d.usd - before.drawers.usd)).toBe(0);
    expect(Math.round(d.lbp - before.drawers.lbp)).toBe(0);
    for (const m of members()) {
      const b = memberBalance(db, m);
      expect({ m, usd: round2(b.usd - before.balances[m].usd) }).toEqual({ m, usd: 0 });
      expect({ m, lbp: Math.round(b.lbp - before.balances[m].lbp) }).toEqual({ m, lbp: 0 });
    }
    const p = profitTotals(db);
    expect(round2(p.usd - before.profit.usd)).toBe(0);
    expect(Math.round(p.lbp - before.profit.lbp)).toBe(0);
  }

  function snapshot() {
    return { drawers: drawerTotals(db), balances: balances(), profit: profitTotals(db) };
  }

  function fsState(id: number): { settlement_id: number | null } {
    return db
      .prepare(`SELECT settlement_id FROM financial_services WHERE id = ?`)
      .get(id) as { settlement_id: number | null };
  }

  function ledgerState(id: number): { settlement_id: number | null } {
    return db
      .prepare(`SELECT settlement_id FROM supplier_ledger WHERE id = ?`)
      .get(id) as { settlement_id: number | null };
  }

  /** An OMT App cash-out credit as `RechargeRepository.cashoutToSupplier`
   *  books it: a negative PAYMENT ledger row source-ref'd to a recharge,
   *  plus the ACTIVE WALLET_CASHOUT transaction carrying the deferred
   *  commission in its metadata (copied from accountSettlement.test.ts). */
  function seedCashout(data: {
    supplierId: number;
    total: number;
    commission: number;
    rechargeId: number;
    created_at: string;
  }): number {
    const ledgerId = Number(
      db
        .prepare(
          `INSERT INTO supplier_ledger
             (tenant_id, supplier_id, entry_type, amount_usd, amount_lbp, is_auto,
              source_ref_table, source_ref_id, created_by, created_at)
           VALUES (1, ?, 'PAYMENT', ?, 0, 1, 'recharges', ?, 1, ?)`,
        )
        .run(data.supplierId, -data.total, data.rechargeId, data.created_at)
        .lastInsertRowid,
    );
    db.prepare(
      `INSERT INTO transactions (tenant_id, type, source_table, source_id, amount_usd, amount_lbp, metadata_json, user_id)
       VALUES (1, 'WALLET_CASHOUT', 'recharges', ?, ?, 0, ?, 1)`,
    ).run(
      data.rechargeId,
      data.total - data.commission,
      JSON.stringify({ commission: data.commission, currency: "USD" }),
    );
    return ledgerId;
  }

  function ledgerRowsOf(txnId: number) {
    return db
      .prepare(
        `SELECT id, supplier_id, entry_type, amount_usd, amount_lbp, is_auto,
                settlement_id, note, is_refunded
           FROM supplier_ledger WHERE tenant_id = 1 AND transaction_id = ? ORDER BY id`,
      )
      .all(txnId) as Array<{
      id: number;
      supplier_id: number;
      entry_type: string;
      amount_usd: number;
      amount_lbp: number;
      is_auto: number;
      settlement_id: number | null;
      note: string | null;
      is_refunded: number;
    }>;
  }

  // ── T033 — credits net first ─────────────────────────────────────────────

  it("(a) same-member credit −$60 + Cash $437: everything closes; NETTING 60 on the credit and 60 on the $152", () => {
    const credit = seedLedgerRow(db, acc.omtId, {
      entry_type: "SUPPLIER_PAYS_US",
      amount_usd: -60,
      created_at: "2026-10-01 00:10:00",
    });
    settle({ USD: { direction: "PAY", payments: [cashUsd(437)] } });
    const net = coverageRows(db).filter((c) => c.source === "NETTING");
    expect(net.find((c) => c.row_kind === "LEDGER" && c.row_id === credit)!.amount).toBeCloseTo(60, 6);
    expect(
      net.find((c) => c.row_kind === "FINANCIAL_SERVICE" && c.row_id === usd[0])!.amount,
    ).toBeCloseTo(60, 6);
    expect(queueOwed()).toEqual({ usd: 0, lbp: 0 });
    expectBalanceInvariant();
  });

  it("(b) cross-member: an OMT App credit −$60 nets the counter's debt with an auto pair; each line matches its own rows", () => {
    const credit = seedLedgerRow(db, acc.appId, {
      entry_type: "SUPPLIER_PAYS_US",
      amount_usd: -60,
      created_at: "2026-10-01 00:10:00",
    });
    const before = snapshot();
    const accountTotal0 = members().reduce((s, m) => s + before.balances[m].usd, 0);

    const anchor = settle({ USD: { direction: "PAY", payments: [cashUsd(437)] } });
    const txn = settlementTxn(db, anchor);

    const pair = ledgerRowsOf(txn.id).filter((r) => r.is_auto === 1);
    expect(pair).toHaveLength(2);
    const debit = pair.find((r) => r.supplier_id === acc.omtId)!;
    const creditSide = pair.find((r) => r.supplier_id === acc.appId)!;
    expect(debit).toEqual(
      expect.objectContaining({ entry_type: "PAYMENT", amount_lbp: 0, settlement_id: anchor }),
    );
    expect(debit.amount_usd).toBeCloseTo(-60, 6);
    expect(creditSide).toEqual(
      expect.objectContaining({
        entry_type: "SUPPLIER_PAYS_US",
        amount_lbp: 0,
        settlement_id: anchor,
      }),
    );
    expect(creditSide.amount_usd).toBeCloseTo(60, 6);
    expect(debit.note).toMatch(/^Auto: netted with .+ in settlement #\d+$/);
    expect(creditSide.note).toMatch(/^Auto: netted with .+ in settlement #\d+$/);
    // Neither pair row is ever an open queue row.
    const q = repo.getAccountUnsettled(acc.omtId);
    expect(q.filter((r) => r.kind === "LEDGER" && pair.some((p) => p.id === r.id))).toEqual([]);
    expect(ledgerState(credit).settlement_id).toBe(anchor);
    expect(queueOwed()).toEqual({ usd: 0, lbp: 0 });
    // The pair moves the lines, not the account total: total moved by the money only.
    const accountTotal1 = members().reduce((s, m) => s + memberBalance(db, m).usd, 0);
    expect(round2(accountTotal1 - accountTotal0)).toBe(-437);
    expect(round2(memberBalance(db, acc.appId).usd - before.balances[acc.appId].usd)).toBe(60);
    expectBalanceInvariant();
  });

  it("(b2) void of the cross-member settlement soft-voids the pair; nets to 0 per member per currency", () => {
    seedLedgerRow(db, acc.appId, {
      entry_type: "SUPPLIER_PAYS_US",
      amount_usd: -60,
      created_at: "2026-10-01 00:10:00",
    });
    const before = snapshot();
    const anchor = settle({ USD: { direction: "PAY", payments: [cashUsd(437)] } });
    const txn = settlementTxn(db, anchor);
    getTransactionRepository().voidTransaction(txn.id, 1);
    expect(ledgerRowsOf(txn.id).every((r) => r.is_refunded === 1)).toBe(true);
    expectNetZero(before);
    expect(coverageRows(db).every((c) => c.is_reversed === 1)).toBe(true);
    expect(queueOwed()).toEqual({ usd: 437, lbp: 0 });
    expectBalanceInvariant();
  });

  it("(c) credit −$60 (OMT App) and Cash $100: credit closed, $152 closed, next $101 owes $93", () => {
    const credit = seedLedgerRow(db, acc.appId, {
      entry_type: "SUPPLIER_PAYS_US",
      amount_usd: -60,
      created_at: "2026-10-01 00:10:00",
    });
    const anchor = settle({ USD: { direction: "PAY", payments: [cashUsd(100)] } });
    expect(ledgerState(credit).settlement_id).toBe(anchor);
    expect(fsState(usd[0]).settlement_id).toBe(anchor);
    const part = repo
      .getAccountUnsettled(acc.omtId)
      .find((r) => r.kind === "FINANCIAL_SERVICE" && r.id === usd[1])!;
    expect(part.remaining_usd).toBeCloseTo(93, 6);
    expect(queueOwed().usd).toBeCloseTo(337, 6);
    expectBalanceInvariant();
  });

  it("(d) the cash-out's deferred commission is recognised only by the settlement that closes its credit", () => {
    const cashout = seedCashout({
      supplierId: acc.appId,
      total: 60,
      commission: 1.5,
      rechargeId: 9001,
      created_at: "2026-10-01 00:10:00",
    });
    const profit0 = profitTotals(db);
    // Step 1 — only the cash-out and the newest $21 in scope: the credit is
    // netted by $21 and stays open owing −$39 (OMT still owes the shop).
    const sel = [
      { kind: "LEDGER" as const, id: cashout },
      { kind: "FINANCIAL_SERVICE" as const, id: usd[5] },
    ];
    const anchor1 = settle(
      { USD: { direction: "COLLECT", payments: [] } },
      { selections: sel },
    );
    expect(ledgerState(cashout).settlement_id).toBeNull();
    expect(settlementTxn(db, anchor1).profit_usd).toBe(0);
    expect(round2(profitTotals(db).usd - profit0.usd)).toBe(0);
    const open = repo
      .getAccountUnsettled(acc.omtId)
      .find((r) => r.kind === "LEDGER" && r.id === cashout)!;
    expect(open.remaining_usd).toBeCloseTo(-39, 6);
    expectBalanceInvariant();

    // Step 2 — the whole account: $476 − $39 = $437 closes the credit.
    const anchor2 = settle({ USD: { direction: "PAY", payments: [cashUsd(437)] } });
    expect(ledgerState(cashout).settlement_id).toBe(anchor2);
    expect(settlementTxn(db, anchor2).profit_usd).toBeCloseTo(1.5, 6);
    expect(round2(profitTotals(db).usd - profit0.usd)).toBe(1.5);
    expect(queueOwed()).toEqual({ usd: 0, lbp: 0 });
    expectBalanceInvariant();

    // Voiding the settlement that recognised it takes the 1.50 back and
    // leaves the credit part-netted again (rule 20).
    getTransactionRepository().voidTransaction(settlementTxn(db, anchor2).id, 1);
    expect(round2(profitTotals(db).usd - profit0.usd)).toBe(0);
    expect(ledgerState(cashout).settlement_id).toBeNull();
    expect(
      repo.getAccountUnsettled(acc.omtId).find((r) => r.kind === "LEDGER" && r.id === cashout)!
        .remaining_usd,
    ).toBeCloseTo(-39, 6);
    expectBalanceInvariant();
  });

  it("(e) a USD credit is never used against an LBP debt", () => {
    const credit = seedLedgerRow(db, acc.appId, {
      entry_type: "SUPPLIER_PAYS_US",
      amount_usd: -60,
      created_at: "2026-10-01 00:10:00",
    });
    const lbpRow = seedOmtSend(db, acc.omtId, {
      amount: 900000,
      currency: "LBP",
      created_at: "2026-10-01 00:30:00",
    });
    settle({ LBP: { direction: "PAY", payments: [cashLbp(900000)] } });
    expect(fsState(lbpRow).settlement_id).not.toBeNull();
    expect(coverageRows(db).filter((c) => c.row_kind === "LEDGER" && c.row_id === credit)).toEqual([]);
    expect(ledgerState(credit).settlement_id).toBeNull();
    expect(queueOwed()).toEqual({ usd: 437, lbp: 0 });
    expectBalanceInvariant();
  });

  // ── T034 — directions ────────────────────────────────────────────────────

  it("(f) USD net −$40 (credits exceed debts): COLLECT Cash $40 closes everything; drawer +40", () => {
    seedLedgerRow(db, acc.appId, {
      entry_type: "SUPPLIER_PAYS_US",
      amount_usd: -300,
      created_at: "2026-10-01 00:10:00",
    });
    seedLedgerRow(db, acc.appId, {
      entry_type: "SUPPLIER_PAYS_US",
      amount_usd: -237,
      created_at: "2026-10-01 00:20:00",
    });
    expect(queueOwed().usd).toBeCloseTo(-40, 6);
    const drawers0 = drawerTotals(db);
    settle({ USD: { direction: "COLLECT", payments: [cashUsd(40)] } });
    expect(queueOwed()).toEqual({ usd: 0, lbp: 0 });
    expect(round2(drawerTotals(db).usd - drawers0.usd)).toBe(40);
    expectBalanceInvariant();
  });

  it("(g) a direction that contradicts what is owed is refused and writes nothing", () => {
    const counts0 = writeCounts(db);
    expect(() =>
      settle({ USD: { direction: "COLLECT", payments: [cashUsd(497)] } }),
    ).toThrow(/You pay OMT in USD/);
    seedLedgerRow(db, acc.omtId, {
      entry_type: "SUPPLIER_PAYS_US",
      amount_lbp: -2_000_000,
      created_at: "2026-10-01 00:10:00",
    });
    const counts1 = writeCounts(db);
    expect(() =>
      settle({ LBP: { direction: "PAY", payments: [cashLbp(2_000_000)] } }),
    ).toThrow(/OMT pays you in LBP/);
    expect(writeCounts(db)).toEqual(counts1);
    expect(counts1.supplier_ledger - counts0.supplier_ledger).toBe(1);
  });

  function seedLbpCredit(): number {
    return seedLedgerRow(db, acc.omtId, {
      entry_type: "SUPPLIER_PAYS_US",
      amount_lbp: -2_000_000,
      created_at: "2026-10-01 00:10:00",
    });
  }

  it("(h) USD PAY $497 + LBP COLLECT 2,000,000 in ONE transaction; drawers −497 / +2,000,000; no ledger row mixes signs", () => {
    const lbpCredit = seedLbpCredit();
    const drawers0 = drawerTotals(db);
    const txCount0 = (
      db.prepare(`SELECT COUNT(*) AS n FROM transactions WHERE type = 'SUPPLIER_SETTLEMENT'`).get() as { n: number }
    ).n;
    const anchor = settle({
      USD: { direction: "PAY", payments: [cashUsd(497)] },
      LBP: { direction: "COLLECT", payments: [cashLbp(2_000_000)] },
    });
    const txCount1 = (
      db.prepare(`SELECT COUNT(*) AS n FROM transactions WHERE type = 'SUPPLIER_SETTLEMENT'`).get() as { n: number }
    ).n;
    expect(txCount1 - txCount0).toBe(1);
    const txn = settlementTxn(db, anchor);
    expect(txn.amount_usd).toBeCloseTo(497, 6);
    expect(txn.amount_lbp).toBe(2_000_000);
    const meta = JSON.parse(txn.metadata_json) as {
      per_currency: Record<string, { direction: string }>;
      counterparty: { flow: string };
    };
    expect(meta.per_currency.USD.direction).toBe("PAY");
    expect(meta.per_currency.LBP.direction).toBe("COLLECT");
    // Documented rule: counterparty.flow follows the USD section when both exist.
    expect(meta.counterparty.flow).toBe("OUT");

    const d = drawerTotals(db);
    expect(round2(d.usd - drawers0.usd)).toBe(-497);
    expect(Math.round(d.lbp - drawers0.lbp)).toBe(2_000_000);
    const payments = db
      .prepare(
        `SELECT currency_code, amount FROM payments WHERE transaction_id = ? ORDER BY id`,
      )
      .all(txn.id) as Array<{ currency_code: string; amount: number }>;
    expect(payments).toEqual([
      { currency_code: "USD", amount: -497 },
      { currency_code: "LBP", amount: 2_000_000 },
    ]);

    for (const r of ledgerRowsOf(txn.id)) {
      // never both currencies with opposite signs in one row
      expect(r.amount_usd * r.amount_lbp).toBeGreaterThanOrEqual(0);
    }
    expect(ledgerState(lbpCredit).settlement_id).toBe(anchor);
    expect(repo.getAccountUnsettled(acc.omtId)).toEqual([]);
    expectBalanceInvariant();
  });

  it("(i) single section: PAY $150 on $101 with change 4,361,000 LBP — extra +$49 / −4,361,000 LBP booked per currency; LBP drawer +4,361,000", () => {
    const drawers0 = drawerTotals(db);
    const bal0 = memberBalance(db, acc.omtId);
    settle(
      {
        USD: {
          direction: "PAY",
          payments: [cashUsd(150), changeLbp(4_361_000)],
        },
      },
      { selections: [{ kind: "FINANCIAL_SERVICE", id: usd[1] }] },
    );
    const d = drawerTotals(db);
    expect(round2(d.usd - drawers0.usd)).toBe(-150);
    // OMT hands the change BACK, so LBP comes INTO the drawer.
    expect(Math.round(d.lbp - drawers0.lbp)).toBe(4_361_000);
    const bal = memberBalance(db, acc.omtId);
    expect(round2(bal.usd - bal0.usd)).toBe(-150); // −101 applied, −49 overpay credit
    expect(Math.round(bal.lbp - bal0.lbp)).toBe(4_361_000); // the LBP OMT handed back
    expectBalanceInvariant();
  });

  it("(i2) two directions + cross-currency change: USD PAY $150 (change 4,361,000 LBP) and LBP COLLECT 2,000,000", () => {
    const lbpCredit = seedLbpCredit();
    const drawers0 = drawerTotals(db);
    const bal0 = memberBalance(db, acc.omtId);
    const sel = [
      { kind: "FINANCIAL_SERVICE" as const, id: usd[1] },
      { kind: "LEDGER" as const, id: lbpCredit },
    ];
    const anchor = settle(
      {
        USD: { direction: "PAY", payments: [cashUsd(150), changeLbp(4_361_000)] },
        LBP: { direction: "COLLECT", payments: [cashLbp(2_000_000)] },
      },
      { selections: sel },
    );
    const d = drawerTotals(db);
    expect(round2(d.usd - drawers0.usd)).toBe(-150);
    expect(Math.round(d.lbp - drawers0.lbp)).toBe(6_361_000);
    const bal = memberBalance(db, acc.omtId);
    expect(round2(bal.usd - bal0.usd)).toBe(-150);
    // +2,000,000 closes the LBP credit, +4,361,000 is the change OMT handed back.
    expect(Math.round(bal.lbp - bal0.lbp)).toBe(6_361_000);
    expect(fsState(usd[1]).settlement_id).toBe(anchor);
    expect(ledgerState(lbpCredit).settlement_id).toBe(anchor);
    const txn = settlementTxn(db, anchor);
    for (const r of ledgerRowsOf(txn.id)) {
      expect(r.amount_usd * r.amount_lbp).toBeGreaterThanOrEqual(0);
    }
    expectBalanceInvariant();

    // And its void nets to 0 in both currencies.
    const before = { drawers: drawers0, balances: { ...balances(), [acc.omtId]: bal0 }, profit: profitTotals(db) };
    getTransactionRepository().voidTransaction(txn.id, 1);
    expectNetZero(before);
    expectBalanceInvariant();
  });

  it("(j) void of (h) nets to 0 in both currencies (drawers, every member, profit, coverage)", () => {
    seedLbpCredit();
    const before = snapshot();
    const owed0 = queueOwed();
    const anchor = settle({
      USD: { direction: "PAY", payments: [cashUsd(497)] },
      LBP: { direction: "COLLECT", payments: [cashLbp(2_000_000)] },
    });
    const txn = settlementTxn(db, anchor);
    getTransactionRepository().voidTransaction(txn.id, 1);
    expectNetZero(before);
    expect(coverageRows(db).every((c) => c.is_reversed === 1)).toBe(true);
    expect(queueOwed()).toEqual(owed0);
    expectBalanceInvariant();
  });

  it("(j2) refund of (h) also nets to 0 in both currencies", () => {
    seedLbpCredit();
    const before = snapshot();
    const anchor = settle({
      USD: { direction: "PAY", payments: [cashUsd(497)] },
      LBP: { direction: "COLLECT", payments: [cashLbp(2_000_000)] },
    });
    getTransactionRepository().refundTransaction(settlementTxn(db, anchor).id, 1);
    expectNetZero(before);
    expectBalanceInvariant();
  });

  it("a waive in two sections that point opposite ways is refused and writes nothing", () => {
    seedLbpCredit();
    const counts0 = writeCounts(db);
    expect(() =>
      settle({
        USD: { direction: "PAY", payments: [cashUsd(495)], waive: 2 },
        LBP: { direction: "COLLECT", payments: [cashLbp(1_999_000)], waive: 1000 },
      }),
    ).toThrow(
      /^A waive can't be used when you pay OMT in one currency and collect from OMT in the other/,
    );
    expect(writeCounts(db)).toEqual(counts0);
  });

  // ── Commission in an LBP section (untested before) ──────────────────────

  it("LBP section commission: PAY 900,000 + commission 10,000 closes the LBP send; allocation + profit in LBP; −10,000 LBP open credit; void nets 0", () => {
    const lbpRow = seedOmtSend(db, acc.omtId, {
      amount: 900000,
      currency: "LBP",
      created_at: "2026-10-01 00:30:00",
    });
    const before = snapshot();
    const anchor = settle({
      LBP: { direction: "PAY", payments: [cashLbp(900_000)], commission: 10_000 },
    });
    expect(fsState(lbpRow).settlement_id).toBe(anchor);
    const alloc = db
      .prepare(
        `SELECT financial_service_id AS id, commission_usd, commission_lbp FROM settlement_commission_allocations`,
      )
      .all() as Array<{ id: number; commission_usd: number; commission_lbp: number }>;
    expect(alloc).toEqual([{ id: lbpRow, commission_usd: 0, commission_lbp: 10_000 }]);
    const txn = settlementTxn(db, anchor);
    expect(txn.profit_lbp).toBe(10_000);
    expect(txn.profit_usd).toBe(0);
    expect(Math.round(drawerTotals(db).lbp - before.drawers.lbp)).toBe(-900_000);
    // Owner 2026-10-15 — the commission is credited to the account.
    expect(queueOwed()).toEqual({ usd: 497, lbp: -10_000 });
    expectBalanceInvariant();

    getTransactionRepository().voidTransaction(txn.id, 1);
    expectNetZero(before);
    expect(
      (db.prepare(`SELECT COUNT(*) AS n FROM settlement_commission_allocations`).get() as { n: number }).n,
    ).toBe(0);
    expect(queueOwed()).toEqual({ usd: 497, lbp: 900000 });
    expectBalanceInvariant();
  });

  // ── T043 — an earlier manual Pay / Receive payment nets, never twice ────

  it("(k) a manual PAY $100 on the OMT counter is an open credit that nets at the next settlement, never counted twice", () => {
    const drawers0 = drawerTotals(db);
    const bal0 = memberBalance(db, acc.omtId);
    const cashflowLedgerId = repo.recordSupplierCashflow({
      supplier_id: acc.omtId,
      direction: "PAY",
      payments: [cashUsd(100)],
      created_by: 1,
    }).id;
    expect(queueOwed().usd).toBeCloseTo(397, 6);
    expectBalanceInvariant();

    const anchor = settle({ USD: { direction: "PAY", payments: [cashUsd(397)] } });
    const cov = coverageRows(db).filter(
      (c) => c.row_kind === "LEDGER" && c.row_id === cashflowLedgerId,
    );
    expect(cov).toHaveLength(1);
    expect(cov[0]).toEqual(expect.objectContaining({ source: "NETTING", closes_row: 1 }));
    expect(cov[0].amount).toBeCloseTo(100, 6);
    expect(ledgerState(cashflowLedgerId).settlement_id).toBe(anchor);
    // $100 + $397 = $497 paid once in total, never $597.
    expect(round2(drawerTotals(db).usd - drawers0.usd)).toBe(-497);
    expect(round2(memberBalance(db, acc.omtId).usd - bal0.usd)).toBe(-497);
    expect(queueOwed()).toEqual({ usd: 0, lbp: 0 });
    expectBalanceInvariant();

    // LIRA-343 (FR-019, R12) — rewritten from the LIRA-322 refusal: the
    // netted payment CAN be voided. Its $100 comes back to the drawer, the
    // settlement stays as it is, and the $100 it had used to pay transfers
    // is now owed to OMT on the account (one open ACCOUNT row).
    const cashflowTxn = db
      .prepare(
        `SELECT id FROM transactions WHERE source_table = 'supplier_ledger' AND source_id = ? AND type = 'SUPPLIER_PAYMENT'`,
      )
      .get(cashflowLedgerId) as { id: number };
    const coverage0 = coverageRows(db);
    getTransactionRepository().voidTransaction(cashflowTxn.id, 1);
    expect(coverageRows(db)).toEqual(coverage0);
    expect(round2(drawerTotals(db).usd - drawers0.usd)).toBe(-397);
    expect(queueOwed()).toEqual({ usd: 100, lbp: 0 });
    const open = repo
      .getAccountUnsettled(acc.omtId)
      .filter((r) => r.kind === "LEDGER" && r.remaining_usd !== 0);
    expect(open.map((r) => [r.row_scope, round2(r.remaining_usd)])).toEqual([["ACCOUNT", 100]]);
    expectBalanceInvariant();
  });
});
