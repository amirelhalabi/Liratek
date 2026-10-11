/**
 * LIRA-306 T086 — debts family (rest): `debt:cash-out`,
 * `debt:add-account-entry`, `debt:add-credit` (lifted), `debt:use-credit`,
 * `debt:write-off`, `debts:update-metadata` (lifted). Replayed through the
 * ReplayEngine each books what the REST route's `DebtService` call books
 * online (drawers, payment lines, transactions, debt ledger per currency —
 * SC-001), at the event's own time (FR-021), with the route's schema.
 *
 * Three-way key diffs (rule 23), recorded before the lifts:
 *   debt:add-credit — (a) core `addCreditSchema` (POST /api/debts/credit):
 *     clientId, amountUsd, amountLbp, note, transactionTime; (b) preload
 *     `debt.addCredit({clientId, amountUsd, amountLbp, note?, transactionTime?})`;
 *     (c) handler forwards `...v.data` → same five keys. Nothing missing.
 *     Only difference: core `transactionTime` is `.datetime()` where the
 *     hand-written copy took any string — no frontend caller sends it
 *     (`addCredit` has no caller in frontend/src), so nothing is lost.
 *   debts:update-metadata — (a) core `debtUpdateMetadataSchema`
 *     (POST /api/debts/update-metadata): id, note; (b) preload
 *     `debt.updateMetadata({id, note?})`; (c) handler forwards `data.id`,
 *     `data.note`. Nothing missing.
 */
import type Database from "better-sqlite3";
import { runWithTenant } from "../../../db/tenantContext";
import {
  addCreditSchema,
  debtAccountEntrySchema,
  debtCashOutSchema,
  debtUpdateMetadataSchema,
  debtUseCreditSchema,
  debtWriteOffSchema,
} from "../../../validators/debt";
import { recordedSchema, PENDING_LIFT } from "../../channelPolicy";
import { getDebtService, resetDebtService } from "../../../services/DebtService";
import { resetDebtRepository } from "../../../repositories/DebtRepository";
import { resetTransactionRepository } from "../../../repositories/TransactionRepository";
import { DEBTS_REST_BINDINGS } from "../debtsRest";
import { bindingLookup, runParity, tableState, type ParityCase } from "../../testHelpers/familyHarness";

const bindings = bindingLookup(DEBTS_REST_BINDINGS);

function reset(): void {
  resetDebtService();
  resetDebtRepository();
  resetTransactionRepository();
}

/** Client 7 owes $30 (cash advance); client 8 holds $50 credit. */
function seed(db: Database.Database): void {
  db.exec(`
    UPDATE exchange_rates SET market_rate = 89750, buy_rate = 89500, sell_rate = 90000 WHERE tenant_id = 1 AND to_code = 'LBP';
    INSERT OR REPLACE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES
      (1, 'General', 'USD', 1000), (1, 'General', 'LBP', 90000000);
    INSERT INTO clients (id, tenant_id, full_name, phone_number) VALUES (7, 1, 'Rami', '70123456'), (8, 1, 'Lina', '71123456');
  `);
  runWithTenant(1, () => {
    const s = getDebtService();
    const a = s.addAccountCashEntry({ ...debtAccountEntrySchema.parse({ direction: "debt", clientId: 7, amountUSD: 30, amountLBP: 0 }), userId: 1 });
    if (!a.success) throw new Error(a.error);
    const b = s.addCredit({ ...addCreditSchema.parse({ clientId: 8, amountUsd: 50 }), userId: 1 } as never);
    if (!b.success) throw new Error(b.error);
  });
}

const state = (db: Database.Database) => tableState(db, ["debt_ledger"]);

function c(over: Partial<ParityCase> & Pick<ParityCase, "channel" | "payload" | "online">): ParityCase {
  return { seed, reset, bindings, state, ...over };
}

const CASES: Array<[string, ParityCase]> = [
  (() => {
    const p = { clientId: 8, amountUSD: 20, amountLBP: 0, payments: [{ method: "CASH", currencyCode: "USD", amount: 20 }], note: "cash back" };
    return ["debt:cash-out (USD cash leg)", c({ channel: "debt:cash-out", payload: p, online: () => getDebtService().cashOut({ ...debtCashOutSchema.parse(p), userId: 1 }) })] as [string, ParityCase];
  })(),
  (() => {
    const p = { direction: "credit", clientId: 7, amountUSD: 0, amountLBP: 900000, payments: [{ method: "CASH", currencyCode: "LBP", amount: 900000 }] };
    return ["debt:add-account-entry credit, LBP", c({ channel: "debt:add-account-entry", payload: p, online: () => getDebtService().addAccountCashEntry({ ...debtAccountEntrySchema.parse(p), userId: 1 }) })] as [string, ParityCase];
  })(),
  (() => {
    const p = { direction: "debt", clientId: 7, amountUSD: 10, amountLBP: 0, moveCash: false, note: "paper" };
    return ["debt:add-account-entry debt, paper (no cash)", c({ channel: "debt:add-account-entry", payload: p, online: () => getDebtService().addAccountCashEntry({ ...debtAccountEntrySchema.parse(p), userId: 1 }) })] as [string, ParityCase];
  })(),
  (() => {
    const p = { clientId: 7, amountUsd: 5, amountLbp: 0, note: "goodwill" };
    return ["debt:add-credit", c({ channel: "debt:add-credit", payload: p, online: () => getDebtService().addCredit({ ...addCreditSchema.parse(p), userId: 1 } as never) })] as [string, ParityCase];
  })(),
  (() => {
    const p = { clientId: 8, amountUsd: 12, amountLbp: 0, note: "used" };
    return ["debt:use-credit", c({ channel: "debt:use-credit", payload: p, online: () => getDebtService().useCredit({ ...debtUseCreditSchema.parse(p), userId: 1 } as never) })] as [string, ParityCase];
  })(),
  (() => {
    const p = { clientId: 7, amountUSD: 10, amountLBP: 0, reason: "forgiven" };
    return ["debt:write-off", c({ channel: "debt:write-off", payload: p, online: () => getDebtService().writeOffDebt({ ...debtWriteOffSchema.parse(p), userId: 1 } as never) })] as [string, ParityCase];
  })(),
];

describe("debts (rest) bindings (T086)", () => {
  it("each channel validates with its REST route's schema object; add-credit and update-metadata lifted", () => {
    expect(recordedSchema("debt:cash-out")).toBe(debtCashOutSchema);
    expect(recordedSchema("debt:add-account-entry")).toBe(debtAccountEntrySchema);
    expect(recordedSchema("debt:add-credit")).toBe(addCreditSchema);
    expect(recordedSchema("debt:use-credit")).toBe(debtUseCreditSchema);
    expect(recordedSchema("debt:write-off")).toBe(debtWriteOffSchema);
    expect(recordedSchema("debts:update-metadata")).toBe(debtUpdateMetadataSchema);
    expect(PENDING_LIFT).not.toContain("debt:add-credit");
    expect(PENDING_LIFT).not.toContain("debts:update-metadata");
  });

  it.each(CASES)("%s — replay equals online, every row at the event's time", async (_n, pc) => {
    const run = await runParity(pc);
    expect(run.online.result).toMatchObject({ success: true });
    expect(run.replay.outcome).toMatchObject({ status: "booked" });
    expect(run.replay.state).toEqual(run.online.state);
    expect(run.replay.offTime).toEqual([]);
  });

  it("debts:update-metadata — editedBy is the event actor's username", async () => {
    const run = await runParity(
      c({
        channel: "debts:update-metadata",
        payload: { id: 1, note: "promised Friday" },
        actorUserId: 2,
        online: () => getDebtService().updateDebtMetadata(1, { note: "promised Friday" }, "cashier"),
      }),
    );
    expect(run.replay.outcome.status).toBe("booked");
    expect(run.replay.state).toEqual(run.online.state);
    expect(JSON.stringify(run.replay.state)).toContain('"edited_by":"cashier"');
  });

  it("using more credit than the client holds is refused with the service's reason", async () => {
    const p = { clientId: 8, amountUsd: 500, amountLbp: 0 };
    const run = await runParity(
      c({ channel: "debt:use-credit", payload: p, online: () => getDebtService().useCredit({ ...debtUseCreditSchema.parse(p), userId: 1 } as never) }),
    );
    expect(run.online.result).toMatchObject({ success: false });
    expect(run.replay.outcome).toMatchObject({ status: "refused", error: (run.online.result as { error: string }).error });
    expect(run.replay.state).toEqual(run.online.state);
  });
});
