/**
 * LIRA-348 — "open on today, 50 at a time" paging for the Audit &
 * Transactions tables. Shared by both transports (rule 19/21): the IPC
 * handlers and the REST routes validate ONLY these keys and merge them into
 * the filters they already pass through, so no existing filter key is ever
 * stripped by this schema (rule 23).
 *
 * Days are the OPERATOR's own calendar days (`YYYY-MM-DD`, the browser's
 * `localDay()`), applied server-side with `localDayRangeFilter` (rule 27).
 *
 * Paging is keyset, never OFFSET: the client sends the last row it already
 * has, and the server returns the rows strictly after it in the table's own
 * order. A row written while the operator scrolls can therefore never shift
 * a page and show a row twice or skip one.
 */
import { z } from "zod";
import { localDayFormatSchema } from "./common.js";

/** The last Transactions row the client already has — the sort key of
 *  `ORDER BY t.created_at DESC, t.id DESC`, as the row itself carries it. */
export const transactionPageCursorSchema = z.object({
  created_at: z.string().min(1).max(40),
  id: z.number().int().positive(),
});

/** The paging keys `transactions:get-recent` / `GET /api/transactions/recent`
 *  accept on top of their existing filters. */
export const transactionPageFiltersSchema = z.object({
  day_from: localDayFormatSchema.optional(),
  day_to: localDayFormatSchema.optional(),
  before: transactionPageCursorSchema.optional(),
});

export type TransactionPageCursor = z.infer<typeof transactionPageCursorSchema>;
export type TransactionPageFiltersInput = z.input<
  typeof transactionPageFiltersSchema
>;

/** The paging keys `audit:search` / `POST /api/audit/search` accept on top
 *  of their existing filters. The audit log is ordered `id DESC`, so its
 *  cursor is the last id the client has. */
export const auditPageFiltersSchema = z.object({
  dayFrom: localDayFormatSchema.optional(),
  dayTo: localDayFormatSchema.optional(),
  beforeId: z.number().int().positive().optional(),
});

export type AuditPageFiltersInput = z.input<typeof auditPageFiltersSchema>;
