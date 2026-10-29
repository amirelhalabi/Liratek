import type { TFunction } from "i18next";
import type {
  FulfillmentStatus,
  InsuranceType,
  WorkStatus,
} from "@liratek/core";

/**
 * LIRA-331: category, work-status and fulfilment CODES are stored, sent and
 * compared as-is; only their label is translated, here, at render time.
 */
const CATEGORY_CODES = [
  "digital_account",
  "repair",
  "activation",
  "other",
  "hold_money",
  "insurance",
] as const;

type CategoryCode = (typeof CATEGORY_CODES)[number];

function isCategoryCode(code: string): code is CategoryCode {
  return (CATEGORY_CODES as readonly string[]).includes(code);
}

/** A category's label; an unknown (shop-made) code is shown capitalised. */
export function categoryLabel(
  code: string,
  t: TFunction<"customServices">,
): string {
  if (isCategoryCode(code)) return t(`categories.${code}`);
  return code.charAt(0).toUpperCase() + code.slice(1);
}

/** A work status's label ("In_Progress" → "In Progress"). */
export function workStatusLabel(
  status: WorkStatus,
  t: TFunction<"customServices">,
): string {
  return t(`workStatus.${status}`);
}

/** A fulfilment status's label ("ORDERED" → "Ordered"). */
export function fulfillmentLabel(
  status: FulfillmentStatus,
  t: TFunction<"customServices">,
): string {
  return t(`fulfillment.${status}`);
}

/** LIRA-360 — an insurance type's label ("DOMESTIC_WORKER" → "Domestic worker"). */
export function insuranceTypeLabel(
  type: InsuranceType,
  t: TFunction<"customServices">,
): string {
  return t(`insuranceType.${type}`);
}
