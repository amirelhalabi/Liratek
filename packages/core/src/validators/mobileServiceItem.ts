import { z } from "zod";

/**
 * Mobile Service Item — UPDATE path (LIRA W6.b, extended by LIRA-090).
 *
 * The rest of this feature (create/delete/toggle/seed/list) predates the
 * dual-transport rule and is left desktop-IPC-only (pre-existing gap, not
 * introduced here — see the W6 report). This schema guards the ONE path W6.b
 * touches: editing an item's price/label/sort/active fields plus the
 * structured `validity_days`/`credits` — shared by the IPC handler and the
 * REST route (CLAUDE.md rule 14/19).
 *
 * LIRA-090 (v140) extends it with the three Only-Days split columns
 * (`days_cost_lbp`, `sell_days_lbp`, `sell_credit_lbp`). All three are
 * nullable/optional at the schema level — the split-consistency rule (an
 * item that sets `days_cost_lbp` must have it be a positive number less
 * than `cost_lbp`) is a business rule, not a shape rule, and is enforced by
 * `MobileServiceItemService` via `isTelecomSplitComplete`
 * (utils/telecomCredit.ts), not here (rule 14 — one definition, reused
 * everywhere).
 */
export const mobileServiceItemUpdateSchema = z.object({
  id: z.number().int().positive(),
  label: z.string().trim().min(1).optional(),
  cost_lbp: z.number().nonnegative().optional(),
  sell_lbp: z.number().nonnegative().optional(),
  sort_order: z.number().int().optional(),
  is_active: z.number().int().min(0).max(1).optional(),
  /** Structured validity (days) — nullable to allow clearing a previously-set value. */
  validity_days: z.number().int().nonnegative().nullable().optional(),
  /** Structured credit amount (USD) — nullable to allow clearing. */
  credits: z.number().nonnegative().nullable().optional(),
  /**
   * LIRA-090 (v140): LBP cost attributable to validity days alone (spec
   * §2.3). Nullable to allow clearing a previously-configured split.
   */
  days_cost_lbp: z.number().nonnegative().nullable().optional(),
  /**
   * LIRA-090 (v140): customer price when only the days are sold — the
   * Only-Days sale-time default (spec §5.1). Nullable to allow clearing.
   */
  sell_days_lbp: z.number().nonnegative().nullable().optional(),
  /**
   * LIRA-090 (v140): decision-aid display price for resold recovered
   * credit (spec §2.4). Nullable to allow clearing.
   */
  sell_credit_lbp: z.number().nonnegative().nullable().optional(),
  /**
   * v160: per-card override of the returnable credit maximum. Nullable to
   * allow clearing back to the computed value.
   *
   * Shape only. The real constraint is a CROSS-FIELD one —
   * `isValidMaxReturnedOverride(value, credits)` — and it cannot live here:
   * an update carrying only this field has no `credits` to bound against, so
   * a schema check would pass anything on the exact payload the Settings
   * screen sends most often. `MobileServiceItemService` reads the stored row
   * and enforces the bound in BOTH directions (rule 14 — the cap arithmetic
   * itself is never re-encoded, only called).
   */
  max_returned_credits_usd: z.number().positive().nullable().optional(),
});

export type MobileServiceItemUpdateInput = z.infer<
  typeof mobileServiceItemUpdateSchema
>;

/**
 * Mobile Service Item — CREATE path (LIRA-090, authored from scratch — no
 * create schema existed before this ticket; `mobileServiceItemHandlers.ts`'s
 * `mobile-service-items:create` IPC handler took an unvalidated
 * `CreateMobileServiceItemData` payload directly).
 *
 * Covers every field the Settings catalog manager
 * (`MobileServicesManager.tsx`) and the inline "add item" forms
 * (`KatchForm.tsx`, `FinancialForm.tsx`) send today (`provider`, `category`,
 * `subcategory`, `label`, `cost_lbp`, `sell_lbp`, `sort_order`,
 * `validity_days`, `credits`), plus the three LIRA-090 split columns so both
 * transports (rule 19b) accept a fully-configured Only-Days item in one
 * call once the Settings UI grows the split fields (Phase 6 — not yet
 * wired at the time this schema was authored). As with the UPDATE schema,
 * split-consistency (`days_cost_lbp` present ⇒ positive and less than
 * `cost_lbp`) is a business rule enforced by `MobileServiceItemService`
 * via `isTelecomSplitComplete`, not a shape constraint here (rule 14).
 */
export const mobileServiceItemCreateSchema = z.object({
  provider: z.string().trim().min(1, "Provider is required"),
  category: z.string().trim().min(1, "Category is required"),
  subcategory: z.string().trim().min(1, "Subcategory is required"),
  label: z.string().trim().min(1, "Label is required"),
  cost_lbp: z.number().nonnegative(),
  sell_lbp: z.number().nonnegative(),
  sort_order: z.number().int().optional(),
  is_active: z.number().int().min(0).max(1).optional(),
  /** Structured validity (days). Null when not applicable. */
  validity_days: z.number().int().nonnegative().nullable().optional(),
  /** Structured credit amount (USD). Null when not applicable. */
  credits: z.number().nonnegative().nullable().optional(),
  /** LIRA-090 (v140) — see `mobileServiceItemUpdateSchema.days_cost_lbp`. */
  days_cost_lbp: z.number().nonnegative().nullable().optional(),
  /** LIRA-090 (v140) — see `mobileServiceItemUpdateSchema.sell_days_lbp`. */
  sell_days_lbp: z.number().nonnegative().nullable().optional(),
  /** LIRA-090 (v140) — see `mobileServiceItemUpdateSchema.sell_credit_lbp`. */
  sell_credit_lbp: z.number().nonnegative().nullable().optional(),
  /** v160 — see `mobileServiceItemUpdateSchema.max_returned_credits_usd`. */
  max_returned_credits_usd: z.number().positive().nullable().optional(),
});

export type MobileServiceItemCreateInput = z.infer<
  typeof mobileServiceItemCreateSchema
>;

/**
 * The fresh-install catalog seed payload — an array of create-shaped items,
 * exactly what `parseCatalogToSeedData()` produces.
 *
 * DEFINED HERE, NOT IN `electron-app/schemas/index.ts`, and that is
 * load-bearing. The re-export pattern casts core schemas across the zod-major
 * boundary (`as unknown as z.ZodSchema<T>`), which satisfies the compiler but
 * produces an object that ELECTRON's zod cannot introspect. Wrapping a cast
 * schema in electron's own `z.array(...)` therefore builds an array validator
 * whose element parser belongs to a different zod instance, and it explodes at
 * runtime with `def.type._parseSync is not a function`.
 *
 * That is not hypothetical: it shipped in this branch and was caught by the
 * lira-132 e2e. The seed IPC returned that error for EVERY fresh install, and
 * `MobileServiceItemsContext.load()` swallows failures silently, so the only
 * symptom was a completely empty telecom catalog with nothing logged. Unit
 * tests could not see it — both zods agree inside a single package; only the
 * real IPC boundary crosses them.
 *
 * Building the array here keeps element and wrapper in the SAME zod, so the
 * single cast at the electron-app re-export is applied to an already-complete
 * validator rather than to one of its parts.
 */
export const mobileServiceItemSeedSchema = z.array(
  mobileServiceItemCreateSchema,
);

export type MobileServiceItemSeedInput = z.infer<
  typeof mobileServiceItemSeedSchema
>;
