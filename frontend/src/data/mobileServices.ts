// One file per provider page that sells catalog items (iPick, Katsh, Whish
// App). Each imports this file's types with `import type`, so that cycle is
// erased at compile time.
import { iPickCatalog } from "./providers/iPick";
import { katshCatalog } from "./providers/katsh";
import { whishAppCatalog } from "./providers/whishApp";

/**
 * Mobile Services catalog data.
 *
 * Sourced from the original mobileServices.json with per-provider item lists.
 * Each provider maps to categories, and each category to either:
 *   - An empty array  → no pre-defined items (free-form entry)
 *   - An object       → keyed by label, value = code/price string
 */

export interface ItemPricing {
  cost: string;
  sell: string;
  /**
   * Structured validity (days) — LIRA W6.b. Only mtc Prepaid card items carry
   * this; omitted everywhere else. Seeded straight into
   * `mobile_service_items.validity_days` by parseCatalogToSeedData so a
   * fresh install shows the same structured data migration v135 backfills
   * for upgraded shops (see that migration's description for the full
   * derivation — same numbers, same source: the old verbose "N days $X"
   * labels this catalog dropped under the A1/LIRA-072 card-face-value rename).
   */
  validity_days?: number;
  /**
   * Structured credit amount (USD) — LIRA W6.b. `credits` and `validity_days`
   * are INDEPENDENT attributes, not mutually exclusive: a prepaid card can
   * carry both (face credit + bundled validity days) at once. This used to be
   * documented as mutually exclusive when the catalog recorded one attribute
   * per card; LIRA-090's Only-Days model (see
   * `docs/plans/todo_plans/TELECOM_DAYS_COST_PLAN.md` §3.2/§4) needs both set
   * on the same mtc Prepaid item — the customer keeps the days, the credit is
   * SMSed back — so a card carrying only one of the two stays out of that
   * split (nothing to return, or no days to sell), but a card carrying both
   * is the normal case for Only-Days candidates.
   */
  credits?: number;
  /**
   * LIRA-324 (v218): the USD price pair for Whish App USD mode (Whish app
   * crawl 2026-10-14). Omitted = not sold in USD. A USD-only item has
   * `cost: "0", sell: "0"`. Never set on MTC / Alfa Prepaid cards in this
   * release (their days/credits handling is LBP-only).
   */
  cost_usd?: string;
  sell_usd?: string;
}
export type ServiceItems = Record<string, ItemPricing> | string[];
export type ServiceSubcategory = ServiceItems | Record<string, ServiceItems>;
export type ServiceCategory = Record<string, ServiceSubcategory>;
export type ServiceCatalog = Record<string, ServiceCategory>;

const mobileServices: Record<string, ServiceCatalog | Record<string, never>> = {
  iPick: iPickCatalog,
  Katsh: katshCatalog,
  WHISH_APP: whishAppCatalog,
  "Validity vouchers": {
    alfa: {
      voucher: {
        "1 day": { cost: "318978", sell: "318978" },
        "3 days": { cost: "462075", sell: "462075" },
        "7 days": { cost: "765007", sell: "765007" },
        "15 days": { cost: "1003274 ", sell: "1003274 " },
        "30 days": { cost: "1511601", sell: "1511601" },
        "60 days": { cost: "2256769", sell: "2256769" },
        "90 days": { cost: "7620030", sell: "7620030" },
      },
    },
    mtc: {
      voucher: {
        "1 day": { cost: "119617", sell: "150000" },
        "3 days": { cost: "186071", sell: "235000" },
        "7 days": { cost: "398723", sell: "440000" },
        "15 days": { cost: "462518", sell: "500000" },
        "30 days": { cost: "765007", sell: "800000" },
        "60 days": { cost: "1000327", sell: "1100000" },
        "90 days": { cost: "1509829", sell: "1600000" },
      },
    },
  },
};

export default mobileServices;
