/**
 * LIRA-349 A3 — what a multi-unit split checkout's ONE account charge says.
 *
 * FinancialForm (catalog units) and KatshForm (bills) book one transaction
 * per unit, stamped with a shared `split_group`; the first unit (the
 * "carrier") carries the whole checkout's payment, so its 'Service Debt' row
 * covers every unit. Every label read from that row used to describe the
 * carrier's own unit only — the other items were invisible to the client.
 *
 * This is the ONE builder for those labels (rule 14): the settle picker / month
 * rows (`DebtRepository._itemInfoReader`), the account history's item list
 * (`DebtRepository.findClientHistory`) and the detail popup's item list
 * (`FinancialServiceRepository.findWithCheckoutItems`). Labels are built at
 * read time from the group's own rows, so nothing is copied (rule 31) and old
 * checkouts read correctly too.
 *
 * Pure, zero runtime imports beyond `formatMoneyAmount` (itself import-free),
 * so it is safe from either core entry point (rule 29).
 */
import { formatMoneyAmount } from "./formatMoney.js";
import { providerDisplayLabel } from "./financialServiceSummary.js";

/** One unit of a split checkout, as the account screens show it. */
export interface SplitCheckoutItem {
  provider: string;
  serviceType: string;
  /** The item's own name (the unit's note), or "<Provider> Bill" for a
   *  note-less bill / "<Provider> item" for anything else. */
  name: string;
  amount: number;
  currency: string;
}

/** A unit's display name: its note, else what kind of unit it is. */
export function splitCheckoutItemName(unit: {
  provider: string;
  serviceType: string;
  note: string | null | undefined;
}): string {
  const note = unit.note?.trim();
  if (note) return note;
  const label = providerDisplayLabel(unit.provider);
  return unit.serviceType === "BILL" ? `${label} Bill` : `${label} item`;
}

/** "name — 355,000 LBP": one line per unit (the history row's item list). */
export function splitCheckoutItemLine(item: SplitCheckoutItem): string {
  return `${item.name} — ${formatMoneyAmount(item.amount, item.currency)}`;
}

/** The checkout's total per currency, LBP first ("710,000 LBP + $5"). */
function totalsText(items: SplitCheckoutItem[]): string {
  const order = [...new Set(items.map((i) => i.currency))].sort((a, b) =>
    a === "LBP" ? -1 : b === "LBP" ? 1 : a.localeCompare(b),
  );
  return order
    .map((currency) => {
      const sum = items
        .filter((i) => i.currency === currency)
        .reduce((s, i) => s + i.amount, 0);
      const rounded =
        currency === "LBP" ? Math.round(sum) : Math.round(sum * 100) / 100;
      return formatMoneyAmount(rounded, currency);
    })
    .join(" + ");
}

/**
 * The one-line label of the whole checkout:
 * "Whish App (2 items): alfa: 3.03 (Prepaid), alfa: 1GB Mobile Internet — 710,000 LBP".
 * The same item twice collapses to "2× name". The total is what the items
 * cost; the debt row's own amount column says how much of it is on account.
 */
export function buildSplitCheckoutLabel(items: SplitCheckoutItem[]): string {
  const providers = [...new Set(items.map((i) => i.provider))];
  const head = providers.map(providerDisplayLabel).join(" + ");
  const counts = new Map<string, number>();
  for (const i of items) counts.set(i.name, (counts.get(i.name) ?? 0) + 1);
  const names: string[] = [];
  const seen = new Set<string>();
  for (const i of items) {
    if (seen.has(i.name)) continue;
    seen.add(i.name);
    const n = counts.get(i.name)!;
    // Note-less bills differ only by amount — keep each one listed.
    if (n > 1 && !isGenericName(i)) names.push(`${n}× ${i.name}`);
    else if (n > 1) for (let k = 0; k < n; k++) names.push(i.name);
    else names.push(i.name);
  }
  return `${head} (${items.length} items): ${names.join(", ")} — ${totalsText(items)}`;
}

function isGenericName(i: SplitCheckoutItem): boolean {
  const label = providerDisplayLabel(i.provider);
  return i.name === `${label} Bill` || i.name === `${label} item`;
}

/** Re-exported for the debt-detail popup's title (one provider-name map). */
export { providerDisplayLabel };
