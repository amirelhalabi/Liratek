import { z } from "zod";

/**
 * Stock adjustment (LIRA-077): manual set-absolute (newQuantity) or delta
 * correction, always carrying an operator-supplied reason for the
 * `stock_adjustments` audit trail (migration v132). `id` is included so the
 * IPC transport (which sends one payload object) and the REST transport
 * (which merges its URL `:id` param into the same shape before validating)
 * share ONE schema (CLAUDE.md rule 14/19).
 *
 * `userId` is intentionally NOT part of this schema — it is injected
 * server-side from the authenticated session (IPC: auth.userId from
 * requireRole; REST: req.user.userId from the JWT), never trusted from the
 * client body (rule 19c).
 */
export const stockAdjustSchema = z
  .object({
    id: z.number().int().positive(),
    newQuantity: z.number().int().nonnegative().optional(),
    delta: z.number().int().optional(),
    reason: z.string().trim().min(1, "Reason is required").max(500),
  })
  .refine((d) => d.newQuantity !== undefined || d.delta !== undefined, {
    message: "Either newQuantity or delta must be provided",
    path: ["newQuantity"],
  })
  .refine((d) => !(d.newQuantity !== undefined && d.delta !== undefined), {
    message: "Provide either newQuantity or delta, not both",
    path: ["delta"],
  });

export type StockAdjustInput = z.infer<typeof stockAdjustSchema>;

/**
 * Receive stock for an existing product (Supplier Stock Intake,
 * SUPPLIER_STOCK_INTAKE_PLAN.md) — shared by the IPC handler and the REST
 * route feeding `InventoryService.receiveStock` (rule 19b, one schema).
 *
 * `supplier` is optional/nullable: a blank/absent supplier means "no
 * supplier" and the intake can only ever create a batch, never book a
 * ledger debit (`ProductRepository.shouldBookIntakeDebt`). `is_old_stock`
 * defaults to `false` — "yes, book the debit" is the common case; the
 * checkbox exists to opt OUT of booking for pre-existing inventory being
 * backfilled, not to opt in.
 *
 * `userId` is intentionally NOT part of this schema — same convention as
 * `stockAdjustSchema` above: it is injected server-side from the
 * authenticated session (IPC: auth.userId from requireRole; REST:
 * req.user.userId from the JWT), never trusted from the client body
 * (rule 19c).
 */
export const receiveStockSchema = z.object({
  product_id: z.number().int().positive(),
  quantity: z.number().int().positive(),
  unit_cost_usd: z.number().nonnegative(),
  supplier: z.string().trim().max(200).optional().nullable(),
  is_old_stock: z.boolean().default(false),
  reason: z.string().trim().max(500).optional(),
});

export type ReceiveStockInput = z.infer<typeof receiveStockSchema>;

/** Query/param shape for the stock-adjustment history read (both transports). */
export const getStockAdjustmentsSchema = z.object({
  productId: z.number().int().positive().optional(),
});

export type GetStockAdjustmentsInput = z.infer<
  typeof getStockAdjustmentsSchema
>;
