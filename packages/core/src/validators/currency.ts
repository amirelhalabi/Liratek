import { z } from "zod";

/**
 * Currency CRUD validation (LIRA-297, rule 14/21).
 *
 * ONE contract for `currencies:create` / `currencies:update` (IPC,
 * electron-app/handlers/currencyHandlers.ts) and `POST /api/currencies` /
 * `PUT /api/currencies/:id` (REST, backend/src/api/currencies.ts). Keys are
 * exactly what `CurrencyRepository.createCurrency`/`updateCurrency` read
 * (`CreateCurrencyData`/`UpdateCurrencyData`) — no key either transport
 * forwarded before is dropped (rule 23). Deliberately no `.transform()`:
 * the repository already upper-cases `code`, and normalising here would
 * change what is stored.
 */
export const createCurrencySchema = z.object({
  code: z.string().min(1, "Currency code is required"),
  name: z.string().min(1, "Currency name is required"),
  symbol: z.string().optional(),
  decimal_places: z.number().int().nonnegative().optional(),
});

/** The fields of a currency update. The id is NOT part of it: REST takes it
 *  from the URL, IPC destructures it off the payload before validating. */
export const updateCurrencySchema = z.object({
  code: z.string().min(1, "Currency code cannot be empty").optional(),
  name: z.string().min(1, "Currency name cannot be empty").optional(),
  symbol: z.string().optional(),
  decimal_places: z.number().int().nonnegative().optional(),
  is_active: z.number().int().min(0).max(1).optional(),
});

export type CreateCurrencyInput = z.infer<typeof createCurrencySchema>;
export type UpdateCurrencyInput = z.infer<typeof updateCurrencySchema>;
// What a caller SENDS (`z.input`) — the adapters type payloads with these.
export type CreateCurrencyPayload = z.input<typeof createCurrencySchema>;
export type UpdateCurrencyPayload = z.input<typeof updateCurrencySchema>;
