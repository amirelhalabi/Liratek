import { z } from "zod";
import { clientDayInputSchema } from "./common.js";

/**
 * Voucher (gift-card) validation schemas.
 *
 * Single source of truth for both transports (rule 14): the Electron IPC
 * `voucher:create` handler and the REST `POST /api/vouchers` route both
 * validate with this schema. Lifted from electron-app/schemas/index.ts.
 *
 * Only the create write-path is schema-validated; get-all/validate/cancel
 * take primitive args (filters object / code string / id) like their IPC
 * handlers. The money path (voucher redemption → customer-account credit)
 * runs inside parent sale/session transactions and is NOT part of this
 * config surface.
 */
/**
 * LIRA-339 — what can pay for a voucher (owner decisions 2026-10-24): the
 * drawer methods AND the customer's account (buying on credit books a
 * 'Voucher Debt'). GIFT_CARD is never accepted — a voucher cannot buy a
 * voucher.
 */
export const VOUCHER_SALE_METHODS = [
  "CASH",
  "OMT",
  "WHISH",
  "BINANCE",
  "CUSTOMER_ACCOUNT",
] as const;

/** The cash part of a cancel is paid back with drawer methods only; the
 *  on-account part goes back to the account, never as a payout leg. */
export const VOUCHER_REFUND_METHODS = ["CASH", "OMT", "WHISH", "BINANCE"] as const;

/**
 * A voucher sale leg. Same snake_case shape as every other flow's leg
 * (`holdMoneyPaymentLegSchema`, `salePaymentLegSchema`): `direction` absent
 * or "IN" = paid by the customer, "OUT" = change handed back
 * (`partitionLegs`, utils/payments.ts). `amount` is unconstrained so a UI row
 * mid-edit never fails the whole submission; the repository drops zero legs.
 */
export const voucherPaymentLegSchema = z.object({
  method: z.enum(VOUCHER_SALE_METHODS),
  currency_code: z.enum(["USD", "LBP"]),
  amount: z.number(),
  direction: z.enum(["IN", "OUT"]).optional(),
});

/** A cancel payout leg: drawer methods only, always money out. */
export const voucherRefundLegSchema = z.object({
  method: z.enum(VOUCHER_REFUND_METHODS),
  currency_code: z.enum(["USD", "LBP"]),
  amount: z.number(),
});

export type VoucherPaymentLegInput = z.infer<typeof voucherPaymentLegSchema>;
export type VoucherRefundLegInput = z.infer<typeof voucherRefundLegSchema>;

export const voucherCreateSchema = z.object({
  clientId: z.number().int().positive(),
  amount: z.number().positive(),
  currency: z.enum(["USD", "LBP"]).optional().default("USD"),
  expiryDate: z.string().min(1).optional().nullable(),
  note: z.string().optional().nullable(),
  /** LIRA-339: the tender legs (split, change, on account). Optional — a
   *  caller that omits it gets one CASH leg for the face value
   *  (VoucherRepository.sellVoucher, the Hold Money precedent). */
  payments: z.array(voucherPaymentLegSchema).optional(),
  /** The cashier's tender rate (LBP per USD), as on every other form. */
  exchange_rate: z.number().positive().optional(),
  /** Optional back-time, same rule as Hold Money. */
  transaction_time: z.string().optional(),
});

export type VoucherCreateInput = z.infer<typeof voucherCreateSchema>;

// LIRA-297 (rule 21) — what a caller SENDS: `z.input`, so `.default()`
// fields stay optional. The adapters (backendApi.ts, ElectronApiAdapter.ts,
// packages/ui ApiAdapter) type their payloads with these, never with a
// hand-copied object literal.
export type VoucherCreatePayload = z.input<typeof voucherCreateSchema>;

/**
 * LIRA-339 — `voucher:cancel(id, data?)` / `POST /api/vouchers/:id/cancel`.
 * `payments` pays back the CASH part of the sale (the on-account part is
 * reversed on the account, never paid out); omitted → one CASH leg for the
 * cash part. `client_day` is the shop's own day (rule 27), used to record
 * whether the voucher had expired.
 */
export const voucherCancelSchema = z.object({
  payments: z.array(voucherRefundLegSchema).optional(),
  exchange_rate: z.number().positive().optional(),
  client_day: clientDayInputSchema,
});

export type VoucherCancelInput = z.infer<typeof voucherCancelSchema>;
export type VoucherCancelPayload = z.input<typeof voucherCancelSchema>;
