import { z } from "zod";

/**
 * LIRA-297 item 3 (rule 14/21) — save or replace the picture shown for one
 * mobile-service item (`voucher-images:set` / `POST /api/voucher-images`).
 * One schema for both transports. The four keys are exactly what both the
 * IPC handler and the REST route forward to `VoucherImageService.setImage`;
 * all are required and non-empty, matching the REST route's existing
 * "Missing required fields" check.
 */
export const setVoucherImageSchema = z.object({
  provider: z.string().min(1),
  category: z.string().min(1),
  itemKey: z.string().min(1),
  imageData: z.string().min(1),
});

export type SetVoucherImageInput = z.input<typeof setVoucherImageSchema>;
