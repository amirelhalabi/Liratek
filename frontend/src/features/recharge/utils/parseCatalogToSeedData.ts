/**
 * parseCatalogToSeedData — Converts the nested mobileServices.ts static catalog
 * into a flat array of items suitable for bulk-inserting into the
 * `mobile_service_items` DB table.
 *
 * This function is only called once on first launch (when the DB table is empty).
 */

import mobileServices from "@/data/mobileServices";

export interface SeedItem {
  provider: string;
  category: string;
  subcategory: string;
  label: string;
  cost_lbp: number;
  sell_lbp: number;
  sort_order: number;
}

/** Map of provider keys in mobileServices.ts → canonical DB provider name */
const PROVIDER_MAP: Record<string, string> = {
  iPick: "iPick",
  Katsh: "Katsh",
  WISH_APP: "WISH_APP",
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

        let sortOrder = 0;

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
              sort_order: sortOrder++,
            });
          } else if (
            typeof costOrNested === "object" &&
            costOrNested !== null &&
            !Array.isArray(costOrNested)
          ) {
            const obj = costOrNested as Record<string, unknown>;

            if ("cost" in obj) {
              // It's a { cost, sell } pricing object
              result.push({
                provider,
                category: categoryName,
                subcategory: subName,
                label: labelOrGroup,
                cost_lbp: Number(obj.cost),
                sell_lbp: Number(obj.sell),
                sort_order: sortOrder++,
              });
            } else {
              // One level deeper — group of items
              // e.g. Katsh > "Mobile topups" > alfa > items
              // But this is already at the item level for most providers.
              // The deeper case: subName=alfa, labelOrGroup=groupName, then items below
              let deepSortOrder = 0;
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
                    sort_order: deepSortOrder++,
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
                    sort_order: deepSortOrder++,
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
