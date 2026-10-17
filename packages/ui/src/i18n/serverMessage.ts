/**
 * LIRA-331 (contracts/error-envelope.md rule 6): shows a server refusal in the
 * user's language without the server knowing the language (rule 27).
 *
 * - `messageKey` present and known in the `server` namespace → translated,
 *   with numeric params formatted on the client (`en-US`, FR-016).
 * - Otherwise → the server's English `error`, unchanged.
 *
 * P1 has no keyed refusals yet (P2, T070–T083), so today this always returns
 * `error`; converted code can already call it. Pure: takes `t` as an argument.
 */
import { formatNumber } from "./format";

export interface ServerRefusal {
  error?: unknown;
  messageKey?: string;
  messageParams?: Record<string, string | number>;
}

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

export function translateServerError(
  refusal: ServerRefusal,
  t: TranslateFn,
  fallback = "Something went wrong",
): string {
  const english =
    typeof refusal.error === "string" && refusal.error ? refusal.error : fallback;
  const key = refusal.messageKey;
  if (!key) return english;
  const fullKey = `server:${key}`;
  const params: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(refusal.messageParams ?? {})) {
    params[name] = typeof value === "number" ? formatNumber(value) : value;
  }
  const translated = t(fullKey, { ...params, defaultValue: "" });
  return translated && translated !== fullKey && translated !== key
    ? translated
    : english;
}
