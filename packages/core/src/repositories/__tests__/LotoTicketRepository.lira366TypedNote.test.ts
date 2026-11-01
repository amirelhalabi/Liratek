/**
 * LIRA-366 T012 — the cashier's typed note on a Loto ticket sale.
 *
 * A 100,000 LBP ticket: 80,000 cash + 20,000 on the client's account, note
 * "rest on Monday". The note goes to `details.note`, the ticket's `note`
 * column, and the end of the 'Loto Debt' note. Money is unchanged by it
 * (deltas, rule 15). Editing the note later moves every copy (rule 31).
 *
 * Field names come from `lotoSellSchema` (rule 24). Real schema via the
 * debtItemDb helper. Rule 17: seen failing before the repository read
 * `typedNote`.
 */
import type Database from "better-sqlite3";
import {
  addClient,
  installDebtItemTestDb,
  uninstallDebtItemTestDb,
} from "../testHelpers/debtItemDb";
import { ledgerDeltas, snapshotLedgers } from "../testHelpers/postingAssert";
import {
  getLotoTicketRepository,
  resetLotoTicketRepository,
} from "../LotoTicketRepository";
import { getLotoService, resetLotoService } from "../../services/LotoService";
import { resetTransactionRepository } from "../TransactionRepository";
import { resetSupplierRepository } from "../SupplierRepository";
import { resetPartnerRepository } from "../PartnerRepository";
import { resetPaymentMethodRepository } from "../PaymentMethodRepository";
import { resetDebtRepository } from "../DebtRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { lotoSellSchema } from "../../validators/loto";
import { readTypedNoteCopies } from "../testHelpers/typedNoteAssert";

const SALE = 100_000;
const COMMISSION = 4_450;

let db: Database.Database;

function resetAll(): void {
  resetTransactionRepository();
  resetSupplierRepository();
  resetPartnerRepository();
  resetPaymentMethodRepository();
  resetDebtRepository();
  resetLotoTicketRepository();
  resetLotoService();
}

beforeEach(() => {
  db = installDebtItemTestDb();
  initFixedTenantContext(1);
  resetAll();
  addClient(db, 50);
});
afterEach(() => {
  resetAll();
  resetTenantContext();
  uninstallDebtItemTestDb(db);
});

/** Sell through the service, with the wire payload parsed by the real
 *  schema (rule 24) — the same path IPC and REST take. */
function sell(typedNote: string | undefined) {
  const parsed = lotoSellSchema.parse({
    sale_amount: SALE,
    commission_rate: COMMISSION / SALE,
    sale_date: "2026-10-14",
    currency: "LBP",
    clientId: 50,
    payments: [
      { method: "CASH", currencyCode: "LBP", amount: 80_000 },
      { method: "CUSTOMER_ACCOUNT", currencyCode: "LBP", amount: 20_000 },
    ],
    typedNote,
  });
  return getLotoService().sellTicket({ ...parsed, userId: 1 });
}

function lotoTxnId(ticketId: number): number {
  return (
    db
      .prepare(
        `SELECT id FROM transactions WHERE source_table = 'loto_tickets' AND source_id = ? AND type = 'LOTO'`,
      )
      .get(ticketId) as { id: number }
  ).id;
}

describe("LIRA-366 — typed note on a Loto sale", () => {
  it("lands in details.note, the ticket note and the Loto Debt note; money unchanged", () => {
    const before = snapshotLedgers(db);
    const t = sell("  rest on Monday ");
    const d = ledgerDeltas(before, snapshotLedgers(db));
    expect(d.debt).toEqual({ "50|LBP": 20_000 });
    expect(d.drawers).toEqual({ "General|LBP": 80_000 });

    const c = readTypedNoteCopies(db, lotoTxnId(t.id));
    expect(c.detailsNote).toBe("rest on Monday");
    expect(c.debtNotes).toHaveLength(1);
    expect(c.debtNotes[0]).toMatch(/ — rest on Monday$/);
    expect(
      (
        db
          .prepare(`SELECT note FROM loto_tickets WHERE id = ?`)
          .get(t.id) as { note: string }
      ).note,
    ).toBe("rest on Monday");
  });

  it("no typed note → no details.note and no suffix", () => {
    const t = sell("   ");
    const c = readTypedNoteCopies(db, lotoTxnId(t.id));
    expect(c.detailsNote).toBeUndefined();
    expect(c.debtNotes[0]).not.toContain(" — ");
  });

  it("editing the note moves details.note and the debt note together", () => {
    const t = sell("rest on Monday");
    const systemPart = readTypedNoteCopies(db, lotoTxnId(t.id))
      .debtNotes[0].replace(/ — rest on Monday$/, "");
    getLotoTicketRepository().updateMetadata(t.id, { note: "rest on Tuesday" }, "admin");
    const c = readTypedNoteCopies(db, lotoTxnId(t.id));
    expect(c.detailsNote).toBe("rest on Tuesday");
    expect(c.debtNotes).toEqual([`${systemPart} — rest on Tuesday`]);
  });
});
