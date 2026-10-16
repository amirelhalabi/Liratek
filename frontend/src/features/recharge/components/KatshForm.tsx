import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  memo,
  startTransition,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Phone, Plus } from "lucide-react";
import { TransactionTimeOverride } from "@/shared/components/TransactionTimeOverride";
import { PriceChangeWarning } from "@/shared/components/PriceChangeWarning";
import { ClientAutocompleteInput } from "@/shared/components/ClientAutocompleteInput";
import { ensureRechargeClient } from "../utils/ensureClient";
import AlfaLogo from "@/assets/logos/alfa.svg?react";
import MtcLogo from "@/assets/logos/mtc.svg?react";
import { getCardImage } from "../utils/cardImages";
import {
  PROVIDER_BRANDS,
  type ProviderBrand,
} from "@/shared/brand/providerBrands";
import { CardArtwork } from "./CardArtwork";
import { CardGroupTag } from "./CardGroupTag";
import { cardGroupLabel } from "../utils/cardGroupLabel";
import { Collapsible } from "@/shared/components/Collapsible";
import {
  type PaymentLine,
  type CarrierLineEntity,
  useApi,
  DecimalInput,
  hasNewClientInfo,
  appEvents,
} from "@liratek/ui";
import {
  maxReturnableCredits,
  resolveMaxReturnedCredits,
  isTelecomSplitComplete,
  resolveCreditSellPriceLbp,
  // LIRA-157 — the SAME rule the repository applies on write. Imported, never
  // re-implemented: a second copy here would drift and promise the operator
  // days the backend then refuses or clips.
  projectValidityExpiry,
  MAX_LINE_VALIDITY_DAYS,
  buildCatalogSalePayload,
  catalogCartTotals,
} from "@liratek/core";
import { toCamelLegs } from "@/utils/paymentUtils";
import { useSession } from "@/features/sessions/context/SessionContext";
import { useAutoPrintReceipt } from "@/shared/hooks/useAutoPrintReceipt";
import { useSessionAutoFill } from "@/features/sessions/hooks/useSessionAutoFill";
import {
  ForPartnerToggle,
  ForPartnerNotice,
} from "@/features/partners/components/ForPartnerToggle";
import type { ProviderConfig, FinancialTransaction } from "../types";
import { providerBrandOf } from "../types";
import type { ServiceItem, ProviderKey } from "../hooks/useMobileServiceItems";
import { NewServiceItemInlineForm } from "./NewServiceItemInlineForm";
import {
  buildNewServiceItemPayload,
  emptyNewServiceItemForm,
  type NewServiceItemForm,
} from "../utils/catalogNames";
import { formatCatalogItemName } from "../hooks/useMobileServiceItems";
import { getCategoryColor } from "../utils/categoryColors";
import { isSelfChargeEligible } from "../utils/selfChargeEligibility";
import { localDay } from "@/shared/utils/localDay";
import { HistoryModal } from "./HistoryModal";
import { PaymentSheet, type PaymentSheetItem } from "./PaymentSheet";
import { fetchClientVouchers } from "@/shared/utils/clientVouchers";
import logger from "@/utils/logger";
import { getApiErrorMessage } from "@/shared/utils/apiErrorMessage";
import { SUPPLIER_KEYS } from "@/features/suppliers/hooks/useSuppliers";
import {
  useBasketBills,
  useBasketPartner,
  useCatalogBasket,
} from "../context/RechargeBasketContext";
import {
  useRechargeBasketCheckout,
  useRechargePartnerOrder,
} from "../hooks/useRechargeBasketCheckout";
import {
  basketEntries,
  basketItemCount,
  basketProviders,
  basketSheetSummary,
  catalogBatchSubItems,
  isBasketProvider,
  withClient,
} from "../utils/basketCheckout";
import { partnerConfirmMessage } from "../utils/partnerConfirm";
import type { CatalogCartLine, PricedLine } from "../types/basket";

// ─── Module-level pure helpers ────────────────────────────────────────────────

function isTelecomVoucher(item: ServiceItem): boolean {
  return (
    item.category === "alfa" ||
    item.category === "mtc" ||
    item.subcategory === "alfa" ||
    item.subcategory === "mtc"
  );
}

/**
 * LIRA-090 B1 fix: the frontend sends GROSS cost; the repository nets it to
 * `days_cost_lbp` via `processTelecomCreditReturn` when `mobileServiceItemId`
 * is present. Pre-netting here AND having the repo also credit the
 * MTC/Alfa drawer was a double-count (HANDOFF §B1).
 *
 * The COST side is untouched by the owner pricing model below — that model
 * changes only what the CUSTOMER PAYS (`calcPrice`), never the card's cost.
 */
function calcCost(item: ServiceItem): number {
  return item.catalogCost ?? 0;
}

/** Tenant setting key for the credit-price 3-level fallback's 2nd level (LBP
 *  per $1 of resold credit). Mirrors the constant of the same name/value in
 *  `MobileServicesManager.tsx`'s resale table — same setting, read here for
 *  the Only-Days sale price instead of the decision aid. */
const TELECOM_CREDIT_SELL_PRICE_SETTING_KEY = "telecom_credit_sell_price_lbp";

/** The pricing-only columns of a catalog item, fetched separately from the
 *  ServiceItem context (`sell_days_lbp`/`sell_credit_lbp` live on
 *  `mobile_service_items` but the shared `ServiceItem` type doesn't map them
 *  through — out of scope to widen for this ticket). Keyed by the item's DB
 *  id in `KatshFormInner`'s `catalogPricing` map. */
interface CatalogPricingRow {
  sell_days_lbp: number | null;
  sell_credit_lbp: number | null;
  /**
   * v160: the per-card returnable override. Lives here rather than on
   * `ServiceItem` for the same reason the two prices do — it is a
   * `mobile_service_items` column the shared context type does not map
   * through.
   */
  max_returned_credits_usd: number | null;
}

/** Result of {@link resolveOnlyDaysPricing}. */
interface OnlyDaysPricingResult {
  /** False when the catalog item has no `sell_days_lbp` (a day count outside
   *  the seeded table, or a non-candidate item) — callers MUST fall back to
   *  the legacy formula (`sellPrice - returnedCredits * sellRate`) rather
   *  than treat `total` as chargeable. */
  hasSellDaysPrice: boolean;
  sellDaysLbp: number | null;
  creditPriceLbp: number;
  /** LIRA-260: the saved (pre-override) days price, for the price-change warning. */
  catalogSellDaysLbp: number | null;
  /** LIRA-260: the saved (pre-override) credit price, for the price-change warning. */
  catalogCreditPriceLbp: number;
  keptCredits: number;
  /** `sellDaysLbp + keptCredits * creditPriceLbp`, or `null` when
   *  `hasSellDaysPrice` is false. */
  total: number | null;
}

/**
 * Owner pricing model (TELECOM_CREDIT_RATE_PLAN.md §Q4, owner-confirmed
 * 2026-08-05): an Only-Days sale charges
 *
 *   total = sell_days_lbp + kept_credits * credit_price
 *
 * BOTH components are editable per sale; each defaults from data:
 *   - `sellDaysLbp` <- the item's own `sell_days_lbp` (seeded from the
 *     day-count table, migration v147), overridable per line.
 *   - `creditPriceLbp` <- per-item `sell_credit_lbp`, else the tenant
 *     setting `telecom_credit_sell_price_lbp`, else
 *     `DEFAULT_TELECOM_CREDIT_SELL_PRICE_LBP` (rule 14 — imported from
 *     `@liratek/core`, never re-encoded) — same 3-level fallback
 *     `MobileServicesManager.tsx`'s resale table uses.
 *
 * `keptCredits = max(0, maxReturnableCredits(face credits) - returnedCredits)`
 * — the gap between the card's face value and what SMS transfer can ever
 * recover is burned by fees, not left usable on the customer's line, so it
 * is NEVER counted as kept or charged (owner note, TELECOM_DAYS_COST_PLAN
 * ticket brief). When the operator returns the full recoverable amount
 * (the default), `keptCredits` is exactly 0 and `total` is just the days
 * price.
 *
 * Returns `hasSellDaysPrice: false` (and `total: null`) whenever the catalog
 * item has no `sell_days_lbp` — the caller (`calcPrice`) MUST fall back to
 * today's pricing exactly in that case. A missing days price must never
 * silently become 0 and hand the customer a free sale.
 */
function resolveOnlyDaysPricing(
  line: Pick<
    CartLineItem,
    | "item"
    | "returnedCreditsUsd"
    | "sellDaysLbpOverride"
    | "creditPriceLbpOverride"
  >,
  catalogPricing: Map<number, CatalogPricingRow>,
  tenantCreditSellPriceLbp: number | null,
): OnlyDaysPricingResult {
  const entity =
    line.item.id != null ? catalogPricing.get(line.item.id) : undefined;
  const catalogSellDaysLbp = entity?.sell_days_lbp ?? null;
  const sellDaysLbp = line.sellDaysLbpOverride ?? catalogSellDaysLbp;
  const catalogCreditPriceLbp = resolveCreditSellPriceLbp(
    entity?.sell_credit_lbp,
    tenantCreditSellPriceLbp,
  );
  const creditPriceLbp = line.creditPriceLbpOverride ?? catalogCreditPriceLbp;

  // The face credit MUST be known before this model can price kept credit.
  // Guarding on it is not defensive noise — `maxReturnableCredits(0)` is 0, so
  // a null `credits` would clamp `keptCredits` to 0 and bill the customer the
  // bare days price no matter how much credit they walked away with. That
  // state is reachable: Settings can now save `sell_days_lbp` on an item whose
  // `credits` was left blank, and nothing enforces the pair. Found by
  // adversarial review 2026-08-05 and reproduced (operator kept 4 credits,
  // charge came out at exactly the days price).
  const faceCredits = line.item.credits ?? null;
  const hasFaceCredits = typeof faceCredits === "number" && faceCredits > 0;
  // v160: the base is the card's OVERRIDE when set, else the computed bare-card
  // maximum (rule 14 — `resolveMaxReturnedCredits` owns `override ?? computed`).
  // This is the line that decides what the customer pays: owner decision
  // 2026-09-07 is that a short transfer IS billed, so returning 73 against a
  // 73.5 base bills the 0.5 difference rather than the shop absorbing it.
  const keptCredits = hasFaceCredits
    ? Math.max(
        0,
        resolveMaxReturnedCredits(
          faceCredits,
          entity?.max_returned_credits_usd,
        ) - line.returnedCreditsUsd,
      )
    : 0;

  // `applies` gates the MODEL, not the input. It reads the CATALOG value, never
  // the editable override: gating on the live override let a mid-edit empty
  // field (DecimalInput emits 0 for "") flip this false and unmount the very
  // input being typed into, silently dropping the sale back to legacy pricing.
  // Also found by that review, and also reproduced.
  const applies =
    typeof catalogSellDaysLbp === "number" &&
    catalogSellDaysLbp > 0 &&
    hasFaceCredits;

  // A cleared days-price field means "0 for the days", which is a legitimate
  // thing to charge (a free-days promotion on a kept-credit sale) — it must NOT
  // fall through to the legacy formula, or clearing the field would silently
  // change which formula is in force. Only a MISSING catalog price does that.
  const effectiveSellDays = typeof sellDaysLbp === "number" ? sellDaysLbp : 0;
  const total = applies
    ? effectiveSellDays + keptCredits * creditPriceLbp
    : null;

  return {
    hasSellDaysPrice: applies,
    sellDaysLbp,
    creditPriceLbp,
    catalogSellDaysLbp,
    catalogCreditPriceLbp,
    keptCredits,
    total,
  };
}

function calcPrice(
  item: ServiceItem,
  onlyDays: boolean,
  returnedCredits: number,
  sellRate: number,
  onlyDaysTotal: number | null,
): number {
  const sellPrice = item.catalogSellPrice ?? 0;
  if (!onlyDays) return sellPrice;
  // Owner pricing model (2026-08-05, resolveOnlyDaysPricing above):
  // `onlyDaysTotal` is `sell_days_lbp + kept_credits * credit_price` when the
  // item has a computed days price. FALLBACK: an item with no `sell_days_lbp`
  // (a day count outside the seeded table, or a non-candidate) keeps TODAY'S
  // pricing exactly — never let a missing days price become 0.
  return onlyDaysTotal ?? sellPrice - returnedCredits * sellRate;
}

/** The price ONE unit of a cart line is charged at (the Only Days price for an
 *  Only Days line). Shared by the totals, the payment window's item list and
 *  the published basket lines, so they always agree. */
function lineUnitPriceOf(
  line: CartLineItem,
  catalogPricing: Map<number, CatalogPricingRow>,
  tenantCreditSellPriceLbp: number | null,
  alfaCreditSellRate: number,
): number {
  return calcPrice(
    line.item,
    line.onlyDays,
    line.returnedCreditsUsd,
    alfaCreditSellRate,
    resolveOnlyDaysPricing(line, catalogPricing, tenantCreditSellPriceLbp)
      .total,
  );
}

// Bill card, Proceed to Pay and the payment sheet follow the active provider's
// own brand (iPick = its green→blue gradient, Katsh = lime with Katsh-blue
// labels), read from the shared PROVIDER_BRANDS module (rule 14). Every class
// there is a literal string, so Tailwind's static scanner can see it.
function billAccentFor(provider: ProviderKey) {
  const brand = PROVIDER_BRANDS[provider === "iPick" ? "IPICK" : "KATSH"];
  return {
    brand,
    border: brand.border,
    toggleActive: brand.solid,
    inputFocus: brand.focusBorder,
    button: brand.button,
    pendingLabel: brand.text,
    pendingAmount: brand.text,
  };
}

// ─── ItemCard (memo'd, module scope) ─────────────────────────────────────────

interface ItemCardProps {
  item: ServiceItem;
  /** The active provider's brand: selected border/ring, −/+ buttons and
   *  input focus take its colour (shared/brand/providerBrands.ts). */
  brand: ProviderBrand;
  qty: number;
  isExpanded: boolean;
  onlyDays: boolean;
  returnedCreditsUsd: number;
  /** Undefined when the item is not in the cart (qty 0) — the pricing panel
   *  only ever renders when `onlyDays` is true, which implies a cart line. */
  onlyDaysPricing?: OnlyDaysPricingResult | undefined;
  onCardClick: (item: ServiceItem) => void;
  onQtyDecrease: (item: ServiceItem) => void;
  onQtyIncrease: (item: ServiceItem) => void;
  onOnlyDaysChange: (item: ServiceItem, checked: boolean) => void;
  onReturnedCreditsChange: (item: ServiceItem, value: number) => void;
  onSellDaysLbpChange: (item: ServiceItem, value: number) => void;
  onCreditPriceLbpChange: (item: ServiceItem, value: number) => void;
  /** Carrier-lines-validity plan Phase 5 / D5: true when this item qualifies
   *  for the "Charge to shop line" self-charge action (see
   *  `isSelfChargeEligible`). */
  selfChargeEligible: boolean;
  /** The carrier's current primary line (`getPrimary`), or null when the
   *  carrier has no active line yet — the button stays visible but disabled
   *  with an explanatory tooltip rather than erroring on click (§0.5). */
  selfChargeTargetLine: CarrierLineEntity | null;
  onSelfCharge: (item: ServiceItem) => void;
}

const ItemCard = memo(function ItemCard({
  item,
  brand,
  qty,
  isExpanded,
  onlyDays,
  returnedCreditsUsd,
  onlyDaysPricing,
  onCardClick,
  onQtyDecrease,
  onQtyIncrease,
  onOnlyDaysChange,
  onReturnedCreditsChange,
  onSellDaysLbpChange,
  onCreditPriceLbpChange,
  selfChargeEligible,
  selfChargeTargetLine,
  onSelfCharge,
}: ItemCardProps) {
  const cost = item.catalogCost ?? 0;
  const sellPrice = item.catalogSellPrice ?? 0;
  const isTelecom = isTelecomVoucher(item);
  const cardImage = getCardImage(item);

  return (
    <div className="relative flex flex-col">
      <div
        className={`flex-1 flex flex-col w-full p-3 rounded-lg border transition-all ${
          qty > 0 ? brand.selected : "border-white/10 hover:border-white/20"
        } ${isExpanded && qty > 0 ? brand.selectedStrong : ""}`}
        style={{ backgroundColor: `${getCategoryColor(item.category)}18` }}
      >
        <div
          onClick={() => onCardClick(item)}
          className="flex-1 flex flex-col cursor-pointer"
        >
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <div className="text-white font-medium text-sm truncate">
                {item.label}
              </div>
              {cardImage && <CardGroupTag item={item} />}
            </div>
            {qty > 0 && (
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onQtyDecrease(item);
                  }}
                  className={`w-5 h-5 rounded-full ${brand.stepper} flex items-center justify-center transition-colors cursor-pointer text-xs font-bold`}
                  type="button"
                >
                  −
                </button>
                <span
                  className={`w-4 text-center text-xs font-bold ${brand.text}`}
                >
                  {qty}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onQtyIncrease(item);
                  }}
                  className={`w-5 h-5 rounded-full ${brand.stepper} flex items-center justify-center transition-colors cursor-pointer text-xs font-bold`}
                  type="button"
                >
                  +
                </button>
              </div>
            )}
          </div>
          {cardImage ? (
            <CardArtwork
              src={cardImage}
              alt={`${item.category} ${item.label}`}
            />
          ) : (
            // flex-1: in a row where another card has artwork, this grows
            // to the artwork's height so Cost / Sell line up below it.
            <div className="flex-1 flex flex-col items-center justify-center gap-0.5">
              {item.subcategory === "alfa" || item.category === "alfa" ? (
                <AlfaLogo className="h-4 w-auto" />
              ) : item.subcategory === "mtc" || item.category === "mtc" ? (
                <MtcLogo className="h-4 w-auto" />
              ) : null}
              <span className="text-slate-500 text-[10px] truncate max-w-full">
                {item.subcategory}
              </span>
            </div>
          )}
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-slate-400">Cost:</span>
            <span className="text-xs text-white font-mono">
              {cost.toLocaleString()} LBP
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">Sell:</span>
            <span className="text-xs text-emerald-400 font-mono">
              {sellPrice.toLocaleString()} LBP
            </span>
          </div>
          {/* W6.b: structured validity/credits, when present on the catalog
              row. Not shown at checkout, not on receipts — display-only here. */}
          {(item.validityDays != null || item.credits != null) && (
            <div className="mt-1 flex items-center justify-between">
              <span className="text-[10px] text-slate-500">
                {item.validityDays != null
                  ? `${item.validityDays}d validity`
                  : "Credit only"}
              </span>
              {item.credits != null && (
                <span className="text-[10px] text-slate-500 font-mono">
                  ${item.credits}
                </span>
              )}
            </div>
          )}
        </div>
        {/* Carrier-lines-validity plan Phase 5 / D5: charge this item's cost
            to the shop's own carrier line instead of a customer. Sibling of
            the onClick wrapper above (not nested inside it) so a click here
            never also adds the item to the cart. */}
        {selfChargeEligible && (
          <button
            type="button"
            onClick={() => onSelfCharge(item)}
            disabled={!selfChargeTargetLine}
            title={
              selfChargeTargetLine
                ? `Charge this item to ${selfChargeTargetLine.label || selfChargeTargetLine.phone_number}`
                : `No active ${item.category.toUpperCase()} line configured — add one in Settings → Carrier Lines`
            }
            className="mt-2 w-full py-1 rounded text-[10px] font-medium bg-emerald-900/30 hover:bg-emerald-900/50 text-emerald-400 disabled:bg-slate-800/60 disabled:text-slate-500 disabled:cursor-not-allowed transition-colors"
          >
            Charge to shop line
          </button>
        )}
      </div>

      <Collapsible open={qty > 0 && isExpanded}>
        <div className="mt-2 p-3 bg-slate-900 rounded-lg border border-slate-700">
          {isTelecom && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 shrink-0">
                  <input
                    type="checkbox"
                    id={`onlydays-${item.key}`}
                    checked={onlyDays}
                    onChange={(e) => onOnlyDaysChange(item, e.target.checked)}
                    className={`w-4 h-4 rounded border-slate-600 ${brand.text} ${brand.focusRing} cursor-pointer`}
                  />
                  <label
                    htmlFor={`onlydays-${item.key}`}
                    className="text-xs text-slate-300 cursor-pointer select-none whitespace-nowrap"
                  >
                    Only Days
                  </label>
                </div>
                {onlyDays && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-xs text-slate-400 whitespace-nowrap">
                      Credits
                    </span>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      max={parseFloat(item.label) || 0}
                      value={returnedCreditsUsd}
                      onChange={(e) =>
                        onReturnedCreditsChange(
                          item,
                          parseFloat(e.target.value) || 0,
                        )
                      }
                      className={`w-14 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-white focus:outline-none ${brand.focusBorder}`}
                    />
                  </div>
                )}
              </div>
              {/* Owner pricing model (2026-08-05): total = sell_days_lbp +
                  kept_credits * credit_price — both editable, prefilled from
                  the catalog. Renders ONLY when the item has a computed days
                  price; items without one (FALLBACK) keep the plain
                  Credits input above with no extra panel. */}
              {onlyDays && onlyDaysPricing?.hasSellDaysPrice && (
                <div className="flex flex-col gap-1 pt-1.5 border-t border-slate-700/60">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] text-slate-400 whitespace-nowrap">
                      Days price
                    </span>
                    <DecimalInput
                      value={onlyDaysPricing.sellDaysLbp ?? 0}
                      onChange={(n) => onSellDaysLbpChange(item, n)}
                      decimals={0}
                      zeroAsEmpty={false}
                      aria-label="Only-Days price"
                      className={`w-24 bg-slate-800 border border-slate-600 rounded px-1.5 py-0.5 text-[11px] text-white text-right font-mono focus:outline-none ${brand.focusBorder}`}
                    />
                  </div>
                  <PriceChangeWarning
                    catalogPrice={onlyDaysPricing.catalogSellDaysLbp}
                    currentPrice={onlyDaysPricing.sellDaysLbp}
                    currency="LBP"
                    className="text-[10px]"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] text-slate-400 whitespace-nowrap">
                      Credit price /$
                    </span>
                    <DecimalInput
                      value={onlyDaysPricing.creditPriceLbp}
                      onChange={(n) => onCreditPriceLbpChange(item, n)}
                      decimals={0}
                      zeroAsEmpty={false}
                      aria-label="Only-Days credit price"
                      className={`w-24 bg-slate-800 border border-slate-600 rounded px-1.5 py-0.5 text-[11px] text-white text-right font-mono focus:outline-none ${brand.focusBorder}`}
                    />
                  </div>
                  <PriceChangeWarning
                    catalogPrice={onlyDaysPricing.catalogCreditPriceLbp}
                    currentPrice={onlyDaysPricing.creditPriceLbp}
                    currency="LBP"
                    className="text-[10px]"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] text-slate-500">
                      Kept credits
                    </span>
                    <span className="text-[11px] text-slate-300 font-mono">
                      ${onlyDaysPricing.keptCredits.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] text-slate-400 font-semibold">
                      Total
                    </span>
                    <span className="text-xs text-emerald-400 font-mono font-semibold">
                      {(onlyDaysPricing.total ?? 0).toLocaleString()} LBP
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </Collapsible>
    </div>
  );
});

// ─── KatshFormInner ──────────────────────────────────────────────────────────

/** LIRA-326: the cart line type is shared with the basket context. */
type CartLineItem = CatalogCartLine;

interface KatshFormProps {
  activeConfig: ProviderConfig | undefined;
  activeProvider: ProviderKey | null;
  getCategoriesForProvider: (provider: ProviderKey) => string[];
  getServiceItems: (provider: ProviderKey, category: string) => ServiceItem[];
  methods: { code: string; label: string }[];
  loadFinancialData: () => void;
  formatAmount: (val: number, currency: string) => string;
  alfaCreditSellRate: number;
  /** @deprecated LIRA-090 B1: the frontend now sends GROSS cost; the repo nets
   *  it via `processTelecomCreditReturn`. This prop is retained for callers that
   *  still pass it and for the legacy split-incomplete "Only Days" price display,
   *  but is no longer used in cost calculations. */
  alfaCreditCostRate?: number;
  exchangeRate: number;
  showHistory: boolean;
  setShowHistory: (show: boolean) => void;
  onRefreshItems?: () => Promise<void>;
  isAdmin?: boolean;
  /** Reports selected-item counts per provider tab (Katsh/iPick share one
   *  mounted form and one cart, so both keys are always reported). */
  onCartCountChange?: (counts: Record<string, number>) => void;
}

function KatshFormInner({
  activeConfig,
  activeProvider,
  getCategoriesForProvider,
  getServiceItems,
  methods,
  loadFinancialData,
  formatAmount,
  alfaCreditSellRate,
  exchangeRate,
  showHistory,
  setShowHistory,
  onRefreshItems,
  isAdmin,
  onCartCountChange,
}: KatshFormProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const {
    activeSession,
    linkTransaction,
    addToCart: addToSessionCart,
  } = useSession();
  // LIRA-069 W1.d — auto-print on a successful STANDALONE submit (skipped
  // when a session is active; the session gets its own Print button at
  // checkout, W1.b). Never fires from handleForPartnerSubmit — a partner
  // order collects no cash from a walk-in customer, so there's no receipt.
  const autoPrintReceipt = useAutoPrintReceipt();
  // LIRA-326: the cart lives in the Mobile Recharge basket (app shell), so
  // picks survive switching to Whish App and back, or leaving the page.
  // `others` = the Whish App group's priced lines.
  const {
    cart,
    setCart,
    setPriced,
    others,
    clearAll: clearBasket,
    shared: basketShared,
  } = useCatalogBasket();
  const checkoutBasket = useRechargeBasketCheckout();
  const submitPartnerOrder = useRechargePartnerOrder();
  // LIRA-327: staged bills live in the basket too (each under the tab it was
  // added on), so they survive tab switches and are paid with everything.
  const { bills, setBills, billLines } = useBasketBills();
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(
    new Set(),
  );
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientId, setClientId] = useState<number | null>(null);
  const [paymentInputKey, setPaymentInputKey] = useState(0);
  const [initialPaymentMethod, setInitialPaymentMethod] = useState("CASH");
  const [localSubmitting, setLocalSubmitting] = useState(false);
  const [newItemForm, setNewItemForm] = useState<NewServiceItemForm | null>(
    null,
  );
  const [addItemError, setAddItemError] = useState("");

  // PFT-3b (Partner FOR-Transactions, financial-service dispatch): a partner
  // Katsh/iPick checkout has NO walk-in customer and takes NO counter cash —
  // the partner owes exactly the selling price (backend books provider
  // drawer −cost + partner owes price, payments: []). Kept separate from
  // localSubmitting so the normal PaymentSheet path stays untouched.
  // LIRA-327: For Partner is basket-wide — on in one basket tab, on in all.
  const {
    forPartner,
    setForPartner,
    partnerId: selectedPartnerId,
    setPartnerId: setSelectedPartnerId,
    shared: partnerShared,
  } = useBasketPartner(
    true,
    // Owner rule 2026-10-16: no partner sales in a customer session — the
    // basket-wide For Partner is turned off while one is open.
    !!activeSession,
  );
  const [isSubmittingPartner, setIsSubmittingPartner] = useState(false);

  // Autofill client name + phone from active customer session
  useSessionAutoFill([
    { select: (s) => s.customer_name, set: setClientName, clearValue: "" },
    { select: (s) => s.customer_phone, set: setClientPhone, clearValue: "" },
  ]);

  // Auto-promote CUSTOMER_ACCOUNT once both name+phone are filled for a brand-new client
  useEffect(() => {
    const newClientReady = hasNewClientInfo({
      clientId,
      name: clientName,
      phone: clientPhone,
    });
    if (newClientReady && initialPaymentMethod !== "CUSTOMER_ACCOUNT") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInitialPaymentMethod("CUSTOMER_ACCOUNT");

      setPaymentInputKey((k) => k + 1);
    }
  }, [clientId, clientName, clientPhone, initialPaymentMethod]);

  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [paymentLines, setPaymentLines] = useState<PaymentLine[]>([]);
  const [returnLegs, setReturnLegs] = useState<PaymentLine[]>([]);
  // T3 keep-change: kept change → profit stamp on the legs-carrying txn.
  const [keptChange, setKeptChange] = useState<{
    usd: number;
    lbp: number;
  } | null>(null);
  // Payment-Legs Integrity plan (false-reject fix): the rate the
  // PaymentSheet is ACTUALLY using — the `exchangeRate` prop default, or the
  // operator's own edit of the sheet's header rate field. Sent as
  // tender_exchange_rate instead of re-sending the static prop, which is
  // wrong the moment the operator edits the field.
  const [effectiveRate, setEffectiveRate] = useState<number | undefined>();

  const isSplitPayment = paymentLines.length > 1;
  const [transactionTime, setTransactionTime] = useState<string | undefined>();
  const [searchQuery, setSearchQuery] = useState("");
  const [discount, setDiscount] = useState(0);
  // LIRA-319 — the extra from the payment box's "+ Extra" side, in the
  // sheet's total currency (`billsCurrency`). Sent on its own field with the
  // checkout's ONE carrier (the items call, else the first bill) — never
  // folded into a price — and never in a session or for a partner (neither
  // opens the sheet).
  const [extraCharge, setExtraCharge] = useState(0);
  const [showPaymentSheet, setShowPaymentSheet] = useState(false);
  const [itemsReady, setItemsReady] = useState(false);
  // Bill card state (LBP default per spec). The staged bills themselves live
  // in the basket (LIRA-327, `bills` above).
  const [billAmount, setBillAmount] = useState("");
  const [billCurrency, setBillCurrency] = useState<"USD" | "LBP">("LBP");
  const pendingBills = bills;
  // Bills check out as their OWN transactions (per-bill supplier commission +
  // audit row), but ONE PaymentSheet payment covers the whole checkout: the
  // legs book against exactly one CARRIER transaction — the aggregated items
  // SEND when catalog items are in the cart, otherwise the first bill — and
  // every other transaction is sent with deferPayment (cost + commission
  // only). Attaching the same legs to two transactions double-books the till.
  //
  // Sheet total: USD when the checkout is bills-only and every bill is USD,
  // otherwise LBP with USD bills converted at the current rate
  // (MultiPaymentInput supports cross-currency legs against a single-currency
  // total). Each bill still books its cost in its OWN currency.
  const billsAllUsd =
    pendingBills.length > 0 && pendingBills.every((b) => b.currency === "USD");
  const billsLbpValue = Math.round(
    pendingBills.reduce(
      (s, b) => s + (b.currency === "LBP" ? b.amount : b.amount * exchangeRate),
      0,
    ),
  );
  const billsOnlyUsd = billsAllUsd && cart.size === 0;
  const billsCurrency: "USD" | "LBP" = billsOnlyUsd ? "USD" : "LBP";
  const billsTotal = billsOnlyUsd
    ? pendingBills.reduce((s, b) => s + b.amount, 0)
    : billsLbpValue;
  const fmtBill = (amount: number, cur: "USD" | "LBP") =>
    cur === "LBP"
      ? `${Math.round(amount).toLocaleString()} LBP`
      : `$${amount.toFixed(2)}`;

  // Report selection counts to the provider tabs. With the shared basket
  // (LIRA-326/327) the page counts the picks AND the staged bills itself, for
  // every tab; standalone, they are reported here, each bill under the tab it
  // was added on.
  useEffect(() => {
    if (!onCartCountChange) return;
    const counts: Record<string, number> = { Katsh: 0, iPick: 0 };
    if (!basketShared) {
      for (const line of cart.values()) {
        counts[line.item.provider] =
          (counts[line.item.provider] ?? 0) + line.quantity;
      }
      for (const bill of pendingBills) {
        counts[bill.provider] = (counts[bill.provider] ?? 0) + 1;
      }
    }
    onCartCountChange(counts);
  }, [cart, pendingBills, onCartCountChange, basketShared]);
  useEffect(() => {
    return () => onCartCountChange?.({});
  }, [onCartCountChange]);
  const [historyTransactions, setHistoryTransactions] = useState<
    FinancialTransaction[]
  >([]);

  // Lazy-load provider history only when the history modal is opened.
  useEffect(() => {
    if (showHistory && activeProvider) {
      api
        // Every row, not the latest 50 — the History window's date filter
        // and totals cover every day.
        .getOMTHistory(activeProvider, { all: true })
        .then((txs: FinancialTransaction[]) => {
          setHistoryTransactions(
            (txs ?? []).filter(
              (tx: FinancialTransaction) => tx.provider === activeProvider,
            ),
          );
        })
        .catch((err: unknown) => {
          logger.error("Failed to load Katsh history:", err);
        });
    }
  }, [showHistory, activeProvider, api]);

  // Only-Days pricing (owner model, 2026-08-05): `sell_days_lbp` /
  // `sell_credit_lbp` live on `mobile_service_items` but the shared
  // `ServiceItem` (MobileServiceItemsContext) type never maps them through —
  // fetched here directly via the dual-mode adapter (rule 19) rather than
  // widening that shared context, which is out of scope for this ticket.
  // `getActiveMobileServiceItems` is a public read (no role gate), so this is
  // safe for every operator, not just admins.
  const [catalogPricing, setCatalogPricing] = useState<
    Map<number, CatalogPricingRow>
  >(new Map());
  const [tenantCreditSellPriceLbp, setTenantCreditSellPriceLbp] = useState<
    number | null
  >(null);
  // v160: the Only-Days toggle callback needs the catalog override, but it is
  // memoised with an empty dep array (a stable identity every item card depends
  // on). Adding `catalogPricing` to its deps would rebuild every card on load;
  // a ref gives the callback the latest map without touching its identity.
  const catalogPricingRef = useRef(catalogPricing);
  useEffect(() => {
    catalogPricingRef.current = catalogPricing;
  }, [catalogPricing]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [items, settings] = await Promise.all([
          api.getActiveMobileServiceItems(),
          api.getAllSettings(),
        ]);
        if (cancelled) return;
        const map = new Map<number, CatalogPricingRow>();
        for (const it of items) {
          map.set(it.id, {
            sell_days_lbp: it.sell_days_lbp,
            sell_credit_lbp: it.sell_credit_lbp,
            max_returned_credits_usd: it.max_returned_credits_usd,
          });
        }
        setCatalogPricing(map);
        const row = (
          settings as Array<{ key_name: string; value: string }>
        ).find((s) => s.key_name === TELECOM_CREDIT_SELL_PRICE_SETTING_KEY);
        const value = row ? Number(row.value) : NaN;
        if (!cancelled && Number.isFinite(value) && value > 0) {
          setTenantCreditSellPriceLbp(value);
        }
      } catch (err) {
        logger.error("Failed to load Only-Days pricing catalog:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  // LIRA-326: this group's cart, PRICED, published to the basket so another
  // tab can list and pay it. Memoised on exactly what pricing reads (rule 25:
  // a fresh array per render would re-publish forever).
  const pricedLines = useMemo<PricedLine[]>(
    () =>
      Array.from(cart.entries()).flatMap(([key, line]): PricedLine[] => {
        const provider = line.item.provider;
        if (!isBasketProvider(provider)) return [];
        const unitPrice = lineUnitPriceOf(
          line,
          catalogPricing,
          tenantCreditSellPriceLbp,
          alfaCreditSellRate,
        );
        const cost = calcCost(line.item);
        const subItems = catalogBatchSubItems(line, unitPrice, cost);
        return [
          {
            key,
            provider,
            label: `${formatCatalogItemName(line.item)} x${line.quantity}`,
            // Today's partner-order note for this line (LIRA-327).
            partnerNote: `${formatCatalogItemName(line.item)}${line.quantity > 1 ? ` x${line.quantity}` : ""}${line.onlyDays ? " [Only Days]" : ""}`,
            sheetItem: {
              key,
              name: line.item.label,
              group: cardGroupLabel(line.item),
              image: getCardImage(line.item),
              quantity: line.quantity,
              unitPrice,
              currency: "LBP",
              note: line.onlyDays ? "Only days" : undefined,
              provider: providerBrandOf(line.item.provider),
            },
            currency: "LBP",
            amount: unitPrice * line.quantity,
            cost: cost * line.quantity,
            commission: subItems.reduce((s, x) => s + x.commission, 0),
            subItems,
          },
        ];
      }),
    [cart, catalogPricing, tenantCreditSellPriceLbp, alfaCreditSellRate],
  );
  useEffect(() => {
    setPriced(pricedLines);
  }, [pricedLines, setPriced]);

  // ── Self-charge (LIRA-090 §5.2, carrier-lines-validity plan Phase 5 / D5) ──
  // Item-card entry point: charge an eligible iPick/Katsh item straight to
  // the shop's own primary MTC/Alfa line — no customer, no sale row, no
  // profit row. The target line is resolved automatically via
  // getPrimary(carrier) (there is one line per carrier today — §0.5)
  // instead of offered as a picker.
  const [primaryLines, setPrimaryLines] = useState<
    Record<"alfa" | "mtc", CarrierLineEntity | null>
  >({ alfa: null, mtc: null });
  const [selfChargeItem, setSelfChargeItem] = useState<ServiceItem | null>(
    null,
  );
  const [selfChargeSubmitting, setSelfChargeSubmitting] = useState(false);
  const [selfChargeError, setSelfChargeError] = useState("");
  const [selfChargeResult, setSelfChargeResult] = useState<{
    costLbp: number;
    creditsAdded: number;
    validityDaysAdded: number;
  } | null>(null);

  const loadPrimaryLines = useCallback(async () => {
    try {
      const [mtc, alfa] = await Promise.all([
        api.getPrimaryCarrierLine("mtc"),
        api.getPrimaryCarrierLine("alfa"),
      ]);
      setPrimaryLines({
        mtc: mtc.success ? (mtc.data ?? null) : null,
        alfa: alfa.success ? (alfa.data ?? null) : null,
      });
    } catch (err) {
      logger.error("Failed to load primary carrier lines:", err);
    }
  }, [api]);

  useEffect(() => {
    loadPrimaryLines();
  }, [loadPrimaryLines]);

  // Reset and defer card grid rendering on every provider switch so the shell
  // (search bar + proceed button) paints before the heavy DOM is created.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItemsReady(false);
    const rafId = requestAnimationFrame(() => {
      startTransition(() => setItemsReady(true));
    });
    return () => cancelAnimationFrame(rafId);
  }, [activeProvider]);

  // ─── Stable callbacks (functional setState only; setCart is stable) ───────

  const handleCardClick = useCallback(
    (item: ServiceItem) => {
      if (isTelecomVoucher(item)) {
        setExpandedKeys((prev) => {
          if (prev.has(item.key)) return prev;
          const next = new Set(prev);
          next.add(item.key);
          return next;
        });
      }
      setCart((prev) => {
        if (prev.has(item.key)) return prev;
        const next = new Map(prev);
        next.set(item.key, {
          item,
          quantity: 1,
          onlyDays: false,
          returnedCreditsUsd: 0,
          returnedCreditsEdited: false,
        });
        return next;
      });
    },
    [setCart],
  );

  const handleQtyDecrease = useCallback(
    (item: ServiceItem) => {
      setCart((prev) => {
        const existing = prev.get(item.key);
        if (!existing) return prev;
        const newQty = existing.quantity - 1;
        if (newQty <= 0) {
          const next = new Map(prev);
          next.delete(item.key);
          return next;
        }
        const next = new Map(prev);
        next.set(item.key, { ...existing, quantity: newQty });
        return next;
      });
    },
    [setCart],
  );

  const handleQtyIncrease = useCallback(
    (item: ServiceItem) => {
      setCart((prev) => {
        const existing = prev.get(item.key);
        const next = new Map(prev);
        if (existing) {
          next.set(item.key, { ...existing, quantity: existing.quantity + 1 });
        } else {
          next.set(item.key, {
            item,
            quantity: 1,
            onlyDays: false,
            returnedCreditsUsd: 0,
            returnedCreditsEdited: false,
          });
        }
        return next;
      });
    },
    [setCart],
  );

  const handleOnlyDaysChange = useCallback(
    (item: ServiceItem, checked: boolean) => {
      setCart((prev) => {
        const existing = prev.get(item.key);
        if (!existing) return prev;
        let returnedCredits = 0;
        if (checked) {
          // LIRA-090 rule 14: use the shared gate and formula from core — never
          // re-encode `Math.floor(denom/0.5)*0.5` (the old third formula copy).
          if (
            isTelecomSplitComplete({
              cost_lbp: item.catalogCost,
              days_cost_lbp: item.days_cost_lbp,
              credits: item.credits,
            })
          ) {
            // Split-complete: the item's own credits field, through the v160
            // resolver so a configured override autofills instead of the
            // bare-card number (the 77.28 card prefills 73.5, not 73).
            returnedCredits = resolveMaxReturnedCredits(
              item.credits as number,
              item.id != null
                ? catalogPricingRef.current.get(item.id)
                    ?.max_returned_credits_usd
                : undefined,
            );
          } else {
            // Split-incomplete: legacy fallback — parse the label as denomination
            // (e.g. "77" → 77), floor to 0.5$ step with the SMS-cap formula.
            //
            // Deliberately NOT routed through resolveMaxReturnedCredits: this
            // branch has no catalog row (that is what makes it the fallback),
            // so there is no override to apply and nothing to resolve against.
            // Leave it computing.
            const denomination = parseFloat(item.label);
            if (!isNaN(denomination)) {
              returnedCredits = maxReturnableCredits(denomination);
            }
          }
        }
        const next = new Map(prev);
        next.set(item.key, {
          ...existing,
          onlyDays: checked,
          returnedCreditsUsd: returnedCredits,
          // Enabling Only Days resets the "edited" flag — the value above is
          // the computed default, not an operator override.
          returnedCreditsEdited: false,
          // Owner pricing model (2026-08-05): reset both price overrides too,
          // so re-toggling Only Days always starts from the catalog defaults
          // rather than an override left over from a previous toggle.
          sellDaysLbpOverride: undefined,
          creditPriceLbpOverride: undefined,
        });
        return next;
      });
    },
    [setCart],
  );

  const handleReturnedCreditsChange = useCallback(
    (item: ServiceItem, value: number) => {
      setCart((prev) => {
        const existing = prev.get(item.key);
        if (!existing) return prev;
        const next = new Map(prev);
        // LIRA-090 B2: mark edited so the submit path sends the override rather
        // than omitting `returnedCreditsUsd` (which would let the repo compute
        // its own default and silently ignore the operator's intention).
        next.set(item.key, {
          ...existing,
          returnedCreditsUsd: value,
          returnedCreditsEdited: true,
        });
        return next;
      });
    },
    [setCart],
  );

  // Owner pricing model (2026-08-05): editable overrides for the Only-Days
  // sale price. Both fire only from a panel that renders exclusively when
  // the catalog already has a `sell_days_lbp` (see ItemCard above) — a line
  // without one can never acquire an override, which is what keeps the
  // FALLBACK behaviour airtight.
  const handleSellDaysLbpChange = useCallback(
    (item: ServiceItem, value: number) => {
      setCart((prev) => {
        const existing = prev.get(item.key);
        if (!existing) return prev;
        const next = new Map(prev);
        next.set(item.key, { ...existing, sellDaysLbpOverride: value });
        return next;
      });
    },
    [setCart],
  );

  const handleCreditPriceLbpChange = useCallback(
    (item: ServiceItem, value: number) => {
      setCart((prev) => {
        const existing = prev.get(item.key);
        if (!existing) return prev;
        const next = new Map(prev);
        next.set(item.key, { ...existing, creditPriceLbpOverride: value });
        return next;
      });
    },
    [setCart],
  );

  const toggleCategoryCollapse = useCallback((category: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }, []);

  // Carrier-lines-validity plan Phase 5 / D5 — opens the confirm modal for a
  // self-charge-eligible item. Disabled targets (no primary line) are
  // filtered at the button (ItemCard), so this only ever fires when a
  // target line exists.
  const handleSelfChargeClick = useCallback((item: ServiceItem) => {
    setSelfChargeItem(item);
    setSelfChargeError("");
    setSelfChargeResult(null);
  }, []);

  const closeSelfCharge = useCallback(() => {
    setSelfChargeItem(null);
    setSelfChargeError("");
    setSelfChargeResult(null);
  }, []);

  // Writes a TELECOM_SELF_CHARGE transaction
  // (FinancialServiceRepository.selfChargeTelecomItem) — debits the item's
  // own iPick/Katsh LBP drawer and credits the carrier's primary line's
  // credits/validity by the item's own `credits`/`validity_days`. No
  // arithmetic happens here; the repository owns it — this only collects the
  // item + resolved line and reports what came back.
  const handleConfirmSelfCharge = useCallback(async () => {
    if (!selfChargeItem?.id) return;
    const carrier = selfChargeItem.category.toLowerCase() as "alfa" | "mtc";
    const targetLine = primaryLines[carrier];
    if (!targetLine) return;
    setSelfChargeSubmitting(true);
    setSelfChargeError("");
    try {
      const res = await api.selfChargeTelecomItem({
        mobileServiceItemId: selfChargeItem.id,
        carrierLineId: targetLine.id,
        // The shop's own calendar day, not the server's (untrustworthy on
        // web — Fly runs UTC, the shop is Beirut UTC+3): decides whether the
        // line's validity extension lands as VALID/GRACE/BURNED.
        client_day: localDay(),
      });
      if (!res.success || !res.data) {
        setSelfChargeError(res.error || "Self-charge failed");
        return;
      }
      setSelfChargeResult({
        costLbp: res.data.costLbp,
        creditsAdded: res.data.creditsAdded,
        validityDaysAdded: res.data.validityDaysAdded,
      });
      await loadPrimaryLines();
    } catch (err) {
      // LIRA-247: `err instanceof Error` is false for a thrown ApiError
      // (e.g. a web 403 role refusal), so it used to fall back to this
      // generic string and hide the real reason.
      setSelfChargeError(getApiErrorMessage(err, "Self-charge failed"));
    } finally {
      setSelfChargeSubmitting(false);
    }
  }, [selfChargeItem, primaryLines, api, loadPrimaryLines]);

  // LIRA-157 — what the charge would ACTUALLY do to the line, computed with the
  // repository's own rule so the dialog cannot promise something the write path
  // refuses. Three outcomes matter to the operator:
  //   burned  → the line is past the 5-day revival grace; the charge is refused
  //             server-side, so the button is disabled rather than failing late
  //   capped  → part of the card's days are lost to the 365-day ceiling
  //   GRACE   → the line is lapsed but revivable; the new validity starts today
  //
  // Lives ABOVE the early return, with the other hooks, and therefore derives
  // the carrier and target line itself instead of reusing the `selfCharge*`
  // locals below (rules-of-hooks: a hook after a conditional return is called
  // conditionally). Same two values, same source state.
  const selfChargeValidityProjection = useMemo(() => {
    const requestedDays = selfChargeItem?.validityDays;
    if (!selfChargeItem || requestedDays == null || requestedDays <= 0) {
      return null;
    }
    const carrier = selfChargeItem.category.toLowerCase() as "alfa" | "mtc";
    const targetLine = primaryLines[carrier];
    if (!targetLine) return null;

    // M7 fix (2026-09-24 adversarial review): pass the line's CURRENT
    // days_owed balance (#28) through as the 4th arg — omitting it made
    // this preview show the full `requestedDays` landing on the real
    // expiry with `owedApplied` always 0, disagreeing with the server (one
    // shared rule, rule 14, means BOTH callers read the same daysOwed
    // input, not just the same function). Example: 210 owed, a 365-day
    // card — the server lands at today+155; this preview used to claim
    // today+365.
    const projection = projectValidityExpiry(
      targetLine.validity_expires_at,
      requestedDays,
      undefined,
      targetLine.days_owed ?? 0,
    );
    return {
      ...projection,
      requestedDays,
      /** Days the line actually gains ON THE REAL EXPIRY once the ceiling
       *  has taken its cut AND any days_owed payoff has been split out —
       *  `projection.owedApplied` is the portion that went to the debt
       *  instead (M7). */
      appliedDays:
        requestedDays - projection.daysLostToCap - projection.owedApplied,
    };
  }, [selfChargeItem, primaryLines]);

  if (!activeConfig || !activeProvider) return null;

  const billAccent = billAccentFor(activeProvider);

  const categories = getCategoriesForProvider(activeProvider);

  // Resolved once per render for the self-charge confirm modal below — the
  // modal only ever shows one item at a time, so this is cheap to derive
  // straight from state rather than threaded through as extra props.
  const selfChargeCarrier: "alfa" | "mtc" | null = selfChargeItem
    ? (selfChargeItem.category.toLowerCase() as "alfa" | "mtc")
    : null;
  const selfChargeTargetLine = selfChargeCarrier
    ? primaryLines[selfChargeCarrier]
    : null;

  const selfChargeBlocked = selfChargeValidityProjection?.burned === true;

  const filterItemsBySearch = (items: ServiceItem[]): ServiceItem[] => {
    if (!searchQuery.trim()) return items;
    const query = searchQuery.toLowerCase();
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(query) ||
        item.subcategory.toLowerCase().includes(query) ||
        item.category.toLowerCase().includes(query),
    );
  };

  // The price ONE unit of a cart line is charged at (the Only Days price for
  // an Only Days line). Shared by the total and the payment window's item
  // list, so the listed lines always add up to what is charged.
  const lineUnitPrice = (line: CartLineItem): number =>
    lineUnitPriceOf(
      line,
      catalogPricing,
      tenantCreditSellPriceLbp,
      alfaCreditSellRate,
    );

  const totalPrice = Array.from(cart.values()).reduce(
    (sum, line) => sum + lineUnitPrice(line) * line.quantity,
    0,
  );

  // Items listed at the top of the payment window: one per cart line, then
  // one per pending bill (in its own currency). Plain const like totalPrice —
  // this sits after the early return above, so it cannot be a hook.
  // LIRA-327: each bill under its OWN provider (the tab it was added on).
  const paymentSheetItems: PaymentSheetItem[] = [
    ...pricedLines.map((l) => l.sheetItem),
    ...billLines.map((l) => l.sheetItem),
  ];

  // LIRA-090 B1: cost is always GROSS (full cost_lbp). The repo nets it to
  // days_cost_lbp via processTelecomCreditReturn when mobileServiceItemId is
  // present. The discount gate only needs the shelf cost of the items anyway.
  const totalCost = Array.from(cart.values()).reduce((sum, line) => {
    return sum + calcCost(line.item) * line.quantity;
  }, 0);

  // Max discount = total commission (sell - cost), discount cannot exceed profit
  const maxDiscount = Math.max(0, totalPrice - totalCost);

  // LIRA-326 — the providers this payment would book: this cart's lines (each
  // under its OWN provider), the bills (LIRA-327: each under the tab it was
  // added on) and the Whish App group's lines. One provider → today's single
  // sale under that provider; two or more → ONE basket payment.
  const basketLines = [...pricedLines, ...billLines, ...others];
  const payingProviders = basketProviders(basketLines);
  const isMixedBasket =
    !activeSession && !forPartner && payingProviders.size > 1;
  const basketSheet = basketSheetSummary(basketLines);
  // Everything in the basket (every tab's cards + bills) — what a partner
  // order submits and what turning For Partner on asks about.
  const basketCount = basketItemCount(basketLines);
  // The single-sale path books under the cart's own provider (an iPick-only
  // cart paid from the Katsh tab is an iPick sale); each bill under its own.
  const ownProviders = basketProviders(pricedLines);
  const saleProvider: "Katsh" | "iPick" =
    ownProviders.size === 1 && ownProviders.has("iPick")
      ? "iPick"
      : ownProviders.size === 1 && ownProviders.has("Katsh")
        ? "Katsh"
        : activeProvider === "iPick"
          ? "iPick"
          : "Katsh";

  const totalItems = Array.from(cart.values()).reduce(
    (sum, line) => sum + line.quantity,
    0,
  );
  // The Bill card lists the bills added on THIS tab (LIRA-327); the header
  // and the payment window show every staged bill.
  const tabBills = pendingBills.filter((b) => b.provider === activeProvider);
  // A partner order submits the WHOLE basket (every tab), so it can go even
  // when this tab's own grid is empty.
  const proceedDisabled = forPartner
    ? basketCount === 0 || !selectedPartnerId || isSubmittingPartner
    : totalItems === 0 && pendingBills.length === 0;

  const getCartCountForCategory = (category: string): number =>
    Array.from(cart.values())
      .filter(
        (line) =>
          line.item.category === category &&
          line.item.provider === activeProvider,
      )
      .reduce((sum, line) => sum + line.quantity, 0);

  const handleAddItem = async () => {
    if (!newItemForm) return;
    setAddItemError("");
    const provider = newItemForm.provider as ProviderKey;
    const built = buildNewServiceItemPayload(
      newItemForm,
      categories,
      (category) =>
        getServiceItems(provider, category).map((i) => i.subcategory),
    );
    if (!built.ok) {
      setAddItemError(built.error);
      return;
    }
    try {
      // LIRA-090: migrated from raw window.api.* to useApi() (rule 19).
      const res = await api.createMobileServiceItem(built.payload);
      if (!res.success) {
        setAddItemError(res.error ?? "Failed to create item");
        return;
      }
      setNewItemForm(null);
      await onRefreshItems?.();
    } catch {
      setAddItemError("Create failed");
    }
  };
  const cancelNewItem = () => {
    setNewItemForm(null);
    setAddItemError("");
  };

  const handleAddBill = () => {
    const parsed = parseFloat(billAmount.replace(/,/g, ""));
    if (!parsed || parsed <= 0) {
      alert("Enter a valid bill amount");
      return;
    }
    const providerLabel = activeProvider === "Katsh" ? "Katsh" : "iPick";
    const display =
      billCurrency === "LBP"
        ? `${Math.round(parsed).toLocaleString()} LBP`
        : `$${parsed.toFixed(2)}`;

    // A partner bill never enters the session basket (mirrors the Proceed
    // button's forPartner early-return below) — it stages as a pendingBill
    // and submits through handleForPartnerSubmit regardless of session state.
    if (activeSession && !forPartner) {
      addToSessionCart({
        module: activeProvider === "Katsh" ? "katsh" : "ipick",
        label: `${providerLabel} BILL — ${display}`,
        amount: parsed,
        currency: billCurrency,
        ipcChannel: "financial:create",
        formData: {
          provider: activeProvider,
          serviceType: "BILL",
          amount: parsed,
          cost: parsed,
          price: parsed,
          currency: billCurrency,
          commission: 0,
          paidByMethod: "CASH",
          // Bug #4: the time picked on the form, as on a bill paid alone.
          ...(transactionTime !== undefined
            ? { transaction_time: transactionTime }
            : {}),
        },
      });
      setBillAmount("");
      return;
    }

    // A USD bill needs a rate in the walk-in aggregation only — the
    // PaymentSheet converts every leg to one cross-currency total. A partner
    // bill books in its OWN currency alone (no PaymentSheet, no total), so
    // the rate guard doesn't apply to it.
    if (!forPartner) {
      const involvesUsd =
        billCurrency === "USD" ||
        pendingBills.some((b) => b.currency === "USD");
      if (involvesUsd && !(exchangeRate > 0)) {
        alert(
          "An exchange rate is required to pay USD bills — set today's rate first.",
        );
        return;
      }
    }
    // LIRA-327: the bill belongs to THIS tab's provider, wherever it is paid.
    setBills((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        provider: activeProvider === "Katsh" ? "Katsh" : "iPick",
        amount: parsed,
        currency: billCurrency,
      },
    ]);
    setBillAmount("");
  };

  // LIRA-327 — turning For Partner on while the basket already holds items
  // makes ALL of them (every tab's) a partner order: ask first.
  const handleForPartnerChange = (next: boolean) => {
    if (
      next &&
      partnerShared &&
      basketCount > 0 &&
      !window.confirm(partnerConfirmMessage(basketCount))
    ) {
      return;
    }
    setForPartner(next);
  };

  // PFT-3b / LIRA-327: a "for partner" order bypasses the session basket,
  // the PaymentSheet, and the client/discount/kept-change/bill-carrier
  // machinery entirely (no walk-in customer, no counter payment). It is
  // basket-wide: ONE submit books every provider's partner sales — each tab's
  // cards and bills, the Whish App units too — exactly as today's per-tab
  // submit wrote them, each costed against its own provider, all or nothing
  // (core RechargePartnerOrderService).
  const handleForPartnerSubmit = async () => {
    if (basketLines.length === 0 || isSubmittingPartner) return;
    if (!selectedPartnerId) {
      appEvents.emit(
        "notification:show",
        "Select a partner for this transaction.",
        "warning",
      );
      return;
    }

    setIsSubmittingPartner(true);
    const billProviders = new Set(pendingBills.map((b) => b.provider));
    const result = await submitPartnerOrder({
      lines: basketLines,
      partnerId: selectedPartnerId,
      transactionTime,
    });
    if (result.success) {
      appEvents.emit(
        "notification:show",
        "Partner order submitted successfully",
        "success",
      );
      // A Katsh/iPick BILL is `commission_model = 1` (COMMISSION_AT_
      // SETTLEMENT_PLAN.md §4 Phase 1) — it joins the Suppliers -> Settle
      // unsettled queue immediately; refresh each bill provider's queue
      // (App.tsx's app-wide 30s staleTime would hide it otherwise).
      for (const provider of billProviders) {
        queryClient.invalidateQueries({
          queryKey: SUPPLIER_KEYS.unsettled(provider),
        });
      }
      // Everything was booked: empty the whole basket (For Partner off).
      clearBasket();
      setExpandedKeys(new Set());
      setTransactionTime(undefined);
    } else {
      // Nothing was booked — the basket stays as it was.
      logger.error("Partner order submit failed:", result.error);
      alert(result.error);
    }
    loadFinancialData();
    setIsSubmittingPartner(false);
  };

  const handleSubmit = async () => {
    if ((cart.size === 0 && pendingBills.length === 0) || localSubmitting)
      return;

    const clientResult = await ensureRechargeClient({
      clientId,
      inSession: !!activeSession,
      name: clientName,
      phone: clientPhone,
      // An OUT CUSTOMER_ACCOUNT (change to account) leg needs a client too.
      paymentLines: [...paymentLines, ...returnLegs],
    });
    if (!clientResult.ok) {
      alert(clientResult.error);
      return;
    }
    const resolvedClientId = clientResult.id;
    if (resolvedClientId && resolvedClientId !== clientId) {
      setClientId(resolvedClientId);
    }

    // If session is active, add all cart items as one session cart entry.
    // The basket owns the payment, so the cart sub-items carry NO payment fields
    // (paidByMethod / payments) and no per-item discount — the Session Checkout
    // modal collects payment once for the whole basket and applies any discount
    // there (capped at each item's profit).
    //
    // LIRA-326: ONE session cart entry PER PROVIDER — each item is booked
    // under its own provider at checkout (an iPick item picked on the iPick
    // tab and added from the Katsh tab is an iPick sale, never a Katsh one).
    if (activeSession) {
      const client = {
        clientId: resolvedClientId,
        ...(clientName ? { clientName } : {}),
        // Bug #4: the time picked on the form, as on a walk-in sale.
        transactionTime,
      };
      for (const entry of basketEntries(pricedLines)) {
        addToSessionCart({
          module: entry.module,
          label: entry.label,
          amount: entry.amount,
          currency: entry.currency,
          ipcChannel: "financial:create",
          formData: {
            _batch: true,
            items: withClient(entry.items, client),
          },
        });
      }

      // Reset form
      setCart(new Map());
      setClientName("");
      setClientPhone("");
      setClientId(null);
      setExpandedKeys(new Set());
      setReturnLegs([]);
      setKeptChange(null);
      return;
    }

    // LIRA-326 — items from two or more providers: ONE payment for the whole
    // basket (every tab's cards, the staged bills — LIRA-327 — and the Whish
    // App lines), recorded by the server as a walk-in customer session with
    // one sale per provider and one BILL per bill.
    if (isMixedBasket) {
      setLocalSubmitting(true);
      const result = await checkoutBasket({
        lines: basketLines,
        discount: basketSheet.singleCurrency ? discount : 0,
        payments: paymentLines,
        returnLegs,
        paidByMethod: isSplitPayment ? "MULTI" : paymentMethod,
        exchangeRate: effectiveRate ?? exchangeRate,
        keptChange,
        extra:
          basketSheet.currency === "USD"
            ? { usd: extraCharge, lbp: 0 }
            : { usd: 0, lbp: extraCharge },
        client: {
          clientId: resolvedClientId,
          clientName,
          clientPhone,
        },
      });
      if (result.success) {
        appEvents.emit(
          "notification:show",
          "Basket paid successfully",
          "success",
        );
        // LIRA-327: paid bills join their provider's Settle queue.
        for (const provider of new Set(pendingBills.map((b) => b.provider))) {
          queryClient.invalidateQueries({
            queryKey: SUPPLIER_KEYS.unsettled(provider),
          });
        }
        clearBasket();
        setClientName("");
        setClientPhone("");
        setClientId(null);
        setExpandedKeys(new Set());
        setReturnLegs([]);
        setKeptChange(null);
        setExtraCharge(0);
        setTransactionTime(undefined);
        if (
          paymentMethod === "CUSTOMER_ACCOUNT" ||
          paymentLines.some((l) => l.method === "CUSTOMER_ACCOUNT") ||
          returnLegs.some((l) => l.method === "CUSTOMER_ACCOUNT")
        ) {
          window.dispatchEvent(new CustomEvent("debt-ledger-changed"));
        }
        // Booked as a session checkout: an on-account part is a Session
        // Debt row — let the TopBar's session balance badge refresh.
        appEvents.emit("debt:changed");
      } else {
        // The basket stays as it was — nothing was booked.
        alert(result.error);
      }
      loadFinancialData();
      setLocalSubmitting(false);
      return;
    }

    setLocalSubmitting(true);

    const finalPaymentMethod = isSplitPayment ? "MULTI" : paymentMethod;
    const paymentsPayload =
      paymentLines.length > 0
        ? toCamelLegs(paymentLines, returnLegs)
        : undefined;
    // checkoutTotal (Payment-Legs Integrity plan wave 8): the carrier's own
    // `amount` covers only the cart items (or one bill) — the payment legs
    // it carries cover the WHOLE checkout (items + bills together). Mirrors
    // the PaymentSheet's own total math below (totalAmount/totalAmountCurrency
    // = billsOnlyUsd ? billsTotal : totalPrice + billsLbpValue, in
    // billsCurrency), net of the same `discount` MultiPaymentInput already
    // applied, so the repository can reconcile legs against the real
    // customer-owed total instead of one item's/bill's own price.
    const checkoutTotalNative = Math.max(
      0,
      (billsOnlyUsd ? billsTotal : totalPrice + billsLbpValue) - discount,
    );
    const checkoutTotal =
      billsCurrency === "USD"
        ? { usd: checkoutTotalNative, lbp: 0 }
        : { usd: 0, lbp: checkoutTotalNative };
    // LIRA-319 — `checkoutTotal` above stays pre-extra (the repository adds
    // the extra to every total it reconciles).
    const extraField =
      extraCharge > 0
        ? billsCurrency === "USD"
          ? { extra_usd: extraCharge }
          : { extra_lbp: extraCharge }
        : {};

    // CARRIER_LEGS_VOID_ASYMMETRY.md (design B+): stamp ONE shared uuid
    // across every unit of a multi-unit checkout (the aggregated items SEND,
    // plus each bill) so the void path can find and guard the whole group —
    // voiding a single unit alone would leave the checkout's money non-zero
    // (the carrier owns ALL the legs; siblings only defer cost/commission).
    // Only when there's an actual carrier (paymentsPayload !== undefined) —
    // a no-legs checkout (session-deferred mode) never hits this asymmetry.
    // Single-unit checkouts get no split metadata (no noise).
    const totalCheckoutUnits = (cart.size > 0 ? 1 : 0) + pendingBills.length;
    const useSplitGroup =
      totalCheckoutUnits > 1 && paymentsPayload !== undefined;
    const splitGroupId = useSplitGroup ? crypto.randomUUID() : undefined;

    // true when there are no catalog items to process (bill-only flow)
    let allSucceeded = cart.size === 0;
    // LIRA-069 W1.d — the carrier is the one transaction whose payment legs
    // (and therefore whose printed receipt) actually reflect what the
    // customer paid; siblings are deferPayment (no legs) so printing one of
    // THOSE would show no payment lines at all.
    let carrierSourceId: number | undefined;

    if (cart.size > 0) {
      const cartItems = Array.from(cart.values());

      // LIRA-302: the cart is described ONCE, in core's buildCatalogSalePayload
      // (shared with the phone app, rule 22). Each line carries its unit price
      // as this form prices it (Only-Days lines included) and its GROSS cost
      // (LIRA-090 B1: no pre-netting — the repo handles Only-Days credit
      // returns via telecomCreditReturns below).
      const catalogLines = cartItems.map((line) => ({
        item: {
          // LIRA-329: the catalog key, kept on the sale's details.
          key: line.item.key,
          category: line.item.category,
          label: line.item.label,
          subcategory: line.item.subcategory,
          cost_lbp: calcCost(line.item),
          sell_lbp: calcPrice(
            line.item,
            line.onlyDays,
            line.returnedCreditsUsd,
            alfaCreditSellRate,
            resolveOnlyDaysPricing(
              line,
              catalogPricing,
              tenantCreditSellPriceLbp,
            ).total,
          ),
        },
        quantity: line.quantity,
        noteSuffix: line.onlyDays ? " [Only Days]" : undefined,
        ...(line.onlyDays
          ? { onlyDays: true, returnedCreditsUsd: line.returnedCreditsUsd }
          : {}),
      }));
      const totals = catalogCartTotals(catalogLines);
      const discountedTotal = totals.price - discount;
      const aggregatedCommission = Math.max(0, discountedTotal - totals.cost);

      // LIRA-090 §6.2 (walk-in aggregated payload): the aggregated SEND bundles
      // all cart lines into ONE transaction. For Only-Days lines, the repo needs
      // a per-line credit-return entry so it can book each carrier's drawer
      // movement separately. Build one entry per Only-Days line (expanding qty
      // so the repo sees each physical unit). The scalar `mobileServiceItemId` /
      // `returnedCreditsUsd` fields are NOT set on the aggregated call — the
      // array owns the Only-Days semantics here (spec §6 contract).
      const telecomCreditReturnsLines = cartItems.flatMap((line) => {
        if (!line.onlyDays) return [];
        const splitComplete = isTelecomSplitComplete({
          cost_lbp: line.item.catalogCost,
          days_cost_lbp: line.item.days_cost_lbp,
          credits: line.item.credits,
        });
        const entry = {
          itemCategory: line.item.category,
          ...(splitComplete && line.item.id != null
            ? { mobileServiceItemId: line.item.id }
            : {}),
          // Only forward returnedCreditsUsd when operator explicitly edited it,
          // or when the item has no complete split (manual path always forwards it).
          ...(line.returnedCreditsEdited || !splitComplete
            ? { returnedCreditsUsd: line.returnedCreditsUsd }
            : {}),
        };
        // One entry per physical unit so the repo credits/movements once per unit.
        return Array.from({ length: line.quantity }, () => entry);
      });
      const hasTelecomReturns = telecomCreditReturnsLines.length > 0;

      try {
        const result = await api.addOMTTransaction({
          ...buildCatalogSalePayload({
            // LIRA-326: the cart's own provider, never the tab's.
            provider: saleProvider,
            lines: catalogLines,
            paidByMethod: finalPaymentMethod,
            payments: paymentsPayload,
          }),
          // Web-only on top of the shared cart: the discount lowers what the
          // customer pays (and the margin) …
          amount: discountedTotal,
          commission: aggregatedCommission,
          // LIRA-329: … and is kept as typed on the sale's details.
          ...(discount > 0
            ? { typedDiscount: { amount: discount, currency: "LBP" } }
            : {}),
          // … and the carrier's checkout total covers the WHOLE checkout
          // (items + bills), not just this cart.
          checkoutTotal:
            paymentsPayload !== undefined ? checkoutTotal : undefined,
          // Payment-Legs Integrity plan (Wave 9 + false-reject fix): the
          // rate this form's own PaymentSheet/MultiPaymentInput actually
          // converted tender at — captured live via onExchangeRateChange
          // (falls back to the `exchangeRate` prop if the sheet never fired,
          // e.g. no legs at all), so the repository reconciles legs at the
          // SAME rate the till used instead of falling back to its own
          // (sell-side) stamped rate.
          tender_exchange_rate:
            paymentsPayload !== undefined
              ? (effectiveRate ?? exchangeRate)
              : undefined,
          // Kept change rides the legs-carrying items txn (lira-095 convention).
          ...(keptChange && (keptChange.usd > 0 || keptChange.lbp > 0)
            ? {
                kept_change_usd: keptChange.usd,
                kept_change_lbp: keptChange.lbp,
              }
            : {}),
          // CARRIER_LEGS_VOID_ASYMMETRY.md (design B+): the aggregated items
          // call is always the checkout's carrier when it exists (bills only
          // ever carry legs when there are NO items — see itemsCarriedLegs
          // below).
          ...(useSplitGroup
            ? {
                split_group: splitGroupId,
                split_role: "carrier" as const,
                split_units: totalCheckoutUnits,
              }
            : {}),
          // LIRA-090 §6.2: per-line credit-return array for the aggregated cart.
          ...(hasTelecomReturns
            ? { telecomCreditReturns: telecomCreditReturnsLines }
            : {}),
          // LIRA-319: the items call is the checkout's carrier.
          ...extraField,
          clientId: resolvedClientId || undefined,
          clientName: clientName || undefined,
          transaction_time: transactionTime,
        });

        if (result?.success) {
          allSucceeded = true;
          carrierSourceId = result.id;
          if (activeSession && result.id) {
            try {
              await linkTransaction({
                transactionType: "financial_service",
                transactionId: result.id,
                amountUsd: 0,
                amountLbp: discountedTotal,
                profitLbp: aggregatedCommission,
              });
            } catch (err) {
              logger.error("Failed to link Katsh tx to session:", err);
            }
          }
        } else {
          logger.error("Katsh submit failed:", result?.error);
          alert(result?.error || "Failed to process payment");
        }
      } catch (err) {
        logger.error("Katsh submit error:", err);
        alert("Failed to process payment");
      }
    }

    // Process pending bills (non-session mode only). Each bill is its own
    // BILL transaction (per-bill supplier commission + audit row), but the
    // PaymentSheet legs (incl. change/return OUT legs for overpayment) book
    // exactly once against the checkout's CARRIER: the aggregated items SEND
    // above when the cart had items, otherwise the first bill. Every other
    // bill is deferPayment (cost + commission only) — attaching the same legs
    // to a second transaction would multiply the drawer inflow.
    if (pendingBills.length > 0 && allSucceeded) {
      const itemsCarriedLegs = cart.size > 0;
      for (let i = 0; i < pendingBills.length; i++) {
        const bill = pendingBills[i];
        const isCarrier = !itemsCarriedLegs && i === 0;
        try {
          const billResult = await api.addOMTTransaction({
            // LIRA-327: the bill's OWN provider (the tab it was added on).
            provider: bill.provider,
            serviceType: "BILL",
            amount: bill.amount,
            cost: bill.amount,
            price: bill.amount,
            currency: bill.currency,
            commission: 0,
            paidByMethod: finalPaymentMethod,
            payments: isCarrier ? paymentsPayload : undefined,
            checkoutTotal:
              isCarrier && paymentsPayload !== undefined
                ? checkoutTotal
                : undefined,
            // Payment-Legs Integrity plan (Wave 9 + false-reject fix) — see
            // the items branch above for the full rationale.
            tender_exchange_rate:
              isCarrier && paymentsPayload !== undefined
                ? (effectiveRate ?? exchangeRate)
                : undefined,
            // Kept change rides the legs-carrying first bill (no items case).
            ...(isCarrier &&
            keptChange &&
            (keptChange.usd > 0 || keptChange.lbp > 0)
              ? {
                  kept_change_usd: keptChange.usd,
                  kept_change_lbp: keptChange.lbp,
                }
              : {}),
            deferPayment: isCarrier ? undefined : true,
            // LIRA-319: only the carrier bill (no items) takes the extra.
            ...(isCarrier ? extraField : {}),
            // CARRIER_LEGS_VOID_ASYMMETRY.md (design B+) — see the items
            // branch above for the full rationale.
            ...(useSplitGroup
              ? {
                  split_group: splitGroupId,
                  split_role: isCarrier
                    ? ("carrier" as const)
                    : ("sibling" as const),
                  split_units: totalCheckoutUnits,
                }
              : {}),
            clientId: resolvedClientId || undefined,
            clientName: clientName || undefined,
            transaction_time: transactionTime,
          });
          if (billResult?.success) {
            if (isCarrier) carrierSourceId = billResult.id;
          } else {
            allSucceeded = false;
            setBills(pendingBills.slice(i));
            logger.error("Bill submit failed:", billResult?.error);
            alert(billResult?.error || "Failed to process bill");
            break;
          }
        } catch (err) {
          allSucceeded = false;
          setBills(pendingBills.slice(i));
          logger.error("Bill submit error:", err);
          alert("Failed to process bill");
          break;
        }
      }
      if (allSucceeded) {
        setBills([]);
      }
      // See the matching comment in handleForPartnerSubmit above — a
      // Katsh/iPick BILL is commission_model = 1 and joins the Suppliers
      // -> Settle unsettled queue immediately, but nothing on this path ever
      // invalidated that query, so it stayed stale for up to 30s. One per
      // bill provider (LIRA-327: a bill keeps its own provider).
      for (const provider of new Set(pendingBills.map((b) => b.provider))) {
        queryClient.invalidateQueries({
          queryKey: SUPPLIER_KEYS.unsettled(provider),
        });
      }
    }

    if (allSucceeded) {
      appEvents.emit(
        "notification:show",
        "Bills processed successfully",
        "success",
      );
      void autoPrintReceipt({
        type: "FINANCIAL_SERVICE",
        provider:
          cart.size > 0
            ? saleProvider
            : (pendingBills[0]?.provider ?? saleProvider),
        sourceTable: "financial_services",
        sourceId: carrierSourceId,
        hasActiveSession: !!activeSession,
      });
      setCart(new Map());
      setClientName("");
      setClientPhone("");
      setClientId(null);
      setExpandedKeys(new Set());
      setReturnLegs([]);
      setKeptChange(null);
      setExtraCharge(0);
      setTransactionTime(undefined);
      const hasDebtPayment =
        paymentMethod === "CUSTOMER_ACCOUNT" ||
        paymentLines.some((l) => l.method === "CUSTOMER_ACCOUNT");
      if (hasDebtPayment) {
        window.dispatchEvent(new CustomEvent("debt-ledger-changed"));
      }
    }
    loadFinancialData();
    setLocalSubmitting(false);
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Top Row: Search Bar + Proceed to Pay — sticky so it never scrolls away */}
      <div className="sticky -top-1 z-10 flex items-center gap-3 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 pb-1">
        <div className="relative flex-1">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={`Search ${activeProvider} items...`}
            className={`w-full px-4 py-2.5 pl-10 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none ${billAccent.brand.searchFocus} transition-all`}
          />
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
              aria-label="Clear search"
              type="button"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {totalItems > 0 && (
            <div className="text-right leading-tight">
              <div className="text-xs text-white font-bold">
                {totalItems} items
              </div>
              <div className="text-xs text-emerald-400 font-mono font-semibold">
                {totalPrice.toLocaleString()} LBP
              </div>
              {exchangeRate > 0 && (
                <div className="text-xs text-slate-400 font-mono">
                  ${(totalPrice / exchangeRate).toFixed(2)}
                </div>
              )}
            </div>
          )}
          {pendingBills.length > 0 && (!activeSession || forPartner) && (
            <div className="text-right leading-tight">
              <div className={`text-xs font-bold ${billAccent.pendingLabel}`}>
                {pendingBills.length > 1
                  ? `${pendingBills.length} BILLS`
                  : "BILL"}
              </div>
              <div
                className={`text-xs font-mono font-semibold ${billAccent.pendingAmount}`}
              >
                {fmtBill(billsTotal, billsCurrency)}
              </div>
            </div>
          )}
          {/* "For Partner" — same toolbar slot as FinancialForm (Whish App
              → Bills): after the totals, before the Proceed button. */}
          {!activeSession && (
            <ForPartnerToggle
              testId="katsh-for-partner-toggle"
              checked={forPartner}
              onChange={handleForPartnerChange}
              selectedPartnerId={selectedPartnerId}
              onPartnerChange={setSelectedPartnerId}
              autoSelectSingle
              activeClassName={billAccent.brand.solid}
              selectorClassName=""
            />
          )}
          <button
            type="button"
            onClick={() => {
              // PFT-3b: a partner checkout bypasses the session basket AND
              // the PaymentSheet entirely — no walk-in customer, no counter
              // cash, so it never adds to the active session's cart either.
              if (forPartner) {
                handleForPartnerSubmit();
                return;
              }
              // Session mode: add to cart directly (basket owns the payment),
              // skipping the PaymentSheet. Non-session: open the PaymentSheet.
              if (activeSession) {
                handleSubmit();
              } else {
                setShowPaymentSheet(true);
              }
            }}
            disabled={proceedDisabled}
            className={`px-4 py-2.5 rounded-lg font-bold text-sm transition-all whitespace-nowrap ${
              proceedDisabled
                ? "bg-slate-700 text-slate-300 cursor-not-allowed"
                : billAccent.button
            }`}
          >
            {forPartner
              ? isSubmittingPartner
                ? "Submitting..."
                : "Submit to Partner"
              : activeSession
                ? "Add to Cart"
                : "Proceed to Pay"}
          </button>
        </div>
      </div>

      {/* PFT-3b: a partner checkout has NO walk-in customer and takes NO
          counter cash; the full selling price goes on the selected
          partner's tab, settled later on the Partners page. The toggle sits
          in the toolbar row above (same place as on Whish App → Bills). */}
      {forPartner && (
        <ForPartnerNotice testId="katsh-partner-no-payment-notice">
          Partner order: nothing is collected now — everything in the basket, on
          every tab, goes on the partner&apos;s account at full price, settled
          on the Partners page.
        </ForPartnerNotice>
      )}

      {/* Card Grid */}
      {!itemsReady ? (
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3 text-slate-400">
            <div className="w-8 h-8 border-2 border-slate-700 border-t-orange-500 rounded-full animate-spin" />
            <span className="text-sm">Loading items...</span>
          </div>
        </div>
      ) : (
        <div className="space-y-6 pb-2">
          {/* Bill card — always visible at top of grid */}
          {!searchQuery && (
            <div
              className={`bg-slate-800 rounded-xl border ${billAccent.border} p-4`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-bold text-white tracking-widest">
                  BILL
                </div>
                <div className="flex items-center gap-1 bg-slate-900 rounded-lg border border-slate-600 p-0.5">
                  {(["USD", "LBP"] as const).map((cur) => (
                    <button
                      key={cur}
                      type="button"
                      onClick={() => {
                        if (cur === billCurrency) return;
                        setBillCurrency(cur);
                        setBillAmount("");
                      }}
                      className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all ${
                        billCurrency === cur
                          ? billAccent.toggleActive
                          : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      {cur}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-end gap-3">
                <div className="w-1/2">
                  <label className="text-xs text-slate-400 block mb-1">
                    Amount ({billCurrency})
                  </label>
                  <DecimalInput
                    value={parseFloat(billAmount.replace(/,/g, "")) || 0}
                    onChange={(n) => setBillAmount(n ? String(n) : "")}
                    decimals={billCurrency === "USD" ? 2 : 0}
                    className={`w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white font-mono text-sm focus:outline-none ${billAccent.inputFocus}`}
                    placeholder={billCurrency === "LBP" ? "0" : "0.00"}
                  />
                </div>
                <button
                  type="button"
                  onClick={handleAddBill}
                  disabled={
                    !billAmount || parseFloat(billAmount.replace(/,/g, "")) <= 0
                  }
                  className={`w-1/2 py-2 ${billAccent.button} disabled:opacity-40 disabled:cursor-not-allowed text-sm font-semibold rounded-lg transition-colors`}
                >
                  {activeSession && !forPartner
                    ? "Add Bill to Cart"
                    : "Add Bill"}
                </button>
              </div>
              {tabBills.length > 0 && (!activeSession || forPartner) && (
                <div className="mt-2 flex flex-col items-center gap-1">
                  {tabBills.map((bill) => (
                    <div
                      key={bill.id}
                      className={`flex items-center gap-2 text-xs font-mono ${billAccent.pendingLabel}`}
                    >
                      <span>
                        Pending: {fmtBill(bill.amount, bill.currency)}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setBills((prev) =>
                            prev.filter((b) => b.id !== bill.id),
                          )
                        }
                        className="text-slate-500 hover:text-red-400 transition-colors"
                        aria-label="Clear pending bill"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {categories.map((category) => {
            const allCategoryItems = getServiceItems(activeProvider, category);
            const categoryItems = filterItemsBySearch(allCategoryItems);

            // Skip category if no items match search
            if (categoryItems.length === 0) return null;

            return (
              <div
                key={category}
                className="bg-slate-800 rounded-xl border border-slate-700/50 p-4"
              >
                <div
                  onClick={() => toggleCategoryCollapse(category)}
                  className="flex items-center justify-between cursor-pointer select-none"
                >
                  <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: getCategoryColor(category) }}
                    />
                    {category}
                    {getCartCountForCategory(category) > 0 && (
                      <span
                        className={`px-1.5 py-0.5 ${billAccent.brand.badge} text-[10px] font-bold rounded-full leading-none`}
                      >
                        {getCartCountForCategory(category)}
                      </span>
                    )}
                  </h3>
                  <div className="flex items-center gap-1.5">
                    {isAdmin && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setAddItemError("");
                          setNewItemForm(
                            newItemForm?.category === category &&
                              !newItemForm.isNewCategory
                              ? null
                              : emptyNewServiceItemForm(
                                  activeProvider as string,
                                  category,
                                ),
                          );
                        }}
                        className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
                        type="button"
                        title="Add item"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <ChevronDown
                      className={`w-4 h-4 text-slate-400 transition-transform ${
                        collapsedCategories.has(category) ? "-rotate-90" : ""
                      }`}
                    />
                  </div>
                </div>
                {newItemForm?.category === category &&
                  !newItemForm.isNewCategory && (
                    <NewServiceItemInlineForm
                      form={newItemForm}
                      error={addItemError}
                      onChange={setNewItemForm}
                      onSubmit={handleAddItem}
                      onCancel={cancelNewItem}
                    />
                  )}
                <Collapsible open={!collapsedCategories.has(category)}>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 mt-3">
                    {categoryItems.map((item) => {
                      const inCart = cart.get(item.key);
                      const itemCarrier = item.category.toLowerCase();
                      const selfChargeEligible =
                        (itemCarrier === "alfa" || itemCarrier === "mtc") &&
                        isSelfChargeEligible(item, itemCarrier);
                      const selfChargeTargetLine = selfChargeEligible
                        ? primaryLines[itemCarrier as "alfa" | "mtc"]
                        : null;
                      return (
                        <ItemCard
                          key={item.key}
                          brand={billAccent.brand}
                          item={item}
                          qty={inCart?.quantity ?? 0}
                          isExpanded={expandedKeys.has(item.key)}
                          onlyDays={inCart?.onlyDays ?? false}
                          returnedCreditsUsd={inCart?.returnedCreditsUsd ?? 0}
                          onlyDaysPricing={
                            inCart
                              ? resolveOnlyDaysPricing(
                                  inCart,
                                  catalogPricing,
                                  tenantCreditSellPriceLbp,
                                )
                              : undefined
                          }
                          onCardClick={handleCardClick}
                          onQtyDecrease={handleQtyDecrease}
                          onQtyIncrease={handleQtyIncrease}
                          onOnlyDaysChange={handleOnlyDaysChange}
                          onReturnedCreditsChange={handleReturnedCreditsChange}
                          onSellDaysLbpChange={handleSellDaysLbpChange}
                          onCreditPriceLbpChange={handleCreditPriceLbpChange}
                          selfChargeEligible={selfChargeEligible}
                          selfChargeTargetLine={selfChargeTargetLine}
                          onSelfCharge={handleSelfChargeClick}
                        />
                      );
                    })}
                  </div>
                </Collapsible>
              </div>
            );
          })}
          {isAdmin &&
            (newItemForm?.isNewCategory ? (
              <div className="bg-slate-800 rounded-xl border border-slate-700/50 p-4">
                <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
                  New category
                </h3>
                <NewServiceItemInlineForm
                  form={newItemForm}
                  error={addItemError}
                  onChange={setNewItemForm}
                  onSubmit={handleAddItem}
                  onCancel={cancelNewItem}
                />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setAddItemError("");
                  setNewItemForm(
                    emptyNewServiceItemForm(activeProvider as string, "", true),
                  );
                }}
                className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white px-2 py-1 rounded hover:bg-slate-700/50 transition-colors"
                title="New category"
              >
                <Plus className="w-3.5 h-3.5" />
                New category
              </button>
            ))}
        </div>
      )}

      <PaymentSheet
        open={showPaymentSheet}
        onClose={() => setShowPaymentSheet(false)}
        onConfirm={handleSubmit}
        isSubmitting={localSubmitting}
        title={activeSession ? "Add to Cart" : "Confirm Payment"}
        accentColor={billAccent.brand.button}
        paymentMethods={methods}
        clientId={clientId}
        fetchClientVouchers={fetchClientVouchers}
        exchangeRate={exchangeRate}
        onExchangeRateChange={setEffectiveRate}
        onDiscountChange={setDiscount}
        {...(isMixedBasket
          ? {
              // LIRA-326 — every provider's picks, paid once. A discount only
              // on a one-currency basket (never converted), capped at the
              // basket's profit and spread over the sales by profit.
              subtitle: `${basketSheet.count} items — ${basketSheet.totals
                .map((t) => fmtBill(t.amount, t.currency))
                .join(" + ")}`,
              items: basketSheet.items,
              totals: basketSheet.totals,
              totalAmount: basketSheet.totalAmount,
              totalAmountCurrency: basketSheet.currency,
              currency: basketSheet.currency,
              showDiscount: basketSheet.singleCurrency,
              maxDiscount: basketSheet.maxDiscount,
            }
          : {
              subtitle:
                pendingBills.length > 0
                  ? cart.size > 0
                    ? `${totalItems} items + ${pendingBills.length} ${pendingBills.length > 1 ? "bills" : "bill"} — ${fmtBill(totalPrice + billsLbpValue, "LBP")}`
                    : `${pendingBills.length > 1 ? `${pendingBills.length} BILLS` : "BILL"} — ${fmtBill(billsTotal, billsCurrency)}`
                  : `${totalItems} items — ${totalPrice.toLocaleString()} LBP`,
              items: paymentSheetItems,
              totalAmount: billsOnlyUsd
                ? billsTotal
                : totalPrice + billsLbpValue,
              totalAmountCurrency: billsCurrency,
              currency: billsCurrency,
              showDiscount: totalItems > 0,
              maxDiscount,
            })}
        // LIRA-319: "− Discount | + Extra" (extra-only on a bills-only
        // checkout, which has no discount). Walk-in only.
        {...(!activeSession && !forPartner
          ? { onExtraChange: setExtraCharge }
          : {})}
        hasClient={!!clientId || (!!clientName.trim() && !!clientPhone.trim())}
        // Charge flow: shortfall → client debt (id, or name+phone to create).
        autoDebtRemainder={
          !!clientId || (!!clientName.trim() && !!clientPhone.trim())
        }
        // Change not handed back → store credit (OUT CUSTOMER_ACCOUNT leg,
        // forwarded in `payments`). Same client rule as auto-debt; never in a
        // session, where the basket checkout owns the change.
        {...(!activeSession &&
        (!!clientId || (!!clientName.trim() && !!clientPhone.trim()))
          ? { unreturnedChangeTo: "CUSTOMER_ACCOUNT" as const }
          : {})}
        paymentInputKey={paymentInputKey}
        initialPaymentMethod={initialPaymentMethod}
        onPaymentChange={(lines) => {
          setPaymentLines(lines);
          if (lines.length === 1) {
            setPaymentMethod(lines[0].method);
          }
        }}
        onReturnChange={setReturnLegs}
        // Handing back less change than due keeps the rest as profit (sent
        // as kept_change_* on the same payload) — automatic since the owner
        // decision of 2026-10-06 removed the "Keep change" button.
        onKeptChange={setKeptChange}
      >
        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Client Name
          </label>
          <ClientAutocompleteInput
            type="text"
            value={clientName}
            onChange={(v) => {
              setClientName(v);
              if (!v) {
                setClientId(null);
                setClientPhone("");
              }
            }}
            onClientSelect={(c) => {
              setClientId(c.id);
              setClientPhone(c.phone_number || "");
              setInitialPaymentMethod("CUSTOMER_ACCOUNT");
              setPaymentInputKey((k) => k + 1);
            }}
            placeholder="Client name (optional)"
            className={`w-full mt-1 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none ${billAccent.brand.focusBorder}`}
          />
          <div className="relative">
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
              <Phone size={14} />
            </div>
            <input
              type="tel"
              inputMode="numeric"
              value={clientPhone}
              onChange={(e) => setClientPhone(e.target.value)}
              placeholder="Phone number (registers a new client)"
              className={`w-full bg-slate-800 border border-slate-600 rounded-lg pl-10 pr-3 py-2 text-sm text-white font-mono focus:outline-none ${billAccent.brand.focusBorder}`}
            />
          </div>
          {clientName.trim() && clientPhone.trim() && !clientId && (
            <p className="text-xs text-orange-300/80 px-1">
              New client will be created on confirm.
            </p>
          )}
          {/* LIRA-326: a combined basket is booked "now" — the basket
              checkout takes no backdated time, so the field is not offered. */}
          {!isMixedBasket && (
            <TransactionTimeOverride
              value={transactionTime}
              onChange={setTransactionTime}
            />
          )}
        </div>
      </PaymentSheet>

      {/* History Modal */}
      {showHistory && (
        <HistoryModal
          transactions={historyTransactions}
          provider={activeProvider as string}
          onClose={() => setShowHistory(false)}
          onRefresh={loadFinancialData}
          formatAmount={formatAmount}
          sourceTable="financial_services"
          transactionType="FINANCIAL_SERVICE"
          onUpdateMetadata={async (id, data) => {
            // Migrated off raw window.api (rule 19) onto the shared
            // updateFinancialMetadata adapter fn, which also has a REST
            // twin. NOTE: the field is `client_name` (matching the adapter
            // contract and the underlying service), not `customer_name` —
            // the old raw call sent `customer_name`, a key the IPC handler
            // never reads, so this edit's name field was a silent no-op.
            const result = await api.updateFinancialMetadata({
              id,
              ...(data.client_name !== undefined && {
                client_name: data.client_name,
              }),
              ...(data.phone_number !== undefined && {
                phone_number: data.phone_number,
              }),
              ...(data.note !== undefined && { note: data.note }),
            });
            return result;
          }}
        />
      )}

      {/* Self-charge confirm modal (LIRA-090 §5.2, carrier-lines-validity
          plan Phase 5 / D5) — the target line is resolved automatically via
          getPrimary(carrier) instead of offered as a picker. */}
      {selfChargeItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
          <div className="relative w-full max-w-sm bg-slate-900 rounded-2xl border border-slate-700 shadow-2xl p-6">
            <h3 className="text-lg font-bold text-white mb-1">
              Charge to Shop Line
            </h3>
            <p className="text-slate-400 text-xs mb-4">
              {formatCatalogItemName(selfChargeItem)}
            </p>

            {selfChargeResult ? (
              <div className="space-y-4">
                <div className="bg-emerald-900/20 border border-emerald-700/40 rounded-lg p-3 text-sm text-emerald-300">
                  Charged successfully.
                </div>
                <div className="text-sm text-slate-300 space-y-1">
                  <p>
                    Cost debited:{" "}
                    <span className="text-white font-mono">
                      {selfChargeResult.costLbp.toLocaleString()} LBP
                    </span>
                  </p>
                  <p>
                    Credits added:{" "}
                    <span className="text-emerald-400 font-mono">
                      +${selfChargeResult.creditsAdded}
                    </span>
                  </p>
                  <p>
                    Validity added:{" "}
                    <span className="text-emerald-400 font-mono">
                      +{selfChargeResult.validityDaysAdded} days
                    </span>
                  </p>
                </div>
                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={closeSelfCharge}
                    className="px-4 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded text-sm"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {selfChargeError && (
                  <div className="text-red-400 text-sm bg-red-900/20 px-3 py-1.5 rounded">
                    {selfChargeError}
                  </div>
                )}

                <div className="bg-slate-900/60 border border-slate-700 rounded-lg p-3 text-sm text-slate-300 space-y-1">
                  <p className="text-slate-400 text-xs uppercase mb-1">
                    This will:
                  </p>
                  <p>
                    Debit{" "}
                    <span className="text-white font-mono">
                      {(selfChargeItem.catalogCost ?? 0).toLocaleString()} LBP
                    </span>{" "}
                    from the {selfChargeItem.provider} drawer
                  </p>
                  <p>
                    Add{" "}
                    <span className="text-emerald-400 font-mono">
                      +${selfChargeItem.credits}
                    </span>{" "}
                    credit to{" "}
                    {selfChargeTargetLine
                      ? selfChargeTargetLine.label ||
                        selfChargeTargetLine.phone_number
                      : `the ${selfChargeCarrier?.toUpperCase()} line`}
                  </p>
                  <p>
                    Add{" "}
                    <span
                      className={
                        selfChargeValidityProjection?.capped ||
                        selfChargeBlocked
                          ? "text-amber-400 font-mono line-through"
                          : "text-emerald-400 font-mono"
                      }
                    >
                      +{selfChargeItem.validityDays} days
                    </span>{" "}
                    validity to{" "}
                    {selfChargeTargetLine
                      ? selfChargeTargetLine.label ||
                        selfChargeTargetLine.phone_number
                      : `the ${selfChargeCarrier?.toUpperCase()} line`}
                  </p>
                  {!selfChargeTargetLine && (
                    <p className="text-amber-400 text-xs pt-1">
                      No active {selfChargeCarrier?.toUpperCase()} line — add
                      one in Settings → Carrier Lines first.
                    </p>
                  )}
                  {/* LIRA-157 — say what the rule will really do, before the
                      operator spends the card. */}
                  {selfChargeBlocked && (
                    <p
                      className="text-red-400 text-xs pt-1"
                      data-testid="self-charge-burned-warning"
                    >
                      This line expired{" "}
                      {selfChargeValidityProjection?.lapseDays} days ago and is
                      burned — it can no longer be revived by a charge. Register
                      a new line in Settings → Carrier Lines.
                    </p>
                  )}
                  {/* #28/M7 — the line carries a sold-ahead debt; this
                      charge pays part or all of it off FIRST (never
                      refused, rule 14 — same server rule), so say so before
                      the operator spends the card. */}
                  {!selfChargeBlocked &&
                    (selfChargeValidityProjection?.owedApplied ?? 0) > 0 && (
                      <p
                        className="text-amber-400 text-xs pt-1"
                        data-testid="self-charge-owed-payoff-notice"
                      >
                        {selfChargeValidityProjection?.owedApplied} of these{" "}
                        {selfChargeValidityProjection?.requestedDays} days go to
                        what you already sold ahead
                        {(selfChargeValidityProjection?.appliedDays ?? 0) >
                        0 ? (
                          <>
                            , {selfChargeValidityProjection?.appliedDays} stay
                            on the line
                          </>
                        ) : null}
                        .
                      </p>
                    )}
                  {!selfChargeBlocked &&
                    selfChargeValidityProjection?.capped && (
                      <p
                        className="text-amber-400 text-xs pt-1"
                        data-testid="self-charge-capped-warning"
                      >
                        Only {selfChargeValidityProjection.appliedDays} of these{" "}
                        {selfChargeValidityProjection.requestedDays} days will
                        apply — a line holds at most {MAX_LINE_VALIDITY_DAYS}{" "}
                        days, and this one already has validity left.
                      </p>
                    )}
                  {!selfChargeBlocked &&
                    selfChargeValidityProjection?.state === "GRACE" && (
                      <p
                        className="text-amber-400 text-xs pt-1"
                        data-testid="self-charge-grace-warning"
                      >
                        This line expired{" "}
                        {selfChargeValidityProjection.lapseDays} days ago — the
                        new validity starts from today, so the lapsed days are
                        not recovered.
                      </p>
                    )}
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={handleConfirmSelfCharge}
                    disabled={
                      selfChargeSubmitting ||
                      !selfChargeTargetLine ||
                      selfChargeBlocked
                    }
                    className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded text-sm"
                  >
                    {selfChargeSubmitting ? "Charging..." : "Confirm Charge"}
                  </button>
                  <button
                    type="button"
                    onClick={closeSelfCharge}
                    disabled={selfChargeSubmitting}
                    className="px-4 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded text-sm disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export const KatshForm = memo(KatshFormInner);
