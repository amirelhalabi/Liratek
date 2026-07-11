import { z } from "zod";

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
export const voucherCreateSchema = z.object({
  clientId: z.number().int().positive(),
  amount: z.number().positive(),
  currency: z.enum(["USD", "LBP"]).optional().default("USD"),
  expiryDate: z.string().min(1).optional().nullable(),
  note: z.string().optional().nullable(),
});

export type VoucherCreateInput = z.infer<typeof voucherCreateSchema>;
