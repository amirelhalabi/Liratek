import { z } from "zod";

/**
 * Loto validation schemas — the write-path contracts for loto money flows.
 *
 * Shared by the Electron IPC handlers (electron-app/handlers/lotoHandlers.ts,
 * via re-exports in electron-app/schemas/index.ts) and the REST routes
 * (backend/src/api/loto.ts) — ONE schema per payload, two transports
 * (CLAUDE.md rule 14).
 *
 * NOTE: no .transform() anywhere — it breaks validatePayload's generic
 * inference on the Electron side; is_winner is normalized in the handlers.
 */

export const lotoSellSchema = z
  .object({
    ticket_number: z.string().optional(),
    sale_amount: z.number().positive(),
    // Structured legs in the currency the customer ACTUALLY paid (a 500,000 LBP
    // ticket paid with $5 books General +5 USD, not +500,000 LBP).
    payments: z
      .array(
        z.object({
          method: z.string().min(1),
          currencyCode: z.string().min(1),
          amount: z.number(),
          direction: z.enum(["IN", "OUT"]).optional(),
        }),
      )
      .optional(),
    commission_rate: z.number().optional(),
    is_winner: z.boolean().optional(),
    prize_amount: z.number().optional(),
    sale_date: z.string().optional(),
    payment_method: z.string().optional(),
    currency: z.string().optional(),
    note: z.string().optional(),
    transaction_time: z.string().optional(),
    // T3 keep-change (docs/plans/done_plans/T3_KEEP_CHANGE_PLAN.md KC-3): kept (not
    // returned) change per currency → added to the transaction's profit stamp.
    kept_change_usd: z.number().nonnegative().optional(),
    kept_change_lbp: z.number().nonnegative().optional(),
    clientId: z.number().int().positive().nullable().optional(),
    clientName: z.string().optional(),
    // PFT-4 (Partner FOR-Transactions): the unpaid remainder routes to
    // partner_ledger instead of the client's debt_ledger when set. Only "FOR"
    // is valid for Loto (the partner analog of CUSTOMER_ACCOUNT).
    partnerId: z.number().int().positive().optional(),
    partnerMode: z.enum(["FOR"]).optional(),
  })
  .refine(
    (data) =>
      data.partnerMode !== "FOR" || data.payment_method !== "CUSTOMER_ACCOUNT",
    {
      // FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §3: mirrors
      // validators/customService.ts's identical refine. Under partnerMode
      // "FOR" there is no customer owing — the PARTNER owes — so
      // CUSTOMER_ACCOUNT is never a valid payment_method here, with or
      // without a clientId. Mirrors the repository-layer rejection in
      // `LotoTicketRepository`'s `assertNoCounterPayment` call (its
      // `hasLegacyCustomerAccount` branch); this is the edge (Zod) half of
      // rule 19 — reject before the write, not just inside it.
      message:
        "payment_method cannot be Customer Account on a for-partner loto ticket — there is no customer owing, the partner owes",
      path: ["payment_method"],
    },
  )
  .refine(
    (data) =>
      data.partnerMode !== "FOR" ||
      !(data.payments ?? []).some(
        (p) => p.direction !== "OUT" && p.method === "CUSTOMER_ACCOUNT",
      ),
    {
      // Same rule, the structured `payments[]` side — mirrors
      // `LotoTicketRepository`'s `hasCounterPaymentLeg` branch (an OUT leg
      // is change/return, not a counter payment, so it's excluded here too).
      // See the `payment_method` refine above for the full rationale.
      message:
        "payments cannot include a Customer Account leg on a for-partner loto ticket — there is no customer owing, the partner owes",
      path: ["payments"],
    },
  );

export const lotoCashPrizeSchema = z.object({
  // Optional everywhere else in the flow: the UI submits without it, the
  // repository has a no-ticket fallback note, and the session-basket replay
  // sends the same payload (owner repro 2026-07-13: "ticket_number: Required"
  // on a blank field; guarded by lira-091's no-ticket prize).
  ticket_number: z.string().optional(),
  prize_amount: z.number().positive(),
  prize_date: z.string().optional(),
  customer_name: z.string().optional(),
  note: z.string().optional(),
});

/**
 * Loto ticket update payload — METADATA ONLY.
 *
 * `sale_amount` / `commission_rate` / `commission_amount` / `is_winner` /
 * `prize_amount` are deliberately NOT in this schema. Ticket voiding/refunding
 * is now a real, reversible flow (TransactionRepository._reverseLotoSupplierLedger
 * / _assertLotoTicketVoidable) — an in-place edit of those fields would
 * silently desync the unified transaction, the supplier_ledger TOP_UP row, and
 * (if checkpointed) the checkpoint's frozen totals with NO rule-20 reversal
 * owner of its own, since this endpoint has no write path back into any of
 * them. The sanctioned way to correct a sale/commission/prize amount is now
 * void-then-resell (or a refund); this endpoint stays for the fields that
 * carry no downstream money math (ticket_number, payment_method/currency
 * bookkeeping, prize_paid_date, note).
 */
export const lotoTicketUpdateSchema = z.object({
  ticket_number: z.string().min(1).optional(),
  prize_paid_date: z.string().optional(),
  payment_method: z.string().optional(),
  currency: z.string().optional(),
  note: z.string().optional(),
});

export const lotoFeeSchema = z.object({
  fee_amount: z.number().positive(),
  fee_month: z.string().min(1),
  fee_year: z.number().int().positive(),
  recorded_date: z.string().optional(),
  note: z.string().optional(),
});

export const lotoCheckpointCreateSchema = z.object({
  checkpoint_date: z.string().min(1),
  period_start: z.string().min(1),
  period_end: z.string().min(1),
  note: z.string().optional(),
});

const checkpointPaymentSchema = z.object({
  method: z.string().min(1),
  currency_code: z.string().min(1),
  amount: z.number(),
  direction: z.enum(["IN", "OUT"]).optional(),
});

/**
 * Loto checkpoint update payload — the ONLY checkpoint write channel with no
 * schema before this (`PUT /api/loto/checkpoints/:id` /
 * `loto:checkpoint:update` both used to pass `req.body`/`data` straight into
 * `LotoService.updateCheckpoint` → `LotoCheckpointRepository.updateCheckpoint`
 * with zero validation). Both transports are already admin-gated, so this
 * closes a validation gap, not an authz hole — but it guards MONEY fields
 * (`total_sales`, `total_commission`, `total_prizes`, `is_settled`,
 * `settlement_id`) that a checkpoint settlement depends on.
 *
 * MUST track `LotoCheckpointUpdate`
 * (packages/core/src/repositories/LotoCheckpointRepository.ts) field-for-field:
 * Zod strips unknown keys silently, so a field present in the repository
 * interface but missing here would silently vanish on every write that goes
 * through this schema, on BOTH transports — including the Checkpoint History
 * note edit (the only current UI caller), and any future caller that starts
 * sending checkpoint totals through this channel. All fields are optional —
 * it is a partial update; `LotoCheckpointRepository.updateCheckpoint` already
 * no-ops on an empty payload.
 */
export const lotoCheckpointUpdateSchema = z.object({
  checkpoint_date: z.string().min(1).optional(),
  period_start: z.string().min(1).optional(),
  period_end: z.string().min(1).optional(),
  total_sales: z.number().nonnegative().optional(),
  total_commission: z.number().nonnegative().optional(),
  total_tickets: z.number().int().nonnegative().optional(),
  total_prizes: z.number().nonnegative().optional(),
  // INTEGER flag column (0/1), same convention as electron-app/schemas/
  // index.ts's SetUserActiveSchema — not a boolean, matching the
  // repository's `is_settled: number` type exactly.
  is_settled: z.union([z.literal(0), z.literal(1)]).optional(),
  settled_at: z.string().min(1).optional(),
  settlement_id: z.number().int().positive().optional(),
  // Bound matches lotoUpdateMetadataSchema's `note` below — same field, same
  // limit, kept in sync deliberately.
  note: z.string().max(500).optional(),
});

export const lotoCheckpointSettleSchema = z.object({
  id: z.number().int().positive(),
  totalSales: z.number().nonnegative(),
  totalCommission: z.number().nonnegative(),
  totalPrizes: z.number().nonnegative(),
  totalCashPrizes: z.number().optional(),
  settledAt: z.string().optional(),
  payments: z.array(checkpointPaymentSchema).optional(),
});

export const lotoCheckpointsSettleBatchSchema = z.object({
  checkpointIds: z
    .array(z.number().int().positive())
    .min(1, "At least one checkpoint required"),
  totalSales: z.number().nonnegative(),
  totalCommission: z.number().nonnegative(),
  settledAt: z.string().optional(),
  payment: z
    .object({
      method: z.string().min(1),
      drawer_name: z.string().min(1),
      currency_code: z.string().min(1),
      amount: z.number(), // can be negative (we pay out)
    })
    .optional(),
});

/**
 * Loto ticket metadata edit — a NARROWER sibling of `lotoTicketUpdateSchema`
 * above, mirroring what the `loto:update-metadata` IPC handler actually reads
 * (electron-app/handlers/lotoHandlers.ts: `{ id, note }`, no validation
 * beyond `requireRole` today). Kept separate from `lotoTicketUpdateSchema`
 * rather than reused, since that schema also accepts `ticket_number`/
 * `payment_method`/`currency`/`prize_paid_date` — fields this channel's
 * service call (`LotoService.updateLotoMetadata`) does not accept and would
 * silently drop.
 */
export const lotoUpdateMetadataSchema = z.object({
  id: z.number().int().positive(),
  note: z.string().max(500).optional(),
});

export type LotoSellInput = z.infer<typeof lotoSellSchema>;
export type LotoCashPrizeInput = z.infer<typeof lotoCashPrizeSchema>;
export type LotoTicketUpdateInput = z.infer<typeof lotoTicketUpdateSchema>;
export type LotoUpdateMetadataInput = z.infer<typeof lotoUpdateMetadataSchema>;
export type LotoFeeInput = z.infer<typeof lotoFeeSchema>;
export type LotoCheckpointCreateInput = z.infer<
  typeof lotoCheckpointCreateSchema
>;
export type LotoCheckpointUpdateInput = z.infer<
  typeof lotoCheckpointUpdateSchema
>;
export type LotoCheckpointSettleInput = z.infer<
  typeof lotoCheckpointSettleSchema
>;
export type LotoCheckpointsSettleBatchInput = z.infer<
  typeof lotoCheckpointsSettleBatchSchema
>;
