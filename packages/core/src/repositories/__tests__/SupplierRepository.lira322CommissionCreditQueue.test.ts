/**
 * LIRA-322 finding F3 (research.md) — a settlement's own commission credit
 * reappears in the OMT account queue.
 *
 * A legacy account settlement with an entered commission books an auto
 * `SUPPLIER_PAYS_US` credit (−commission, `source_ref_table =
 * 'supplier_ledger'`, is_auto) and leaves its `settlement_id` NULL. The
 * queue's ledger branch only excluded `source_ref_table =
 * 'financial_services'`, so that credit showed up as an open credit and
 * could be applied a second time.
 *
 * The other open credits (an overpay credit, a manual / cash-out credit
 * with no back-link) must stay in the queue.
 *
 * Rule 17: run against the unchanged repository first.
 */
import Database from "better-sqlite3";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { SupplierRepository } from "../SupplierRepository";
import {
  buildDb,
  fundDrawer,
  omtAccount,
  resetAll,
  seedLedgerRow,
  seedOmtSend,
  type OmtAccount,
} from "../testHelpers/omtAccountDb";

describe("LIRA-322 F3 — the settlement commission credit stays out of the account queue", () => {
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
    fundDrawer(db, "OMT_System", "USD", 10000);
    fundDrawer(db, "General", "USD", 10000);
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  function commissionCredits(): Array<{ id: number; settlement_id: number | null }> {
    return db
      .prepare(
        `SELECT id, settlement_id FROM supplier_ledger
          WHERE entry_type = 'SUPPLIER_PAYS_US' AND source_ref_table = 'supplier_ledger'`,
      )
      .all() as Array<{ id: number; settlement_id: number | null }>;
  }

  it("after a legacy settle with commission 0.70, no SUPPLIER_PAYS_US/supplier_ledger row is in the queue", () => {
    const fs1 = seedOmtSend(db, acc.omtId, { amount: 21, created_at: "2026-10-01 09:00:00" });
    const fs2 = seedOmtSend(db, acc.omtId, { amount: 21, created_at: "2026-10-01 10:00:00" });
    // A later transfer that this settlement does not touch keeps the queue non-empty.
    const fs3 = seedOmtSend(db, acc.omtId, { amount: 101, created_at: "2026-10-01 11:00:00" });

    repo.settleAccount({
      account_supplier_id: acc.omtId,
      direction: "PAY",
      selections: [
        { kind: "FINANCIAL_SERVICE", id: fs1 },
        { kind: "FINANCIAL_SERVICE", id: fs2 },
      ],
      amount_usd: 42 - 0.7,
      amount_lbp: 0,
      commission_usd: 0.7,
      commission_lbp: 0,
      created_by: 1,
      payments: [{ method: "CASH", currency_code: "USD", amount: 42 - 0.7 }],
    });

    // The credit really was written (otherwise this test proves nothing).
    const credits = commissionCredits();
    expect(credits).toHaveLength(1);

    const queue = repo.getAccountUnsettled(acc.omtId);
    expect(queue.map((r) => `${r.kind}:${r.id}`)).toEqual([
      `FINANCIAL_SERVICE:${fs3}`,
    ]);
    expect(
      queue.some((r) => r.kind === "LEDGER" && r.id === credits[0].id),
    ).toBe(false);

    // Invariant 1 (data-model.md): the member's ledger balance equals what
    // its open queue rows still owe. The −0.70 credit is already inside the
    // balance (it offsets the 0.70 the settlement row did not pay), so
    // hiding it from the queue loses no money. Not proven failing-first
    // (added after the fix, on review).
    const balance = db
      .prepare(
        `SELECT COALESCE(SUM(amount_usd), 0) AS usd FROM supplier_ledger
          WHERE tenant_id = 1 AND supplier_id = ? AND COALESCE(is_refunded, 0) = 0`,
      )
      .get(acc.omtId) as { usd: number };
    const owedByQueue = queue
      .filter((r) => r.supplier_id === acc.omtId)
      .reduce((s, r) => s + r.remaining_usd, 0);
    expect(balance.usd).toBeCloseTo(101, 6);
    expect(owedByQueue).toBeCloseTo(balance.usd, 6);
  });

  it("other open credits stay in the queue: an overpay credit and a manual credit with no back-link", () => {
    const fs1 = seedOmtSend(db, acc.omtId, { amount: 21, created_at: "2026-10-01 09:00:00" });
    const manual = seedLedgerRow(db, acc.appId, {
      entry_type: "SUPPLIER_PAYS_US",
      amount_usd: -15,
      created_at: "2026-10-01 07:00:00",
    });

    // Pay $25 for a $21 transfer: $4 extra goes on the account (LIRA-315).
    repo.settleAccount({
      account_supplier_id: acc.omtId,
      direction: "PAY",
      selections: [{ kind: "FINANCIAL_SERVICE", id: fs1 }],
      amount_usd: 21,
      amount_lbp: 0,
      commission_usd: 0,
      commission_lbp: 0,
      created_by: 1,
      payments: [{ method: "CASH", currency_code: "USD", amount: 25 }],
    });

    const queue = repo.getAccountUnsettled(acc.omtId);
    const ledgerIds = queue.filter((r) => r.kind === "LEDGER").map((r) => r.id);
    expect(ledgerIds).toContain(manual);
    const overpay = queue.filter(
      (r) => r.kind === "LEDGER" && r.id !== manual && r.amount_usd === -4,
    );
    expect(overpay).toHaveLength(1);
  });
});
