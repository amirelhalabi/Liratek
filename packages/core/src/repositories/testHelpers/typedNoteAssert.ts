/**
 * LIRA-366 test helper — read every copy of a transaction's typed note:
 * `details.note` on the transaction and the notes of its debt CHARGE rows
 * (`… Debt`; refund/reversal rows excluded), oldest first.
 *
 * Not a test file (lives outside `__tests__`), so jest never runs it alone.
 */
import type Database from "better-sqlite3";

export function readTypedNoteCopies(
  db: Database.Database,
  transactionId: number,
  tenantId = 1,
): { detailsNote: unknown; debtNotes: string[] } {
  const row = db
    .prepare(`SELECT metadata_json FROM transactions WHERE tenant_id = ? AND id = ?`)
    .get(tenantId, transactionId) as { metadata_json: string | null } | undefined;
  const meta = row?.metadata_json
    ? (JSON.parse(row.metadata_json) as { details?: { note?: unknown } })
    : undefined;
  const debtNotes = (
    db
      .prepare(
        `SELECT note FROM debt_ledger
          WHERE tenant_id = ? AND transaction_id = ? AND transaction_type LIKE '% Debt'
          ORDER BY id`,
      )
      .all(tenantId, transactionId) as { note: string | null }[]
  ).map((r) => r.note ?? "");
  return { detailsNote: meta?.details?.note, debtNotes };
}
