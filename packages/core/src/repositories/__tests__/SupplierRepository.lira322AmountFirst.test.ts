/**
 * LIRA-322 — settle the OMT account by amount, one currency at a time
 * (tasks T015 (a)–(g), T022 (h)–(o); contracts/settle-account.md).
 *
 * The test shop's account: six USD transfers $152/$101/$101/$101/$21/$21
 * (oldest first, $497 owed) and one 900,000 LBP send, all on the OMT
 * counter, commission model 1 (gross owed).
 *
 * Every case snapshots drawers / member balances / the queue before the
 * action and asserts DELTAS (rule 15), and checks the balance invariant
 * (data-model.md invariant 1): per member and currency, the ledger sum
 * equals Σ remaining over that member's open queue rows.
 *
 * Rule 17: run against the repository with no amount-first path first.
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
import { SupplierService } from "../../services/SupplierService";
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

describe("LIRA-322 — amount-first account settlement (SupplierRepository)", () => {
  let db: Database.Database;
  let repo: SupplierRepository;
  let acc: OmtAccount;
  let usd: number[];
  let lbpRow: number;

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
    lbpRow = seedOmtSend(db, acc.omtId, {
      amount: 900000,
      currency: "LBP",
      created_at: "2026-10-01 00:30:00",
    });
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

  function queueOwed(): CurrencyPair {
    const q = repo.getAccountUnsettled(acc.omtId);
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
      expected_owed: queueOwed(),
      created_by: 1,
      ...extra,
    }).id;
  }

  /** data-model.md invariant 1, for every member and the account total. */
  function expectBalanceInvariant(): void {
    const q = repo.getAccountUnsettled(acc.omtId);
    for (const member of [acc.omtId, acc.appId, acc.ipickId]) {
      const bal = memberBalance(db, member);
      const rows = q.filter((r) => r.supplier_id === member);
      expect(bal.usd).toBeCloseTo(
        rows.reduce((s, r) => s + r.remaining_usd, 0),
        6,
      );
      expect(bal.lbp).toBeCloseTo(
        rows.reduce((s, r) => s + r.remaining_lbp, 0),
        6,
      );
    }
  }

  function fsState(id: number): {
    settlement_id: number | null;
    is_settled: number;
  } {
    return db
      .prepare(
        `SELECT settlement_id, is_settled FROM financial_services WHERE id = ?`,
      )
      .get(id) as { settlement_id: number | null; is_settled: number };
  }

  function queueRow(id: number) {
    return repo
      .getAccountUnsettled(acc.omtId)
      .find((r) => r.kind === "FINANCIAL_SERVICE" && r.id === id);
  }

  // ── T015 — US1: pay OMT in one currency only ─────────────────────────────

  it("(a) USD Cash $497 closes the six USD rows; LBP untouched; drawer −497", () => {
    expectBalanceInvariant();
    const drawers0 = drawerTotals(db);
    const bal0 = memberBalance(db, acc.omtId);

    const anchor = settle({ USD: { direction: "PAY", payments: [cashUsd(497)] } });

    for (const id of usd) {
      expect(fsState(id)).toEqual({ settlement_id: anchor, is_settled: 1 });
    }
    expect(fsState(lbpRow).settlement_id).toBeNull();
    const bal1 = memberBalance(db, acc.omtId);
    expect(bal1.usd - bal0.usd).toBeCloseTo(-497, 6);
    expect(bal1.lbp - bal0.lbp).toBe(0);
    const drawers1 = drawerTotals(db);
    expect(drawers1.usd - drawers0.usd).toBeCloseTo(-497, 6);
    expect(drawers1.lbp - drawers0.lbp).toBe(0);
    expect(queueOwed()).toEqual({ usd: 0, lbp: 900000 });
    expectBalanceInvariant();
  });

  it("(b) LBP Cash 900,000 closes the LBP row only", () => {
    const anchor = settle({
      LBP: { direction: "PAY", payments: [cashLbp(900000)] },
    });
    expect(fsState(lbpRow).settlement_id).toBe(anchor);
    for (const id of usd) expect(fsState(id).settlement_id).toBeNull();
    expect(queueOwed()).toEqual({ usd: 497, lbp: 0 });
    expectBalanceInvariant();
  });

  it("(c) both sections in one call close everything", () => {
    const drawers0 = drawerTotals(db);
    settle({
      USD: { direction: "PAY", payments: [cashUsd(497)] },
      LBP: { direction: "PAY", payments: [cashLbp(900000)] },
    });
    expect(repo.getAccountUnsettled(acc.omtId)).toEqual([]);
    const drawers1 = drawerTotals(db);
    expect(drawers1.usd - drawers0.usd).toBeCloseTo(-497, 6);
    expect(drawers1.lbp - drawers0.lbp).toBe(-900000);
    expectBalanceInvariant();
  });

  it("(d) USD $507.11 closes the six rows; $10.11 goes on the account; LBP still owed", () => {
    const drawers0 = drawerTotals(db);
    settle({ USD: { direction: "PAY", payments: [cashUsd(507.11)] } });
    const q = repo.getAccountUnsettled(acc.omtId);
    const credit = q.filter((r) => r.kind === "LEDGER");
    expect(credit).toHaveLength(1);
    expect(credit[0].supplier_id).toBe(acc.omtId);
    expect(credit[0].amount_usd).toBeCloseTo(-10.11, 6);
    expect(credit[0].amount_lbp).toBe(0);
    expect(q.filter((r) => r.kind === "FINANCIAL_SERVICE").map((r) => r.id)).toEqual([
      lbpRow,
    ]);
    expect(queueOwed().lbp).toBe(900000);
    expect(drawerTotals(db).usd - drawers0.usd).toBeCloseTo(-507.11, 6);
    // amount_* keeps the legacy meaning: money applied to rows, extra excluded.
    const txn = db
      .prepare(`SELECT amount_usd FROM transactions WHERE type = 'SUPPLIER_SETTLEMENT' AND reverses_id IS NULL ORDER BY id DESC LIMIT 1`)
      .get() as { amount_usd: number };
    expect(txn.amount_usd).toBeCloseTo(497, 6);
    expectBalanceInvariant();
  });

  it("(e) a stale expected_owed is refused and writes nothing", () => {
    const counts0 = writeCounts(db);
    expect(() =>
      repo.settleAccount({
        account_supplier_id: acc.omtId,
        per_currency: { USD: { direction: "PAY", payments: [cashUsd(497)] } },
        expected_owed: { usd: 498, lbp: 900000 },
        created_by: 1,
      }),
    ).toThrow(/OMT's balance changed since you opened this sheet/);
    expect(writeCounts(db)).toEqual(counts0);
  });

  it("(e2) the amount-first path refuses a missing expected_owed", () => {
    expect(() =>
      repo.settleAccount({
        account_supplier_id: acc.omtId,
        per_currency: { USD: { direction: "PAY", payments: [cashUsd(497)] } },
        created_by: 1,
      }),
    ).toThrow(/expected_owed/);
  });

  it("(f) writes ONE SUPPLIER_SETTLEMENT transaction with metadata_json.per_currency", () => {
    const before = (
      db
        .prepare(`SELECT COUNT(*) AS n FROM transactions WHERE type = 'SUPPLIER_SETTLEMENT'`)
        .get() as { n: number }
    ).n;
    const anchor = settle({ USD: { direction: "PAY", payments: [cashUsd(497)] } });
    const after = (
      db
        .prepare(`SELECT COUNT(*) AS n FROM transactions WHERE type = 'SUPPLIER_SETTLEMENT'`)
        .get() as { n: number }
    ).n;
    expect(after - before).toBe(1);
    const txn = settlementTxn(db, anchor);
    expect(txn.amount_usd).toBeCloseTo(497, 6);
    expect(txn.amount_lbp).toBe(0);
    const meta = JSON.parse(txn.metadata_json) as {
      per_currency: Record<string, unknown>;
    };
    expect(meta.per_currency).toEqual({
      USD: { direction: "PAY", paid: 497, commission: 0, waive: 0, extra: 0 },
    });
  });

  it("(g) one PAYMENT coverage row per closed row, closes_row = 1", () => {
    const anchor = settle({ USD: { direction: "PAY", payments: [cashUsd(497)] } });
    const txn = settlementTxn(db, anchor);
    const cov = coverageRows(db);
    expect(cov).toHaveLength(6);
    for (const [i, id] of usd.entries()) {
      const c = cov.find((r) => r.row_kind === "FINANCIAL_SERVICE" && r.row_id === id);
      expect(c).toEqual(
        expect.objectContaining({
          transaction_id: txn.id,
          anchor_ledger_id: anchor,
          member_supplier_id: acc.omtId,
          currency: "USD",
          source: "PAYMENT",
          closes_row: 1,
          is_reversed: 0,
        }),
      );
      expect(c!.amount).toBeCloseTo(USD_ROWS[i], 6);
    }
  });

  // ── T022 — US2: partial payment; the system picks what closes ───────────

  it("(h) Cash $300: two close, the next $101 is part-paid $47 (no stamp), $197 owed", () => {
    const bal0 = memberBalance(db, acc.omtId);
    const anchor = settle({ USD: { direction: "PAY", payments: [cashUsd(300)] } });
    expect(fsState(usd[0]).settlement_id).toBe(anchor);
    expect(fsState(usd[1]).settlement_id).toBe(anchor);
    expect(fsState(usd[2])).toEqual({ settlement_id: null, is_settled: 0 });
    const cov = coverageRows(db).filter((r) => r.row_id === usd[2]);
    expect(cov).toHaveLength(1);
    expect(cov[0].amount).toBeCloseTo(47, 6);
    expect(cov[0].closes_row).toBe(0);
    const part = queueRow(usd[2])!;
    expect(part.covered_usd).toBeCloseTo(47, 6);
    expect(part.remaining_usd).toBeCloseTo(54, 6);
    expect(memberBalance(db, acc.omtId).usd - bal0.usd).toBeCloseTo(-300, 6);
    expect(queueOwed().usd).toBeCloseTo(197, 6);
    expectBalanceInvariant();
  });

  it("(i) then Cash $197 closes the rest; the part-paid row has 47 + 54, only the second closes it", () => {
    settle({ USD: { direction: "PAY", payments: [cashUsd(300)] } });
    const anchor2 = settle({ USD: { direction: "PAY", payments: [cashUsd(197)] } });
    for (const id of usd.slice(2)) expect(fsState(id).settlement_id).toBe(anchor2);
    const cov = coverageRows(db).filter((r) => r.row_id === usd[2]);
    expect(cov.map((c) => [Math.round(c.amount * 100) / 100, c.closes_row])).toEqual([
      [47, 0],
      [54, 1],
    ]);
    expect(queueOwed()).toEqual({ usd: 0, lbp: 900000 });
    expectBalanceInvariant();
  });

  it("(j) Cash $0.50 part-pays the oldest $152 row", () => {
    settle({ USD: { direction: "PAY", payments: [cashUsd(0.5)] } });
    const r = queueRow(usd[0])!;
    expect(r.covered_usd).toBeCloseTo(0.5, 6);
    expect(r.remaining_usd).toBeCloseTo(151.5, 6);
    expectBalanceInvariant();
  });

  it("(k) Cash $496.30 + commission 0.70 closes all six; allocations sum 0.70; profit 0.70", () => {
    const profit0 = profitTotals(db);
    const anchor = settle({
      USD: { direction: "PAY", payments: [cashUsd(496.3)], commission: 0.7 },
    });
    for (const id of usd) expect(fsState(id).settlement_id).toBe(anchor);
    const alloc = db
      .prepare(
        `SELECT financial_service_id AS id, commission_usd FROM settlement_commission_allocations`,
      )
      .all() as Array<{ id: number; commission_usd: number }>;
    expect(alloc.map((a) => a.id).sort((x, y) => x - y)).toEqual([...usd].sort((x, y) => x - y));
    expect(alloc.reduce((s, a) => s + a.commission_usd, 0)).toBeCloseTo(0.7, 6);
    expect(settlementTxn(db, anchor).profit_usd).toBeCloseTo(0.7, 6);
    expect(profitTotals(db).usd - profit0.usd).toBeCloseTo(0.7, 6);
    // The commission credit is stamped with the anchor and is never an open credit (F3).
    const credit = db
      .prepare(
        `SELECT settlement_id, amount_usd FROM supplier_ledger
          WHERE entry_type = 'SUPPLIER_PAYS_US' AND source_ref_table = 'supplier_ledger'`,
      )
      .all() as Array<{ settlement_id: number | null; amount_usd: number }>;
    expect(credit).toHaveLength(1);
    expect(credit[0].settlement_id).toBe(anchor);
    expect(credit[0].amount_usd).toBeCloseTo(-0.7, 6);
    expect(queueOwed().usd).toBe(0);
    expectBalanceInvariant();
  });

  it("(l) Cash $496.30 with no commission leaves the newest $21 part-paid 20.30 / 0.70 owed", () => {
    settle({ USD: { direction: "PAY", payments: [cashUsd(496.3)] } });
    const r = queueRow(usd[5])!;
    expect(r.covered_usd).toBeCloseTo(20.3, 6);
    expect(r.remaining_usd).toBeCloseTo(0.7, 6);
    expect(fsState(usd[4]).settlement_id).not.toBeNull();
    expectBalanceInvariant();
  });

  it("(m) Cash $200 + commission 0.70: the $152 row closes with all the commission; the $101 is part-paid 48.70", () => {
    settle({
      USD: { direction: "PAY", payments: [cashUsd(200)], commission: 0.7 },
    });
    expect(fsState(usd[0]).settlement_id).not.toBeNull();
    expect(queueRow(usd[1])!.covered_usd).toBeCloseTo(48.7, 6);
    const alloc = db
      .prepare(
        `SELECT financial_service_id AS id, commission_usd FROM settlement_commission_allocations`,
      )
      .all() as Array<{ id: number; commission_usd: number }>;
    expect(alloc).toEqual([{ id: usd[0], commission_usd: 0.7 }]);
    expectBalanceInvariant();
  });

  it("(m2) Cash $100 + commission 0.70 (no row closes) is refused and writes nothing", () => {
    const counts0 = writeCounts(db);
    expect(() =>
      settle({
        USD: { direction: "PAY", payments: [cashUsd(100)], commission: 0.7 },
      }),
    ).toThrow(/commission/i);
    expect(writeCounts(db)).toEqual(counts0);
  });

  it("(o) Cash $495 + waive $2 closes all six (WAIVE coverage, hidden DISCOUNT); the void nets to 0", () => {
    const drawers0 = drawerTotals(db);
    const bal0 = memberBalance(db, acc.omtId);
    const profit0 = profitTotals(db);
    const anchor = settle({
      USD: { direction: "PAY", payments: [cashUsd(495)], waive: 2 },
    });
    for (const id of usd) expect(fsState(id).settlement_id).toBe(anchor);
    const waived = coverageRows(db).filter((c) => c.source === "WAIVE");
    expect(waived.reduce((s, c) => s + c.amount, 0)).toBeCloseTo(2, 6);
    const q = repo.getAccountUnsettled(acc.omtId);
    expect(q.filter((r) => r.kind === "LEDGER")).toEqual([]);
    expectBalanceInvariant();

    getTransactionRepository().voidTransaction(settlementTxn(db, anchor).id, 1);
    const drawers1 = drawerTotals(db);
    expect(drawers1.usd - drawers0.usd).toBeCloseTo(0, 6);
    expect(drawers1.lbp - drawers0.lbp).toBe(0);
    const bal1 = memberBalance(db, acc.omtId);
    expect(bal1.usd - bal0.usd).toBeCloseTo(0, 6);
    expect(bal1.lbp - bal0.lbp).toBe(0);
    const profit1 = profitTotals(db);
    expect(profit1.usd - profit0.usd).toBeCloseTo(0, 6);
    expect(profit1.lbp - profit0.lbp).toBeCloseTo(0, 6);
    expect(coverageRows(db).every((c) => c.is_reversed === 1)).toBe(true);
    expect(queueOwed()).toEqual({ usd: 497, lbp: 900000 });
    expectBalanceInvariant();
  });

  it("(o2) a waive that leaves a part-paid row carrying WAIVE coverage is refused", () => {
    const counts0 = writeCounts(db);
    expect(() =>
      settle({ USD: { direction: "PAY", payments: [cashUsd(100)], waive: 2 } }),
    ).toThrow("A waive must settle the transfers it covers in full.");
    expect(writeCounts(db)).toEqual(counts0);
  });

  it("(e3) through the service, a refusal reaches the operator verbatim (T019)", () => {
    const res = new SupplierService().settleAccount({
      account_supplier_id: acc.omtId,
      per_currency: { USD: { direction: "PAY", payments: [cashUsd(497)] } },
      expected_owed: { usd: 1, lbp: 900000 },
      created_by: 1,
    });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/^OMT's balance changed since you opened this sheet/);
    const ok = new SupplierService().settleAccount({
      account_supplier_id: acc.omtId,
      per_currency: { USD: { direction: "PAY", payments: [cashUsd(497)] } },
      expected_owed: queueOwed(),
      created_by: 1,
    });
    expect(ok).toEqual({ success: true, id: expect.any(Number) });
  });

  // ── Same-member netting / one-direction COLLECT (fall out of the
  //    per-member, per-currency design; Phase 6 owns the full US3 suite) ──

  it("same-member netting: a −$60 credit on the counter + Cash $437 closes everything, no money row for the netted part", () => {
    const credit = seedLedgerRow(db, acc.omtId, {
      entry_type: "SUPPLIER_PAYS_US",
      amount_usd: -60,
      created_at: "2026-10-01 00:10:00",
    });
    const drawers0 = drawerTotals(db);
    const bal0 = memberBalance(db, acc.omtId);
    settle({ USD: { direction: "PAY", payments: [cashUsd(437)] } });
    const cov = coverageRows(db).filter((c) => c.source === "NETTING");
    expect(cov.reduce((s, c) => s + c.amount, 0)).toBeCloseTo(120, 6);
    expect(cov.find((c) => c.row_kind === "LEDGER" && c.row_id === credit)!.amount).toBeCloseTo(60, 6);
    expect(queueOwed()).toEqual({ usd: 0, lbp: 900000 });
    expect(drawerTotals(db).usd - drawers0.usd).toBeCloseTo(-437, 6);
    expect(memberBalance(db, acc.omtId).usd - bal0.usd).toBeCloseTo(-437, 6);
    expectBalanceInvariant();
  });

  it("one-direction COLLECT: OMT owes the shop $40 net in USD; receiving $40 closes it; drawer +40", () => {
    // Settle the six debts first, then two credits remain.
    settle({ USD: { direction: "PAY", payments: [cashUsd(497)] } });
    seedLedgerRow(db, acc.omtId, { entry_type: "SUPPLIER_PAYS_US", amount_usd: -25, created_at: "2026-10-02 01:00:00" });
    seedLedgerRow(db, acc.omtId, { entry_type: "SUPPLIER_PAYS_US", amount_usd: -15, created_at: "2026-10-02 02:00:00" });
    const drawers0 = drawerTotals(db);
    settle({ USD: { direction: "COLLECT", payments: [cashUsd(40)] } });
    expect(queueOwed()).toEqual({ usd: 0, lbp: 900000 });
    expect(drawerTotals(db).usd - drawers0.usd).toBeCloseTo(40, 6);
    expectBalanceInvariant();
  });

  it("cross-member netting (credit on OMT App, debt on the counter) is accepted and keeps each line equal to its own rows (was refused in Phase 3)", () => {
    seedLedgerRow(db, acc.appId, {
      entry_type: "SUPPLIER_PAYS_US",
      amount_usd: -60,
      created_at: "2026-10-01 00:10:00",
    });
    settle({ USD: { direction: "PAY", payments: [cashUsd(437)] } });
    expect(queueOwed()).toEqual({ usd: 0, lbp: 900000 });
    expectBalanceInvariant();
  });

  // ── Phase 6 lifted the Phase-3 refusal of mixed directions ──────────────

  it("accepts sections with different directions in one settlement (was refused in Phase 3)", () => {
    seedLedgerRow(db, acc.omtId, {
      entry_type: "SUPPLIER_PAYS_US",
      amount_lbp: -2_000_000,
      created_at: "2026-10-01 00:10:00",
    });
    const drawers0 = drawerTotals(db);
    settle({
      USD: { direction: "PAY", payments: [cashUsd(497)] },
      LBP: { direction: "COLLECT", payments: [cashLbp(1_100_000)] },
    });
    expect(queueOwed()).toEqual({ usd: 0, lbp: 0 });
    const d = drawerTotals(db);
    expect(d.usd - drawers0.usd).toBeCloseTo(-497, 6);
    expect(d.lbp - drawers0.lbp).toBe(1_100_000);
    expectBalanceInvariant();
  });

  it("refuses a direction that contradicts what is owed in that currency", () => {
    expect(() =>
      settle({ USD: { direction: "COLLECT", payments: [cashUsd(497)] } }),
    ).toThrow(/You pay OMT in USD/);
  });

  // ── T046 — US5: selections restrict the scope ───────────────────────────

  it("(T046 o) selections = the two $21 rows, Cash $30: the older closes, the other is part-paid $9, the rest untouched", () => {
    const sel = [
      { kind: "FINANCIAL_SERVICE" as const, id: usd[4] },
      { kind: "FINANCIAL_SERVICE" as const, id: usd[5] },
    ];
    const anchor = repo.settleAccount({
      account_supplier_id: acc.omtId,
      selections: sel,
      per_currency: { USD: { direction: "PAY", payments: [cashUsd(30)] } },
      // the sheet previews the SCOPED rows only
      expected_owed: { usd: 42, lbp: 0 },
      created_by: 1,
    }).id;
    expect(fsState(usd[4]).settlement_id).toBe(anchor);
    const part = queueRow(usd[5])!;
    expect(part.covered_usd).toBeCloseTo(9, 6);
    expect(part.remaining_usd).toBeCloseTo(12, 6);
    const touched = new Set(coverageRows(db).map((c) => c.row_id));
    for (const id of [...usd.slice(0, 4), lbpRow]) {
      expect(touched.has(id)).toBe(false);
      expect(fsState(id).settlement_id).toBeNull();
    }
    expect(queueOwed()).toEqual({ usd: 467, lbp: 900000 });
    expectBalanceInvariant();
  });

  it("(T046 p) a selection of a type the statement does not cover is refused and writes nothing", () => {
    const wu = seedOmtSend(db, acc.omtId, {
      amount: 50,
      type: "WESTERN_UNION",
      created_at: "2026-10-01 07:00:00",
    });
    const counts0 = writeCounts(db);
    expect(() =>
      repo.settleAccount({
        account_supplier_id: acc.omtId,
        selections: [
          { kind: "FINANCIAL_SERVICE", id: usd[0] },
          { kind: "FINANCIAL_SERVICE", id: wu },
        ],
        covered_omt_service_types: ["INTRA"],
        per_currency: { USD: { direction: "PAY", payments: [cashUsd(202)] } },
        expected_owed: { usd: 202, lbp: 0 },
        created_by: 1,
      }),
    ).toThrow(`Cannot settle transfer #${wu}: its commission type Western Union is not included in this statement`);
    expect(writeCounts(db)).toEqual(counts0);
  });

  it("(T046 q) a selected id that is not an open row of this account is refused and writes nothing", () => {
    const counts0 = writeCounts(db);
    expect(() =>
      repo.settleAccount({
        account_supplier_id: acc.omtId,
        selections: [{ kind: "FINANCIAL_SERVICE", id: 999999 }],
        per_currency: { USD: { direction: "PAY", payments: [cashUsd(10)] } },
        expected_owed: { usd: 0, lbp: 0 },
        created_by: 1,
      }),
    ).toThrow(/A ticked transfer is no longer open on this account/);
    expect(writeCounts(db)).toEqual(counts0);
  });
});
