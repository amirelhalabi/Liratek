/**
 * LIRA-343 T037 (US5 / US6, FR-016b) — an open ACCOUNT row written by an
 * undo or a void (`_bookSettlementCoverageRelief`) names its origin, so the
 * calendar can put the ↺ badge on the day it appeared:
 *
 * - `relief_origin = "UNDO"` when the reversal undid a SUPPLIER_SETTLEMENT,
 *   `relief_ref = "#<undone settlement transaction id>"`;
 * - `relief_origin = "VOID"` when it voided / refunded a covered transfer,
 *   `relief_ref = "#<voided transaction id>"`;
 * - every other row: both null.
 *
 * Rule 17: written and run before the projection existed.
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
  fundDrawer,
  omtAccount,
  resetAll,
  settlementTxn,
  type CurrencyPair,
  type OmtAccount,
} from "../testHelpers/omtAccountDb";
import { seedOmtSendWithTxns } from "../testHelpers/omtTransferTxns";

type Selection = NonNullable<SettleAccountRequest["selections"]>[number];

describe("LIRA-343 — relief_origin / relief_ref on account rows (T037)", () => {
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
  const ledger = (id: number): Selection => ({ kind: "LEDGER", id });

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

  function settleUsd(selections: Selection[], amount: number): number {
    const anchor = repo.settleAccount({
      account_supplier_id: acc.omtId,
      per_currency: {
        USD: {
          direction: "PAY",
          payments: [{ method: "CASH", currency_code: "USD", amount }],
        },
      },
      expected_owed: owedOf(selections),
      selections,
      created_by: 1,
    }).id;
    return settlementTxn(db, anchor).id;
  }

  function overpayCreditOf(txnId: number): number {
    const row = db
      .prepare(
        `SELECT id FROM supplier_ledger
          WHERE transaction_id = ? AND settlement_id IS NULL AND amount_usd < 0`,
      )
      .get(txnId) as { id: number } | undefined;
    if (!row) throw new Error(`settlement #${txnId} left no open credit`);
    return row.id;
  }

  function reversalOf(txnId: number): number {
    return (
      db
        .prepare(
          `SELECT id FROM transactions WHERE reverses_id = ? ORDER BY id DESC LIMIT 1`,
        )
        .get(txnId) as { id: number }
    ).id;
  }

  it("undo of #A after #B used its credit → open ACCOUNT row with relief_origin UNDO, ref #A", () => {
    const d21 = seedOmtSendWithTxns(db, acc.omtId, {
      amount: 100,
      created_at: "2026-10-21 09:00:00",
    });
    const d22 = seedOmtSendWithTxns(db, acc.omtId, {
      amount: 50,
      created_at: "2026-10-22 09:00:00",
    });
    const a = settleUsd([fs(d21.fsId)], 108.7);
    const credit = overpayCreditOf(a);
    settleUsd([fs(d22.fsId), ledger(credit)], 41.3);

    getTransactionRepository().voidTransaction(a, 1);
    const undo = reversalOf(a);

    const q = repo.getAccountUnsettled(acc.omtId);
    const relief = q.filter(
      (r) => r.kind === "LEDGER" && r.transaction_id === undo,
    );
    expect(relief).toHaveLength(1);
    expect(relief[0]).toMatchObject({
      row_scope: "ACCOUNT",
      remaining_usd: 8.7,
      relief_origin: "UNDO",
      relief_ref: `#${a}`,
    });
    // Every other row carries no origin.
    for (const r of q.filter((r) => r !== relief[0])) {
      expect({ id: r.id, o: r.relief_origin, ref: r.relief_ref }).toEqual({
        id: r.id,
        o: null,
        ref: null,
      });
    }
    // Range mode projects the same fields.
    const ranged = repo
      .getAccountRows(acc.omtId, {
        fromUtc: "2000-01-01 00:00:00",
        toUtc: "2100-01-01 00:00:00",
      })
      .find((r) => r.kind === "LEDGER" && r.transaction_id === undo);
    expect(ranged).toMatchObject({ relief_origin: "UNDO", relief_ref: `#${a}` });
  });

  it("void of a covered transfer → open ACCOUNT credit row with relief_origin VOID, ref #<voided txn>", () => {
    const d18 = seedOmtSendWithTxns(db, acc.omtId, {
      amount: 35,
      created_at: "2026-10-18 09:00:00",
    });
    settleUsd([fs(d18.fsId)], 35);

    getTransactionRepository().voidTransaction(d18.txnId, 1);
    const voidId = reversalOf(d18.txnId);

    const relief = repo
      .getAccountUnsettled(acc.omtId)
      .filter((r) => r.kind === "LEDGER" && r.transaction_id === voidId);
    expect(relief).toHaveLength(1);
    expect(relief[0]).toMatchObject({
      row_scope: "ACCOUNT",
      remaining_usd: -35,
      relief_origin: "VOID",
      relief_ref: `#${d18.txnId}`,
    });
  });
});
