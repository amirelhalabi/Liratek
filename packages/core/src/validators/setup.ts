import { z } from "zod";

/**
 * LIRA-297 item 3 (rule 21) — the first-run Setup wizard's finish payload
 * (`setup:complete`). Desktop-only: the wizard has no web counterpart, so
 * there is no REST route.
 *
 * TYPE CONTRACT ONLY — not wired as a validator. `setupHandlers.ts` checks the
 * required fields itself and answers with wizard-specific messages
 * ("Password must contain uppercase, lowercase, and a digit"); a Zod parse in
 * front of it would replace those with a generic "Validation failed: …".
 *
 * Keys the handler reads: everything below except `drawer_amounts` and
 * `drawer_currency_config`. Those two travel on the wire because the wizard
 * sends its whole state, but the handler ignores them — `StepComplete.tsx`
 * applies them itself after logging in (initial checkpoint + drawer
 * currencies). Not `.strict()`: the wizard state also carries UI-only keys
 * (`modules_defaults_applied`, `database_path`, `join_db_path`, …).
 */
export const completeSetupSchema = z.object({
  shop_name: z.string(),
  admin_username: z.string(),
  admin_password: z.string(),
  base_system: z.enum(["OMT", "WHISH"]).optional(),
  enabled_modules: z.array(z.string()),
  enabled_payment_methods: z.array(z.string()),
  session_management_enabled: z.boolean(),
  customer_sessions_enabled: z.boolean(),
  active_currencies: z.array(z.string()).optional(),
  extra_users: z
    .array(
      z.object({
        username: z.string(),
        password: z.string(),
        role: z.string(),
      }),
    )
    .optional(),
  whatsapp_phone: z.string().optional(),
  whatsapp_api_key: z.string().optional(),
  drawer_amounts: z
    .array(
      z.object({
        drawer_name: z.string(),
        currency_code: z.string(),
        amount: z.number(),
      }),
    )
    .optional(),
  drawer_currency_config: z
    .array(
      z.object({
        drawer_name: z.string(),
        currency_codes: z.array(z.string()),
      }),
    )
    .optional(),
  carrier_lines: z
    .array(
      z.object({
        carrier: z.enum(["mtc", "alfa"]),
        phone_number: z.string(),
        label: z.string().nullable().optional(),
        credits: z.number().optional(),
        validity_expires_at: z.string().nullable().optional(),
      }),
    )
    .optional(),
});

export type CompleteSetupInput = z.input<typeof completeSetupSchema>;
