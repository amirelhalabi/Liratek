import { z } from "zod";

/**
 * Hold-money create contract — shared by the Electron IPC handler
 * (hold-money:create) and the REST route (POST /api/hold-money) so both
 * validate against ONE schema (rule 14). Lifted verbatim from
 * electron-app/schemas/index.ts.
 */
export const holdMoneyCreateSchema = z
  .object({
    client_name: z.string().trim().min(1, "Customer name is required"),
    phone_number: z.string().optional(),
    // .finite() rejects Infinity (e.g. "1e999" coerces to Infinity) so a
    // non-finite amount can never reach the drawer balance and corrupt it.
    usd_amount: z.coerce.number().finite().nonnegative().default(0),
    lbp_amount: z.coerce.number().finite().nonnegative().default(0),
    notes: z.string().optional(),
    transaction_time: z.string().optional(),
  })
  .refine((d) => (d.usd_amount ?? 0) > 0 || (d.lbp_amount ?? 0) > 0, {
    message: "At least one of USD or LBP amount is required",
    path: ["usd_amount"],
  });

export type HoldMoneyCreateInput = z.infer<typeof holdMoneyCreateSchema>;
