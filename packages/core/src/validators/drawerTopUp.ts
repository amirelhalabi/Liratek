import { z } from "zod";

/**
 * Drawer top-up validation (LIRA-297, rule 14/21).
 *
 * `drawerTopUpCreateSchema` is lifted VERBATIM from
 * electron-app/schemas/index.ts's `DrawerTopUpCreateSchema` (same keys, same
 * `.default(0)`s, same refines, same messages) so `drawer-topup:create` (IPC)
 * and `POST /api/drawer-topup` (REST) refuse the exact same payloads. Before
 * this, REST only did `Number(x) || 0`, so e.g. a negative USD amount next to
 * a positive LBP one passed on the web while desktop refused it.
 *
 * External (Cash In) mode only accepts `extra_currencies`; each entry's keys
 * are exactly what DrawerTopUpService/DrawerTopUpRepository read
 * (currency_code, amount, acquisition_usd_per_unit,
 * market_usd_per_unit_hint — see CreateDrawerTopUpData's doc for the
 * cost-basis resolution order). Codes are deliberately NOT `.transform()`ed:
 * the service upper-cases them.
 */
export const drawerTopUpCreateSchema = z
  .object({
    amount_usd: z.number().nonnegative().default(0),
    amount_lbp: z.number().nonnegative().default(0),
    extra_currencies: z
      .array(
        z.object({
          currency_code: z.string().trim().min(1).max(10),
          amount: z.number().positive(),
          acquisition_usd_per_unit: z.number().positive().optional(),
          market_usd_per_unit_hint: z.number().positive().optional(),
        }),
      )
      .optional(),
    notes: z.string().optional(),
    transaction_time: z.string().optional(),
  })
  .refine(
    (d) =>
      d.amount_usd > 0 ||
      d.amount_lbp > 0 ||
      (d.extra_currencies?.some((e) => e.amount > 0) ?? false),
    {
      message:
        "At least one amount (USD, LBP, or another currency) must be greater than zero.",
    },
  )
  .refine(
    (d) => {
      const codes = (d.extra_currencies ?? []).map((e) =>
        e.currency_code.toUpperCase(),
      );
      return new Set(codes).size === codes.length;
    },
    { message: "Duplicate currency in extra_currencies." },
  );

/**
 * Top-up of General FROM another named drawer (`drawer-topup:create-from-
 * drawer` / `POST /api/drawer-topup/from-drawer`). USD/LBP only (see
 * CreateDrawerTopUpFromDrawerData). Keys are the union both transports
 * forwarded before any schema existed — REST forwarded `transaction_time`,
 * IPC forwarded its whole payload. Same nonnegative + at-least-one rule as
 * the create schema above; a negative amount used to be accepted on both
 * transports and stored on the top-up row while the posting loop skipped it.
 */
export const drawerTopUpFromDrawerSchema = z
  .object({
    amount_usd: z.number().nonnegative().default(0),
    amount_lbp: z.number().nonnegative().default(0),
    source_drawer: z.string().min(1, "source_drawer is required"),
    notes: z.string().optional(),
    transaction_time: z.string().optional(),
  })
  .refine((d) => d.amount_usd > 0 || d.amount_lbp > 0, {
    message: "At least one amount (USD or LBP) must be greater than zero.",
  });

export type DrawerTopUpCreateInput = z.infer<typeof drawerTopUpCreateSchema>;
export type DrawerTopUpFromDrawerInput = z.infer<
  typeof drawerTopUpFromDrawerSchema
>;
// What a caller SENDS (`z.input`, so `.default(0)` amounts stay optional) —
// the adapters type payloads with these.
export type DrawerTopUpCreatePayload = z.input<typeof drawerTopUpCreateSchema>;
export type DrawerTopUpFromDrawerPayload = z.input<
  typeof drawerTopUpFromDrawerSchema
>;
