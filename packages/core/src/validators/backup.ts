import { z } from "zod";

/**
 * Web "Download backup" (Settings › Backup) — GET /api/backup/download query.
 *
 * `stamp` is the BROWSER's local date and time (`YYYY-MM-DD-HHmm`), used in
 * the file name: the server runs in UTC on Fly, so its own clock would name
 * a 01:30 Beirut backup after the previous day (rule 27). The strict pattern
 * also keeps anything path-like out of the file name. Absent → the server's
 * time is the fallback.
 */
export const shopBackupQuerySchema = z.object({
  stamp: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}-\d{4}$/, "stamp must look like YYYY-MM-DD-HHmm")
    .optional(),
});

export type ShopBackupQuery = z.infer<typeof shopBackupQuerySchema>;
/** What a caller SENDS (rule 21). */
export type ShopBackupPayload = z.input<typeof shopBackupQuerySchema>;
