import { z } from "zod";
import {
  positiveDecimalSchema,
  positiveIntegerSchema,
  optionalPhoneNumberSchema,
  transactionTimeSchema,
  clientDayInputSchema,
  extraChargeFields,
  discountAndExtraNotBoth,
  extraNotBothRefineOptions,
} from "./common.js";
import {
  normalizeLineNumber,
  stripPhoneFormatting,
} from "../utils/phoneNumber.js";
import { warrantyMonthsSchema } from "./productUnit.js";

/**
 * Maintenance job validation schemas
 */

/**
 * The ONE maintenance phone normaliser (rule 14): the save schema stores the
 * typed phone in this form, and `MaintenanceRepository.findOrCreateClient`
 * matches existing clients by it — normalising BOTH the typed phone and each
 * client's stored free-text `phone_number` — so "03 123 456",
 * "+961 3 123 456" and "03123456" are the same line. Returns `""` for a
 * blank input; callers must treat `""` as "no phone", never as a match.
 */
export function normalizeMaintenancePhone(
  raw: string | null | undefined,
): string {
  if (!raw) return "";
  return stripPhoneFormatting(normalizeLineNumber(raw));
}

const paymentLineSchema = z.object({
  method: z.string().min(1),
  currency_code: z.string().min(1),
  amount: z.number(),
  // Change-to-account (2026-10-13): the shared CheckoutModal sends change the
  // cashier did not hand back as an OUT `CUSTOMER_ACCOUNT` leg. Without this
  // key Zod stripped `direction` and the OUT leg arrived as IN (rule 23).
  // Absent = IN (`partitionLegs`).
  direction: z.enum(["IN", "OUT"]).optional(),
});

const maintenancePartSchema = z.object({
  id: positiveIntegerSchema.optional(),
  product_id: positiveIntegerSchema,
  quantity: positiveIntegerSchema,
  unit_price_usd: z.number().min(0).optional(),
});

/** LIRA-319 — a repair's extra is in the job's own currency (the checkout
 *  total's currency): `extra_usd` on a USD job, `extra_lbp` on an LBP job. */
export const MAINTENANCE_EXTRA_CURRENCY_MESSAGE =
  "A repair's extra is in the job's currency — enter it in that currency.";

/**
 * LIRA-319 — the discount a save carries, for "a discount or an extra, never
 * both". A USD job has a real `discount_usd` column; an LBP job has none —
 * the checkout folds its discount into `final_amount_lbp`, so it is
 * `price_lbp − final_amount_lbp` (the same reconstruction the page uses,
 * `computeFinalAmount`). The ONE definition (rule 14), shared by the schema
 * refine and `MaintenanceService.saveJob`.
 */
export function maintenanceDiscountOf(job: {
  currency?: string | undefined;
  discount_usd?: number | undefined;
  price_lbp?: number | undefined;
  final_amount_lbp?: number | undefined;
}): number {
  if (job.currency === "LBP") {
    if (job.price_lbp == null || job.final_amount_lbp == null) return 0;
    return Math.max(0, job.price_lbp - job.final_amount_lbp);
  }
  return job.discount_usd ?? 0;
}

/** LIRA-319 — true when the extra is in the job's currency (or absent). */
export function maintenanceExtraInJobCurrency(job: {
  currency?: string | undefined;
  extra_usd?: number | undefined;
  extra_lbp?: number | undefined;
}): boolean {
  return job.currency === "LBP"
    ? !((job.extra_usd ?? 0) > 0)
    : !((job.extra_lbp ?? 0) > 0);
}

export const saveMaintenanceJobSchema = z
  .object({
    id: positiveIntegerSchema.optional(), // For updates
    device_name: z.string().min(1).max(255),
    client_id: positiveIntegerSchema.optional(),
    client_name: z.string().max(255).optional(),
    // Blank is a valid "no phone left" state — the maintenance form always
    // sends `""` (never omits the key) when the field is empty. See
    // `optionalPhoneNumberSchema`'s doc comment / recharge.ts's identical note.
    //
    // LIRA-246b: a phone typed "03 123 456" or "+961 3 654 321" (both formats
    // the live form accepts) was rejected outright by `optionalPhoneNumberSchema`
    // (`/^\+?[0-9]{8,15}$/`, no tolerance for spaces) with "Invalid phone number
    // format" — on REST this 400'd before the service ever ran. Normalize with
    // `normalizeLineNumber` (the "keep the leading 0" canonical-storage
    // normalizer, note #13) BEFORE the regex check, via `.transform().pipe(...)`
    // — an empty string / undefined pass through unchanged (falsy guard below),
    // so `optionalPhoneNumberSchema`'s blank/omitted cases are untouched.
    //
    // LIRA-263: a reopened job now pre-fills its Phone field from the linked
    // client's stored `phone_number` (MaintenanceRepository.getJobs), and
    // other modules store that number as free text — so the value coming back
    // can carry formatting `normalizeLineNumber` leaves alone (it returns
    // anything that isn't a 7/8-digit Lebanese local number unchanged, spaces
    // and all: "961 70 123 456", "+44 20 7946 0958", "(03) 123456"). Strip
    // spaces, dashes, dots and brackets afterwards so formatting alone never
    // makes a resave of that job fail "Invalid phone number format". Digits
    // and a leading "+" are untouched; anything else still fails the regex.
    client_phone: z
      .string()
      .optional()
      .transform((v) => (v ? normalizeMaintenancePhone(v) : v))
      .pipe(optionalPhoneNumberSchema),
    issue_description: z.string().max(1000).optional(),
    cost_usd: z.number().min(0).optional(),
    price_usd: positiveDecimalSchema,
    cost_lbp: z.number().min(0).optional(),
    price_lbp: z.number().min(0).optional(),
    currency: z.enum(["USD", "LBP"]).optional().default("USD"),
    discount_usd: z.number().min(0).optional(),
    final_amount_usd: positiveDecimalSchema.optional(),
    final_amount_lbp: z.number().min(0).optional(),
    paid_usd: z.number().min(0).optional(),
    paid_lbp: z.number().min(0).optional(),
    exchange_rate: z.number().min(0).optional(),
    status: z
      .enum(["Received", "In_Progress", "Ready", "Delivered", "Delivered_Paid"])
      .default("Received"),
    paid_by: z.string().optional(),
    note: z.string().max(1000).optional(),
    payments: z.array(paymentLineSchema).optional(),
    change_given_usd: z.number().min(0).optional(),
    change_given_lbp: z.number().min(0).optional(),
    // T3 keep-change (docs/plans/done_plans/T3_KEEP_CHANGE_PLAN.md KC-3): kept (not
    // returned) change per currency → added to the transaction's profit stamp.
    kept_change_usd: z.number().nonnegative().optional(),
    kept_change_lbp: z.number().nonnegative().optional(),
    transaction_time: transactionTimeSchema,
    // MUST stay .optional() with NO .default([]) — an omitted `parts` key means
    // "leave the job's parts untouched", and a default of [] would turn every
    // legacy payload (and every status-transition resave, which sends no parts
    // key) into "delete all parts", silently wiping parts and leaking stock.
    parts: z.array(maintenancePartSchema).optional(),
    // LIRA-296 (user story 5) — the repair's own warranty, in months (0–60;
    // null clears it). Omitted = leave the job's value untouched. The end day
    // is stamped once, when the job reaches Delivered_Paid.
    warranty_months: warrantyMonthsSchema.nullable().optional(),
    // LIRA-296 (rule 27) — the shop's own day: the repair warranty starts on
    // it. Omitted: the request's day (clientDay()).
    client_day: clientDayInputSchema,
    // LIRA-319: the extra the cashier added on top of the checkout total, in
    // the job's currency. Optional with NO default (offline replay, research
    // R4). Never with a discount; an extra above the pre-extra total or on a
    // session-basket job is refused by `MaintenanceRepository.processPayments`
    // (the cap needs the parts total, known only after the parts sync).
    ...extraChargeFields,
  })
  .refine(
    (d) => discountAndExtraNotBoth(d, maintenanceDiscountOf(d)),
    extraNotBothRefineOptions,
  )
  .refine(maintenanceExtraInJobCurrency, {
    message: MAINTENANCE_EXTRA_CURRENCY_MESSAGE,
    path: ["extra_usd"],
  });

export const getMaintenanceJobsSchema = z.object({
  status: z
    .enum([
      "All",
      "Received",
      "In_Progress",
      "Ready",
      "Delivered",
      "Delivered_Paid",
    ])
    .optional(),
});

export const getMaintenanceStatusHistorySchema = z.object({
  id: positiveIntegerSchema,
});

/**
 * LIRA-306 (rule 23 lift) — `maintenance:delete(id)` / `DELETE
 * /api/maintenance/jobs/:id`. Coerced: the REST id is a URL param string; the
 * IPC handler passes a number. Named `{ id }` = the channel's argNames.
 */
export const maintenanceIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});
export type MaintenanceIdParamInput = z.input<typeof maintenanceIdParamSchema>;

/**
 * LIRA-306 (rule 23 lift) — `maintenance:update-metadata` /
 * `POST /api/maintenance/update-metadata`. Keys = the preload binding's
 * `data` type = the four fields the handler forwards to
 * `MaintenanceService.updateMaintenanceMetadata` (+ `id`); nothing dropped.
 * Length caps only — the handler validated nothing before, so no `min(1)`
 * that would refuse an edit the desktop books today.
 */
export const maintenanceUpdateMetadataSchema = z.object({
  id: z.number().int().positive(),
  client_name: z.string().max(255).optional(),
  device_name: z.string().max(255).optional(),
  issue_description: z.string().max(1000).optional(),
  note: z.string().max(1000).optional(),
});
/** Adapter payload type (rule 21). Type-only, reachable from `browser.ts`. */
export type MaintenanceUpdateMetadataInput = z.input<
  typeof maintenanceUpdateMetadataSchema
>;

export type SaveMaintenanceJobInput = z.infer<typeof saveMaintenanceJobSchema>;
/** What a caller SENDS to `maintenance:save` / `POST /api/maintenance/jobs`
 *  (pre-parse, so defaulted keys are optional) — the adapter payload type
 *  (CLAUDE.md rule 21). Type-only, reachable from `browser.ts` via
 *  `validators/index.ts` (rule 29). */
export type SaveMaintenanceJobPayload = z.input<
  typeof saveMaintenanceJobSchema
>;
export type GetMaintenanceJobsInput = z.infer<typeof getMaintenanceJobsSchema>;
export type GetMaintenanceStatusHistoryInput = z.infer<
  typeof getMaintenanceStatusHistorySchema
>;
