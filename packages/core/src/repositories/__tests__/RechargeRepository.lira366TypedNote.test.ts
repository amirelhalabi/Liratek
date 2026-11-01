/**
 * LIRA-366 T013 — the cashier's typed note on an MTC/Alfa recharge.
 *
 * A $10 recharge: $6 cash + $4 on the client's account, note "rest on
 * Monday". The note goes to `details.note`, the recharge's `note` column
 * (which otherwise holds the generated "MTC …" label), and the end of the
 * 'Recharge Debt' note. Money is unchanged by it (deltas, rule 15). Editing
 * the note later moves every copy (rule 31).
 *
 * Field names come from `createRechargeSchema` (rule 24). Real schema via
 * the debtItemDb helper. Rule 17: seen failing before the repository read
 * `typedNote`.
 */
import type Database from "better-sqlite3";
import {
  addClient,
  installDebtItemTestDb,
  uninstallDebtItemTestDb,
} from "../testHelpers/debtItemDb";
import { ledgerDeltas, snapshotLedgers } from "../testHelpers/postingAssert";
import { readTypedNoteCopies } from "../testHelpers/typedNoteAssert";
import {
  getRechargeRepository,
  resetRechargeRepository,
  type RechargeData,
} from "../RechargeRepository";
import { resetTransactionRepository } from "../TransactionRepository";
import { resetPaymentMethodRepository } from "../PaymentMethodRepository";
import { resetDebtRepository } from "../DebtRepository";
import {
  getRechargeService,
  resetRechargeService,
} from "../../services/RechargeService";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { createRechargeSchema } from "../../validators/recharge";

let db: Database.Database;

function resetAll(): void {
  resetTransactionRepository();
  resetPaymentMethodRepository();
  resetDebtRepository();
  resetRechargeRepository();
  resetRechargeService();
}

beforeEach(() => {
  db = installDebtItemTestDb();
  initFixedTenantContext(1);
  resetAll();
  addClient(db, 70);
});
afterEach(() => {
  resetAll();
  resetTenantContext();
  uninstallDebtItemTestDb(db);
});

function sell(typedNote: string | undefined): number {
  const data = createRechargeSchema.parse({
    provider: "MTC",
    type: "CREDIT_TRANSFER",
    amount: 10,
    cost: 8,
    price: 10,
    currency: "USD",
    clientId: 70,
    phoneNumber: "76000000",
    payments: [
      { method: "CASH", currencyCode: "USD", amount: 6 },
      { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 4 },
    ],
    typedNote,
  });
  const r = getRechargeService().processRecharge({
    ...data,
    userId: 1,
  } as unknown as RechargeData);
  expect(r.error).toBeUndefined();
  return r.id as number;
}

function rechargeTxnId(rechargeId: number): number {
  return (
    db
      .prepare(
        `SELECT id FROM transactions WHERE source_table = 'recharges' AND source_id = ? AND type = 'RECHARGE'`,
      )
      .get(rechargeId) as { id: number }
  ).id;
}

const column = (id: number) =>
  (db.prepare(`SELECT note FROM recharges WHERE id = ?`).get(id) as {
    note: string;
  }).note;

describe("LIRA-366 — typed note on a recharge", () => {
  it("lands in details.note, the recharge note and the Recharge Debt note; money unchanged", () => {
    const before = snapshotLedgers(db);
    const id = sell(" rest on Monday ");
    const d = ledgerDeltas(before, snapshotLedgers(db));
    expect(d.debt).toEqual({ "70|USD": 4 });

    const c = readTypedNoteCopies(db, rechargeTxnId(id));
    expect(c.detailsNote).toBe("rest on Monday");
    expect(c.debtNotes).toEqual([expect.stringMatching(/^MTC .* — rest on Monday$/)]);
    expect(column(id)).toBe("rest on Monday");
  });

  it("no typed note → the generated label stays, no details.note, no suffix", () => {
    const id = sell(undefined);
    const c = readTypedNoteCopies(db, rechargeTxnId(id));
    expect(c.detailsNote).toBeUndefined();
    expect(c.debtNotes[0]).not.toContain(" — ");
    expect(column(id)).toMatch(/^MTC /);
  });

  it("editing the note moves details.note and the debt note together", () => {
    const id = sell("rest on Monday");
    const systemPart = readTypedNoteCopies(db, rechargeTxnId(id)).debtNotes[0]
      .replace(/ — rest on Monday$/, "");
    getRechargeRepository().updateMetadata(id, { note: "rest on Tuesday" }, "admin");
    const c = readTypedNoteCopies(db, rechargeTxnId(id));
    expect(c.detailsNote).toBe("rest on Tuesday");
    expect(c.debtNotes).toEqual([`${systemPart} — rest on Tuesday`]);
  });
});
