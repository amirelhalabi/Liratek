/**
 * LIRA-329 — the MTC / Alfa payload fields the transaction keeps in its
 * details (informational only; no money step reads them). One definition
 * shared by every submit path — the direct sale, the session-basket item and
 * the For-Partner sale — so each payload is built the same way (rules 14/22).
 * Field names and types come from the shared schema (rule 21).
 */
import type { CreateRechargePayload } from "@liratek/core";
import { ALFA_GIFT_TIERS } from "../types";

type DetailFields = Pick<
  CreateRechargePayload,
  "clientPhone" | "giftTier" | "daysTypedUsd"
>;

function typedUsd(raw: string): number | undefined {
  const n = parseFloat(raw);
  return Number.isFinite(n) && n >= 0 && raw.trim() !== "" ? n : undefined;
}

/** The customer's phone typed next to the name (omitted when empty). */
export function clientPhoneField(phone: string): DetailFields {
  const trimmed = phone.trim();
  return trimmed ? { clientPhone: trimmed } : {};
}

/** The Alfa Gift tier picked, with the label shown for it. */
export function giftTierField(key: string): DetailFields {
  if (!key) return {};
  const tier = (ALFA_GIFT_TIERS as Record<string, { label: string }>)[key];
  return { giftTier: { key, ...(tier ? { label: tier.label } : {}) } };
}

/** Days: the cost and the price exactly as typed in USD (each omitted when
 *  not typed in dollars). */
export function daysTypedUsdField(
  costUsd: string,
  priceUsd: string,
): DetailFields {
  const cost = typedUsd(costUsd);
  const price = typedUsd(priceUsd);
  if (cost === undefined && price === undefined) return {};
  return {
    daysTypedUsd: {
      ...(cost !== undefined ? { costUsd: cost } : {}),
      ...(price !== undefined ? { priceUsd: price } : {}),
    },
  };
}
