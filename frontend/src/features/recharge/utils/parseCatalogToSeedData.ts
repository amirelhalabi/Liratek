/**
 * parseCatalogToSeedData — Converts the nested mobileServices.ts static catalog
 * into a flat array of items suitable for bulk-inserting into the
 * `mobile_service_items` DB table.
 *
 * This function is only called once on first launch (when the DB table is empty).
 */

import { deriveDaysCostLbp } from "@liratek/core";
import mobileServices from "@/data/mobileServices";

export interface SeedItem {
  provider: string;
  category: string;
  subcategory: string;
  label: string;
  cost_lbp: number;
  sell_lbp: number;
  sort_order: number;
  /** Structured validity (days) / credit amount — LIRA W6.b. */
  validity_days?: number;
  credits?: number;
  /**
   * LIRA-090 / TELECOM_DAYS_COST_PLAN.md §4.3: the LBP cost attributable to
   * validity days alone, `round(cost_lbp - credits * R)`. Computed here (not
   * re-derived — rule 14) via the ONE shared core function so a fresh install
   * seeds the same Only-Days split a migration backfills for upgraded shops.
   * Omitted when the item isn't an Only-Days candidate or the formula's own
   * guard rejects it (see {@link isOnlyDaysCandidate}).
   */
  days_cost_lbp?: number;
}

/**
 * An item is an Only-Days candidate only if it genuinely bundles BOTH USD
 * credit and validity days (plan §1) — a card carrying only one of the two
 * has nothing to split. `credits` alone is not the test: mtc Prepaid's
 * `1`/`1.67` and alfa Prepaid's `1.22`/`3.03` carry `credits` but no
 * validity days, and are explicitly OUT of scope (plan §1.3, "credit-only,
 * no validity days — nothing to sell as 'days'"). Computing a days_cost for
 * them would wrongly flip `isTelecomSplitComplete` to true and route their
 * sales through the Only-Days netting path.
 *
 * So the test is simply: does the card carry validity days?
 *
 * HISTORY (do not reintroduce): while the alfa cards had no `validity_days`
 * seeded, this function special-cased `category === "alfa" && sub ===
 * "Prepaid"` to qualify by category alone, because the generic test would
 * have excluded all 22 alfa cards. The owner supplied the alfa day counts on
 * 2026-08-04, so that crutch is gone — and it MUST stay gone: it would now
 * wrongly qualify `1.22` and `3.03`, the two alfa cards the owner could not
 * confirm a day count for, which are deliberately credit-only.
 */
function isOnlyDaysCandidate(validityDays: number | undefined): boolean {
  return validityDays !== undefined;
}

/** Map of provider keys in mobileServices.ts → canonical DB provider name */
const PROVIDER_MAP: Record<string, string> = {
  iPick: "iPick",
  Katsh: "Katsh",
  WHISH_APP: "WHISH_APP",
  OMT_APP: "OMT_APP",
  "Validity vouchers": "VOUCHER",
};

/**
 * Parse the deeply nested mobileServices catalog into a flat array of seed items.
 *
 * Structure levels:
 *   Provider → Category → Subcategory → Items { cost, sell }
 *   Provider → Category → Subcategory → GroupName → Items { cost, sell }
 */
export function parseCatalogToSeedData(): SeedItem[] {
  const result: SeedItem[] = [];

  for (const [providerKey, catalog] of Object.entries(mobileServices)) {
    const provider = PROVIDER_MAP[providerKey];
    if (!provider) continue; // unknown provider

    for (const [categoryName, subcategories] of Object.entries(catalog)) {
      let globalSortOrder = 0;

      for (const [subName, itemsOrNested] of Object.entries(
        subcategories as Record<string, unknown>,
      )) {
        // Skip arrays (free-form categories with no predefined items)
        if (Array.isArray(itemsOrNested)) continue;

        if (typeof itemsOrNested !== "object" || itemsOrNested === null)
          continue;

        const entries = Object.entries(
          itemsOrNested as Record<string, unknown>,
        );

        // Skip empty objects (e.g. Cyberia: {}, Sodetel: {})
        if (entries.length === 0) continue;

        for (const [labelOrGroup, costOrNested] of entries) {
          if (typeof costOrNested === "string") {
            // Old format: label → cost string (shouldn't exist but handle defensively)
            result.push({
              provider,
              category: categoryName,
              subcategory: subName,
              label: labelOrGroup,
              cost_lbp: Number(costOrNested),
              sell_lbp: 0,
              sort_order: globalSortOrder++,
            });
          } else if (
            typeof costOrNested === "object" &&
            costOrNested !== null &&
            !Array.isArray(costOrNested)
          ) {
            const obj = costOrNested as Record<string, unknown>;

            if ("cost" in obj) {
              // It's a { cost, sell } pricing object
              const costLbp = Number(obj.cost);
              const validityDays =
                typeof obj.validity_days === "number"
                  ? obj.validity_days
                  : undefined;
              const credits =
                typeof obj.credits === "number" ? obj.credits : undefined;
              const daysCostLbp =
                credits !== undefined && isOnlyDaysCandidate(validityDays)
                  ? deriveDaysCostLbp(costLbp, credits)
                  : null;

              result.push({
                provider,
                category: categoryName,
                subcategory: subName,
                label: labelOrGroup,
                cost_lbp: costLbp,
                sell_lbp: Number(obj.sell),
                sort_order: globalSortOrder++,
                ...(validityDays !== undefined
                  ? { validity_days: validityDays }
                  : {}),
                ...(credits !== undefined ? { credits } : {}),
                ...(daysCostLbp != null
                  ? { days_cost_lbp: daysCostLbp }
                  : {}),
              });
            } else {
              // One level deeper — group of items
              // e.g. iPick > alfa > "Alfa Go" > items
              const deepEntries = Object.entries(obj);
              if (deepEntries.length === 0) continue;

              for (const [deepLabel, deepCost] of deepEntries) {
                if (typeof deepCost === "string") {
                  result.push({
                    provider,
                    category: categoryName,
                    subcategory: `${subName} / ${labelOrGroup}`,
                    label: deepLabel,
                    cost_lbp: Number(deepCost),
                    sell_lbp: 0,
                    sort_order: globalSortOrder++,
                  });
                } else if (
                  typeof deepCost === "object" &&
                  deepCost !== null &&
                  !Array.isArray(deepCost) &&
                  "cost" in (deepCost as Record<string, unknown>)
                ) {
                  const pricing = deepCost as { cost: string; sell: string };
                  result.push({
                    provider,
                    category: categoryName,
                    subcategory: `${subName} / ${labelOrGroup}`,
                    label: deepLabel,
                    cost_lbp: Number(pricing.cost),
                    sell_lbp: Number(pricing.sell),
                    sort_order: globalSortOrder++,
                  });
                }
              }
            }
          }
        }
      }
    }
  }

  return result;
}
