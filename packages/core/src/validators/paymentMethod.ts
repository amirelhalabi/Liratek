import { z } from "zod";

/**
 * Payment-method CRUD validation (LIRA-297, rule 14/21).
 *
 * ONE contract for `payment-methods:create` / `payment-methods:update` (IPC,
 * electron-app/handlers/paymentMethodHandlers.ts) and `POST/PUT
 * /api/payment-methods` (REST, backend/src/api/paymentMethods.ts). Keys are
 * exactly what `PaymentMethodRepository.create`/`update` read
 * (`CreatePaymentMethodData`/`UpdatePaymentMethodData`). `sort_order` on
 * create is read by the repository and was forwarded raw by both transports
 * before this schema existed, so it is kept even though no screen sends it
 * (rule 23 — Zod strips unknown keys silently). `affects_drawer`/`is_active`
 * are the 0/1 integers the callers already send.
 */
const zeroOrOne = z.number().int().min(0).max(1);

export const createPaymentMethodSchema = z.object({
  code: z.string().min(1, "code, label, and drawer_name are required"),
  label: z.string().min(1, "code, label, and drawer_name are required"),
  drawer_name: z.string().min(1, "code, label, and drawer_name are required"),
  affects_drawer: zeroOrOne.optional(),
  sort_order: z.number().int().optional(),
});

export const updatePaymentMethodSchema = z.object({
  label: z.string().optional(),
  drawer_name: z.string().optional(),
  affects_drawer: zeroOrOne.optional(),
  is_active: zeroOrOne.optional(),
  sort_order: z.number().int().optional(),
});

export type CreatePaymentMethodInput = z.infer<
  typeof createPaymentMethodSchema
>;
export type UpdatePaymentMethodInput = z.infer<
  typeof updatePaymentMethodSchema
>;
// What a caller SENDS (`z.input`) — the adapters type payloads with these.
export type CreatePaymentMethodPayload = z.input<
  typeof createPaymentMethodSchema
>;
export type UpdatePaymentMethodPayload = z.input<
  typeof updatePaymentMethodSchema
>;
