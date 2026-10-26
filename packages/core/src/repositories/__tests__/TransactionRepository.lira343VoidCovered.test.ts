/**
 * LIRA-343 T038 (US6, FR-019 / FR-020, research R12) — voiding or refunding
 * an OMT transfer that a settlement covered is allowed.
 *
 * The settlement stays exactly as it was. What it applied to the transfer
 * becomes ONE open OMT credit row on the account (per member and currency),
 * owned by the void/refund transaction. The account balance already moved
 * by the transfer's own reversal, so that credit row is paired with a
 * hidden, self-stamped carry row of the opposite sign (balance-neutral).
 *
 * After every step, per member and currency: ledger balance == Σ open
 * remaining (DAY + ACCOUNT rows).
 *
 * Rule 17: written and run before the change; the refusals it met are
 * recorded in the report of this change.
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
import { TRANSACTION_TYPES } from "../../constants/transactionTypes";
import {
  buildDb,
  coverageRows,
  drawerTotals,
  fundDrawer,
  memberBalance,
  omtAccount,
  resetAll,
  settlementTxn,
  type CurrencyPair,
  type OmtAccount,
} from "../testHelpers/omtAccountDb";
import { seedOmtSendWithTxns } from "../testHelpers/omtTransferTxns";

type Selection = NonNullable<SettleAccountRequest["selections"]>[number];

describe("LIRA-343 — void / refund of a covered OMT transfer (US6)", () => {
  let db: Database.Database;
  let repo: SupplierRepository;
  let acc: OmtAccount;

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
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  const r2 = (v: number) => Math.round(v * 100) / 100 + 0;
  const fs = (id: number): Selection => ({ kind: "FINANCIAL_SERVICE", id });

  function owedOf(selections: Selection[]): CurrencyPair {
    const keys = new Set(selections.map((s) => `${s.kind}:${s.id}`));
    const q = repo
      .getAccountUnsettled(acc.omtId)
      .filter((r) => keys.has(`${r.kind}:${r.id}`));
    return {
      usd: r2(q.reduce((s, r) => s + r.remaining_usd, 0)),
      lbp: q.reduce((s, r) => s + r.remaining_lbp, 0),
    };
  }

  function settle(
    selections: Selection[],
    currency: "USD" | "LBP",
    amount: number,
  ): number {
    const anchor = repo.settleAccount({
      account_supplier_id: acc.omtId,
      per_currency: {
        [currency]: {
          direction: "PAY",
          payments: [{ method: "CASH", currency_code: currency, amount }],
        },
      },
      expected_owed: owedOf(selections),
      selections,
      created_by: 1,
    }).id;
    return settlementTxn(db, anchor).id;
  }

  function expectBalanceEqualsOpen(): void {
    const q = repo.getAccountUnsettled(acc.omtId);
    for (const m of [acc.omtId, acc.appId, acc.ipickId]) {
      const bal = memberBalance(db, m);
      const rows = q.filter((r) => r.supplier_id === m);
      expect({ m, usd: r2(bal.usd) }).toEqual({
        m,
        usd: r2(rows.reduce((s, r) => s + r.remaining_usd, 0)),
      });
      expect({ m, lbp: Math.round(bal.lbp) + 0 }).toEqual({
        m,
        lbp: Math.round(rows.reduce((s, r) => s + r.remaining_lbp, 0)) + 0,
      });
    }
  }

  function settlementState(txnId: number) {
    return {
      status: (
        db.prepare(`SELECT status FROM transactions WHERE id = ?`).get(txnId) as {
          status: string;
        }
      ).status,
      coverage: coverageRows(db).filter((c) => c.transaction_id === txnId),
      ledger: db
        .prepare(
          `SELECT id, amount_usd, amount_lbp, is_refunded, settlement_id
             FROM supplier_ledger WHERE transaction_id = ? ORDER BY id`,
        )
        .all(txnId),
      payments: db
        .prepare(`SELECT amount, currency_code FROM payments WHERE transaction_id = ? ORDER BY id`)
        .all(txnId),
    };
  }

  function reversalOf(txnId: number): number {
    return (
      db
        .prepare(`SELECT id FROM transactions WHERE reverses_id = ? ORDER BY id DESC LIMIT 1`)
        .get(txnId) as { id: number }
    ).id;
  }

  function openRowsOf(reversalId: number) {
    return repo
      .getAccountUnsettled(acc.omtId)
      .filter((r) => r.kind === "LEDGER" && r.transaction_id === reversalId);
  }

  const reverse = {
    void: (id: number) => getTransactionRepository().voidTransaction(id, 1),
    refund: (id: number) => getTransactionRepository().refundTransaction(id, 1),
  } as const;

  for (const how of ["void", "refund"] as const) {
    it(`${how} of a FULLY covered transfer: allowed, settlement unchanged, $35 OMT credit on the account`, () => {
      const t = seedOmtSendWithTxns(db, acc.omtId, {
        amount: 35,
        created_at: "2026-10-18 09:00:00",
      });
      const s = settle([fs(t.fsId)], "USD", 35);
      const sBefore = settlementState(s);
      const drawers0 = drawerTotals(db);

      reverse[how](t.txnId);

      expect(settlementState(s)).toEqual(sBefore);
      // The transfer and its auto sibling are gone from the account.
      const fsRow = db
        .prepare(`SELECT is_refunded FROM financial_services WHERE id = ?`)
        .get(t.fsId) as { is_refunded: number };
      expect(fsRow.is_refunded).toBe(1);
      const sib = db
        .prepare(`SELECT is_refunded FROM supplier_ledger WHERE id = ?`)
        .get(t.siblingLedgerId) as { is_refunded: number };
      expect(sib.is_refunded).toBe(1);
      // ONE open account credit of what the settlement applied.
      const open = openRowsOf(reversalOf(t.txnId));
      expect(open).toHaveLength(1);
      expect(open[0]).toMatchObject({
        row_scope: "ACCOUNT",
        supplier_id: acc.omtId,
        amount_usd: -35,
        remaining_usd: -35,
        entry_type: "PAYMENT",
      });
      // The seeded transfer moved no drawer, so neither does its reversal.
      expect(drawerTotals(db)).toEqual(drawers0);
      expectBalanceEqualsOpen();
    });

    it(`${how} of a PART-covered transfer: allowed, the $30 paid becomes OMT credit`, () => {
      const t = seedOmtSendWithTxns(db, acc.omtId, {
        amount: 100,
        created_at: "2026-10-18 09:00:00",
      });
      const s = settle([fs(t.fsId)], "USD", 30);
      const sBefore = settlementState(s);

      reverse[how](t.txnId);

      expect(settlementState(s)).toEqual(sBefore);
      const open = openRowsOf(reversalOf(t.txnId));
      expect(open.map((r) => [r.row_scope, r2(r.remaining_usd)])).toEqual([
        ["ACCOUNT", -30],
      ]);
      // Nothing else is open on the account.
      expect(repo.getAccountUnsettled(acc.omtId)).toHaveLength(1);
      expectBalanceEqualsOpen();
    });
  }

  it("LBP: the credit is booked in LBP only", () => {
    const t = seedOmtSendWithTxns(db, acc.omtId, {
      amount: 900_000,
      currency: "LBP",
    });
    settle([fs(t.fsId)], "LBP", 900_000);
    reverse.void(t.txnId);
    const open = openRowsOf(reversalOf(t.txnId));
    expect(open.map((r) => [r.amount_usd, r.amount_lbp])).toEqual([[0, -900_000]]);
    expectBalanceEqualsOpen();
  });

  it("void the transfer, then undo the settlement: money back, nothing owed, every ledger nets", () => {
    const balance0 = memberBalance(db, acc.omtId);
    const t = seedOmtSendWithTxns(db, acc.omtId, { amount: 35 });
    const drawers0 = drawerTotals(db);
    const s = settle([fs(t.fsId)], "USD", 35);
    reverse.void(t.txnId);
    expectBalanceEqualsOpen();
    reverse.void(s);
    expectBalanceEqualsOpen();
    expect(drawerTotals(db)).toEqual(drawers0);
    expect(r2(memberBalance(db, acc.omtId).usd - balance0.usd)).toBe(0);
    const q = repo.getAccountUnsettled(acc.omtId);
    expect(r2(q.reduce((sum, r) => sum + r.remaining_usd, 0))).toBe(0);
  });

  it("undo the settlement, then void the transfer: no account row is written", () => {
    const t = seedOmtSendWithTxns(db, acc.omtId, { amount: 35 });
    const s = settle([fs(t.fsId)], "USD", 35);
    reverse.void(s);
    reverse.void(t.txnId);
    expect(openRowsOf(reversalOf(t.txnId))).toEqual([]);
    expect(repo.getAccountUnsettled(acc.omtId)).toEqual([]);
    expectBalanceEqualsOpen();
  });
  // ── Day credits: an OMT App cash-out (LEDGER) and a counter RECEIVE (FS) ──

  /** An OMT App cash-out as `RechargeRepository.cashoutToSupplier` books it:
   *  a `recharges`-sourced WALLET_CASHOUT transaction, and its is_auto
   *  PAYMENT ledger sibling (a credit) with its OWN hidden transaction. */
  function seedCashout(amount: number): { txnId: number; ledgerId: number } {
    const txRepo = getTransactionRepository();
    const rechargeId = Number(
      db
        .prepare(
          `INSERT INTO recharges (tenant_id, carrier, recharge_type, amount, currency_code, paid_by)
           VALUES (1, 'OMT_APP', 'TOP_UP', ?, 'USD', 'OMT_App')`,
        )
        .run(amount).lastInsertRowid,
    );
    const txnId = txRepo.createTransaction({
      type: TRANSACTION_TYPES.WALLET_CASHOUT,
      source_table: "recharges",
      source_id: rechargeId,
      user_id: 1,
      amount_usd: amount,
      amount_lbp: 0,
      summary: "Cash Out to OMT",
      metadata_json: {},
    });
    const ledgerId = Number(
      db
        .prepare(
          `INSERT INTO supplier_ledger
             (tenant_id, supplier_id, entry_type, amount_usd, amount_lbp, is_auto,
              source_ref_table, source_ref_id, created_by, created_at)
           VALUES (1, ?, 'PAYMENT', ?, 0, 1, 'recharges', ?, 1, '2026-10-18 10:00:00')`,
        )
        .run(acc.appId, -amount, rechargeId).lastInsertRowid,
    );
    const siblingTxn = txRepo.createTransaction({
      type: TRANSACTION_TYPES.SUPPLIER_PAYMENT,
      source_table: "supplier_ledger",
      source_id: ledgerId,
      user_id: 1,
      amount_usd: amount,
      amount_lbp: 0,
      summary: "Cash Out to OMT (auto)",
      metadata_json: { is_auto: true },
    });
    db.prepare(`UPDATE supplier_ledger SET transaction_id = ? WHERE id = ?`).run(
      siblingTxn,
      ledgerId,
    );
    return { txnId, ledgerId };
  }

  function reliefRows(): Array<{ id: number; amount_usd: number; settlement_id: number | null }> {
    return db
      .prepare(
        `SELECT l.id, l.amount_usd, l.settlement_id FROM supplier_ledger l
           JOIN transactions t ON t.id = l.transaction_id
          WHERE t.reverses_id IS NOT NULL ORDER BY l.id`,
      )
      .all() as Array<{ id: number; amount_usd: number; settlement_id: number | null }>;
  }

  for (const how of ["void", "refund"] as const) {
    it(`${how} of a FULLY netted OMT App cash-out: allowed, one pair only, the $40 it paid is owed to OMT`, () => {
      const t = seedOmtSendWithTxns(db, acc.omtId, { amount: 150 });
      const c = seedCashout(40);
      const s = settle(
        [fs(t.fsId), { kind: "LEDGER", id: c.ledgerId }],
        "USD",
        110,
      );
      const sBefore = settlementState(s);
      reverse[how](c.txnId);
      expect(settlementState(s)).toEqual(sBefore);
      // Exactly one balance-neutral pair, on the cash-out's member.
      const rows = reliefRows();
      expect(rows.map((r) => r.amount_usd)).toEqual([40, -40]);
      expect(rows[0].settlement_id).toBeNull();
      expect(rows[1].settlement_id).toBe(rows[1].id);
      const open = repo
        .getAccountUnsettled(acc.omtId)
        .filter((r) => r.kind === "LEDGER" && r.remaining_usd !== 0);
      expect(open.map((r) => [r.supplier_id, r.row_scope, r2(r.remaining_usd)])).toEqual([
        [acc.appId, "ACCOUNT", 40],
      ]);
      expectBalanceEqualsOpen();
    });

    it(`${how} of a PART-netted OMT App cash-out: allowed, only the $10 used becomes owed`, () => {
      const t = seedOmtSendWithTxns(db, acc.omtId, { amount: 10 });
      const c = seedCashout(40);
      // $10 owed against a $40 credit: pure netting, OMT still owes $30.
      const anchor = repo.settleAccount({
        account_supplier_id: acc.omtId,
        per_currency: { USD: { direction: "COLLECT", payments: [] } },
        expected_owed: owedOf([fs(t.fsId), { kind: "LEDGER", id: c.ledgerId }]),
        selections: [fs(t.fsId), { kind: "LEDGER", id: c.ledgerId }],
        created_by: 1,
      }).id;
      const s = settlementTxn(db, anchor).id;
      const sBefore = settlementState(s);
      reverse[how](c.txnId);
      expect(settlementState(s)).toEqual(sBefore);
      expect(reliefRows().map((r) => r.amount_usd)).toEqual([10, -10]);
      const q = repo.getAccountUnsettled(acc.omtId);
      expect(r2(q.reduce((sum, r) => sum + r.remaining_usd, 0))).toBe(10);
      expectBalanceEqualsOpen();
    });
  }

  it("void of a netted counter RECEIVE (a credit-sign transfer): the $60 it paid is owed to OMT", () => {
    const txRepo = getTransactionRepository();
    const debt = seedOmtSendWithTxns(db, acc.omtId, { amount: 100 });
    const fsId = Number(
      db
        .prepare(
          `INSERT INTO financial_services
             (tenant_id, provider, service_type, amount, currency, commission, omt_fee,
              omt_service_type, commission_model, receive_fee_model, is_settled, created_by, created_at)
           VALUES (1, 'OMT', 'RECEIVE', 60, 'USD', 0, 0, 'INTRA', 1, 1, 0, 1, '2026-10-18 11:00:00')`,
        )
        .run().lastInsertRowid,
    );
    const ledgerId = Number(
      db
        .prepare(
          `INSERT INTO supplier_ledger
             (tenant_id, supplier_id, entry_type, amount_usd, amount_lbp, is_auto,
              source_ref_table, source_ref_id, created_by, created_at)
           VALUES (1, ?, 'PAYMENT', -60, 0, 1, 'financial_services', ?, 1, '2026-10-18 11:00:00')`,
        )
        .run(acc.omtId, fsId).lastInsertRowid,
    );
    const receiveTxn = txRepo.createTransaction({
      type: TRANSACTION_TYPES.FINANCIAL_SERVICE,
      source_table: "financial_services",
      source_id: fsId,
      user_id: 1,
      amount_usd: 60,
      amount_lbp: 0,
      summary: "OMT RECEIVE $60",
      metadata_json: {},
    });
    const siblingTxn = txRepo.createTransaction({
      type: TRANSACTION_TYPES.SUPPLIER_PAYMENT,
      source_table: "supplier_ledger",
      source_id: ledgerId,
      user_id: 1,
      amount_usd: 60,
      amount_lbp: 0,
      summary: "OMT receive (auto)",
      metadata_json: { is_auto: true },
    });
    db.prepare(`UPDATE supplier_ledger SET transaction_id = ? WHERE id = ?`).run(
      siblingTxn,
      ledgerId,
    );
    const receiveRow = repo
      .getAccountUnsettled(acc.omtId)
      .find((r) => r.kind === "FINANCIAL_SERVICE" && r.id === fsId);
    expect(receiveRow?.remaining_usd).toBe(-60);
    const s = settle([fs(debt.fsId), fs(fsId)], "USD", 40);
    const sBefore = settlementState(s);
    reverse.void(receiveTxn);
    expect(settlementState(s)).toEqual(sBefore);
    expect(reliefRows().map((r) => r.amount_usd)).toEqual([60, -60]);
    const q = repo.getAccountUnsettled(acc.omtId);
    expect(r2(q.reduce((sum, r) => sum + r.remaining_usd, 0))).toBe(60);
    expectBalanceEqualsOpen();
  });
});
