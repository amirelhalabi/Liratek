import { z } from "zod";

/**
 * LIRA-377 web shop restore (Settings › Backup › Restore) — the request
 * contracts of `backend/src/api/restore.ts` (`specs/377-shop-restore/contracts/rest.md`).
 *
 * A leaf: imports only zod, so `browser.ts` can re-export it (rule 29) and
 * the frontend adapter derives its payload types from it (rule 21).
 *
 * `clientTzOffsetMin` is the BROWSER's UTC offset in minutes (east positive,
 * e.g. Beirut summer = 180): the server runs in UTC on Fly, so anything it
 * shows "in the shop's time" (preview dates, the owner email) must use the
 * offset the client sends, never the server's own zone (rule 27). Real zones
 * span UTC−12:00 … UTC+14:00, i.e. ±840 minutes.
 */
const clientTzOffsetMinField = z
  .number()
  .int("clientTzOffsetMin must be a whole number of minutes")
  .min(-840, "clientTzOffsetMin must be between -840 and 840")
  .max(840, "clientTzOffsetMin must be between -840 and 840");

const restoreIdField = z.number().int().positive();

/** POST /api/restore/prepare — restore to a moment, or undo a restore. */
export const prepareRestoreSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("time"),
    /** The instant to restore to, ISO-8601 in UTC (`…Z`, no offset). */
    restoredTo: z
      .string()
      .datetime({ message: "restoredTo must be an ISO-8601 UTC date and time ending in Z" }),
    clientTzOffsetMin: clientTzOffsetMinField,
  }),
  z.object({
    kind: z.literal("undo"),
    /** The restore whose before-copy is put back. */
    restoreId: restoreIdField,
    clientTzOffsetMin: clientTzOffsetMinField,
  }),
]);

export type PrepareRestoreInput = z.infer<typeof prepareRestoreSchema>;
/** What a caller SENDS (rule 21). */
export type PrepareRestorePayload = z.input<typeof prepareRestoreSchema>;

/** POST /api/restore/confirm — the admin types the shop's name to confirm. */
export const confirmRestoreSchema = z.object({
  restoreId: restoreIdField,
  typedShopName: z
    .string()
    .min(1, "Type the shop's name to confirm")
    .max(200, "typedShopName is too long"),
});

export type ConfirmRestoreInput = z.infer<typeof confirmRestoreSchema>;
export type ConfirmRestorePayload = z.input<typeof confirmRestoreSchema>;

/** POST /api/restore/cancel — drop a prepared (not yet confirmed) restore. */
export const cancelRestoreSchema = z.object({
  restoreId: restoreIdField,
});

export type CancelRestoreInput = z.infer<typeof cancelRestoreSchema>;
export type CancelRestorePayload = z.input<typeof cancelRestoreSchema>;

/**
 * POST /api/restore/file — the body is the raw file, so the offset arrives
 * on the query string as text and is coerced. Same bounds as the JSON field.
 */
export const restoreFileQuerySchema = z.object({
  clientTzOffsetMin: z.coerce
    .number()
    .int("clientTzOffsetMin must be a whole number of minutes")
    .min(-840, "clientTzOffsetMin must be between -840 and 840")
    .max(840, "clientTzOffsetMin must be between -840 and 840"),
});

export type RestoreFileQuery = z.infer<typeof restoreFileQuerySchema>;
export type RestoreFileQueryPayload = z.input<typeof restoreFileQuerySchema>;
