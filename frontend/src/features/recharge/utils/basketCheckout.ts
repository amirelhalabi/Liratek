/**
 * LIRA-326 — the Mobile Recharge basket: sub-item builders, the discount
 * spread and the ONE checkout payload (rules 14, 21, 22).
 *
 * The sub-item builders are the session `_batch` sub-items KatshForm and
 * FinancialForm used to build inline in their session branches. They live
 * here once so the session basket, the published priced lines and the basket
 * checkout all describe a unit the same way — and every unit carries ITS OWN
 * provider (the line's), never the tab's.
 */
import {
  isTelecomSplitComplete,
  RECHARGE_BASKET_MODULES,
  RECHARGE_BASKET_MODULE_PROVIDER,
  type RechargeBasketCheckoutPayload,
  type RechargeBasketModule,
  type RechargePartnerOrderPayload,
} from "@liratek/core";
import type { PaymentLine } from "@liratek/ui";
import { formatCatalogItemName } from "../hooks/useMobileServiceItems";
import { providerBrandOf } from "../types";
import type {
  BasketBill,
  BasketProvider,
  BasketSubItem,
  CatalogCartLine,
  PricedLine,
  WhishCartLine,
} from "../types/basket";

// ─── Sub-item builders ──────────────────────────────────────────────────────

/**
 * One iPick / Katsh cart line as session `_batch` sub-items, one per unit.
 * `sellPrice` is ONE unit as the form charges it (the Only Days price for an
 * Only Days line); `cost` is the GROSS cost (LIRA-090 B1 — the repository
 * nets it when `mobileServiceItemId` is present).
 */
export function catalogBatchSubItems(
  line: CatalogCartLine,
  sellPrice: number,
  cost: number,
): BasketSubItem[] {
  const splitComplete =
    line.onlyDays &&
    isTelecomSplitComplete({
      cost_lbp: line.item.catalogCost,
      days_cost_lbp: line.item.days_cost_lbp,
      credits: line.item.credits,
    });
  // LIRA-090 B2: send returnedCreditsUsd ONLY when the operator edited it,
  // or when the item has no complete split (the manual path always sends it).
  const sendReturned =
    line.onlyDays && (line.returnedCreditsEdited || !splitComplete);
  const unit: BasketSubItem = {
    provider: line.item.provider,
    serviceType: "SEND",
    amount: sellPrice,
    cost,
    currency: "LBP",
    commission: Math.max(0, sellPrice - cost),
    itemKey: line.item.key,
    itemCategory: line.item.category,
    ...(splitComplete && line.item.id != null
      ? { mobileServiceItemId: line.item.id }
      : {}),
    ...(sendReturned ? { returnedCreditsUsd: line.returnedCreditsUsd } : {}),
    note: `${formatCatalogItemName(line.item)}${line.onlyDays ? " [Only Days]" : ""}`,
  };
  return Array.from({ length: line.quantity }, () => ({ ...unit }));
}

/**
 * One Whish App (or other FinancialForm grid) cart line as session `_batch`
 * sub-items, one per unit. The line's item is already priced in `currency`.
 */
export function whishBatchSubItems(
  line: WhishCartLine,
  serviceType: string,
  currency: "LBP" | "USD",
): BasketSubItem[] {
  const sellPrice = line.item.catalogSellPrice ?? 0;
  const cost = line.item.catalogCost ?? 0;
  const unit: BasketSubItem = {
    provider: line.item.provider,
    serviceType,
    amount: sellPrice,
    cost,
    currency,
    commission: Math.max(0, sellPrice - cost),
    itemKey: line.item.key,
    itemCategory: line.item.category,
    note: formatCatalogItemName(line.item),
  };
  return Array.from({ length: line.quantity }, () => ({ ...unit }));
}

/**
 * LIRA-327 — a staged bill as a priced basket line, booked under ITS OWN
 * provider (the tab it was added on). Its one sub-item is exactly what a bill
 * paid on its own sends: cost = price = amount, no profit (a bill's
 * commission is entered at settlement), no item key and no note.
 */
export function billPricedLine(bill: BasketBill): PricedLine {
  return {
    key: `bill-${bill.id}`,
    provider: bill.provider,
    kind: "bill",
    label: `${PROVIDER_LABEL[bill.provider] ?? bill.provider} BILL — ${fmtMoney(bill.amount, bill.currency)}`,
    sheetItem: {
      key: `bill-${bill.id}`,
      name: "Bill",
      provider: providerBrandOf(bill.provider),
      quantity: 1,
      unitPrice: bill.amount,
      currency: bill.currency,
    },
    currency: bill.currency,
    amount: bill.amount,
    cost: bill.amount,
    commission: 0,
    subItems: [
      {
        provider: bill.provider,
        serviceType: "BILL",
        amount: bill.amount,
        cost: bill.amount,
        price: bill.amount,
        currency: bill.currency,
        commission: 0,
      },
    ],
  };
}

/** Stamp the resolved walk-in client — and, for a customer-session item,
 *  the "Set custom time" picked on the form (bug #4) — on every sub-item. */
export function withClient(
  subItems: BasketSubItem[],
  client: {
    clientId?: number | null | undefined;
    clientName?: string;
    transactionTime?: string | undefined;
  },
): BasketSubItem[] {
  return subItems.map((s) => ({
    ...s,
    ...(client.clientId ? { clientId: client.clientId } : {}),
    ...(client.clientName ? { clientName: client.clientName } : {}),
    ...(client.transactionTime
      ? { transaction_time: client.transactionTime }
      : {}),
  }));
}

// ─── Discount spread ────────────────────────────────────────────────────────

/**
 * Spread a basket discount over its units in proportion to each unit's
 * commission (profit), lowering BOTH what the customer pays (`amount`) and
 * the profit (`commission`) by the same share.
 *
 *  - Works in minor units (whole LBP, US cents); the shares sum EXACTLY to the
 *    discount (largest-remainder rounding).
 *  - A share never exceeds its unit's commission, so no sale goes below cost
 *    (FR-006). A discount above the total commission is refused.
 *  - One currency only: a discount is never converted between currencies.
 */
export function spreadDiscount<
  T extends { amount: number; commission: number; currency: string },
>(subItems: T[], discount: number): T[] {
  if (!(discount > 0)) return subItems.map((s) => ({ ...s }));
  const currencies = new Set(subItems.map((s) => s.currency));
  if (currencies.size !== 1) {
    throw new Error("A discount needs every item in one currency.");
  }
  const unit = subItems[0]!.currency === "LBP" ? 1 : 0.01;
  const toUnits = (v: number) => Math.round(v / unit);
  const fix = (v: number) => (unit === 1 ? v : Math.round(v * 100) / 100);

  const caps = subItems.map((s) => Math.max(0, toUnits(s.commission)));
  const totalCap = caps.reduce((a, b) => a + b, 0);
  const d = toUnits(discount);
  if (d > totalCap) {
    throw new Error("The discount is larger than the profit on these items.");
  }
  const raw = caps.map((c) => (totalCap > 0 ? (d * c) / totalCap : 0));
  const shares = raw.map((r) => Math.floor(r));
  let remainder = d - shares.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r), cap: caps[i]! }))
    .sort((a, b) => b.frac - a.frac || b.cap - a.cap)
    .map((x) => x.i);
  while (remainder > 0) {
    let moved = false;
    for (const i of order) {
      if (remainder === 0) break;
      if (shares[i]! < caps[i]!) {
        shares[i]! += 1;
        remainder -= 1;
        moved = true;
      }
    }
    if (!moved) break; // unreachable: d <= totalCap
  }
  return subItems.map((s, i) => {
    const off = shares[i]! * unit;
    return {
      ...s,
      amount: fix(s.amount - off),
      commission: fix(Math.max(0, s.commission - off)),
      // LIRA-329: this unit's share of the typed discount, kept on its
      // transaction's details (informational — the amounts above carry it).
      ...(off > 0
        ? { typedDiscount: { amount: fix(off), currency: s.currency } }
        : {}),
    };
  });
}

// ─── Basket shape ───────────────────────────────────────────────────────────

const MODULE_BY_PROVIDER = new Map<string, RechargeBasketModule>(
  RECHARGE_BASKET_MODULES.map((m) => [RECHARGE_BASKET_MODULE_PROVIDER[m], m]),
);

/** The basket module a provider's entry is booked under. */
export function basketModuleOf(provider: string): RechargeBasketModule {
  const m = MODULE_BY_PROVIDER.get(provider);
  if (!m) throw new Error(`${provider} can't go in the recharge basket.`);
  return m;
}

/** Display name of a provider in a basket entry's label. */
const PROVIDER_LABEL: Record<string, string> = {
  iPick: "iPick",
  Katsh: "Katsh",
  WHISH_APP: "Whish App",
};

/** The distinct providers in a set of priced lines. */
export function basketProviders(lines: PricedLine[]): Set<string> {
  return new Set(lines.map((l) => l.provider));
}

/** What the lines cost the customer, per currency (LBP first). */
export function basketTotals(
  lines: PricedLine[],
): Array<{ amount: number; currency: "LBP" | "USD" }> {
  const lbp = lines
    .filter((l) => l.currency === "LBP")
    .reduce((s, l) => s + l.amount, 0);
  const usd = lines
    .filter((l) => l.currency === "USD")
    .reduce((s, l) => s + l.amount, 0);
  return [
    ...(lines.some((l) => l.currency === "LBP")
      ? [{ amount: lbp, currency: "LBP" as const }]
      : []),
    ...(lines.some((l) => l.currency === "USD")
      ? [{ amount: Math.round(usd * 100) / 100, currency: "USD" as const }]
      : []),
  ];
}

/** One basket entry: a provider's card units, as a session `_batch` cart
 *  item — or (LIRA-327, `bill: true`) one bill as its own cart item. */
export interface BasketEntry {
  module: RechargeBasketModule;
  label: string;
  amount: number;
  currency: "LBP" | "USD";
  items: BasketSubItem[];
  bill?: true;
}

function fmtMoney(amount: number, currency: "LBP" | "USD"): string {
  return currency === "LBP"
    ? `${Math.round(amount).toLocaleString()} LBP`
    : `$${amount.toFixed(2)}`;
}

/**
 * Group priced lines into ONE entry per provider, each carrying only that
 * provider's units, its amount equal to its own units (after `discount`, which
 * is spread once over the whole basket). Throws when a provider's lines mix
 * currencies, or when the discount cannot be spread.
 */
export function basketEntries(
  allLines: PricedLine[],
  discount = 0,
): BasketEntry[] {
  // LIRA-327: each bill is its own entry (the session-cart bill shape); the
  // discount is spread over the card units only (a bill earns nothing).
  const lines = allLines.filter((l) => l.kind !== "bill");
  const billEntries: BasketEntry[] = allLines
    .filter((l) => l.kind === "bill")
    .map((l) => ({
      module: basketModuleOf(l.provider),
      label: l.label,
      amount: l.amount,
      currency: l.currency,
      items: l.subItems,
      bill: true,
    }));
  const providers = [...basketProviders(lines)];
  const flat = providers.flatMap((p) =>
    lines.filter((l) => l.provider === p).flatMap((l) => l.subItems),
  );
  const spread = spreadDiscount(flat, discount);
  let cursor = 0;
  const cardEntries = providers.map((provider): BasketEntry => {
    const own = lines.filter((l) => l.provider === provider);
    const currencies = new Set(
      own.flatMap((l) => [l.currency, ...l.subItems.map((s) => s.currency)]),
    );
    if (currencies.size !== 1) {
      throw new Error(
        `${PROVIDER_LABEL[provider] ?? provider} items are priced in two currencies.`,
      );
    }
    const currency = own[0]!.currency;
    const count = own.reduce((n, l) => n + l.subItems.length, 0);
    const items = spread.slice(cursor, cursor + count);
    cursor += count;
    const amount =
      currency === "LBP"
        ? items.reduce((s, x) => s + x.amount, 0)
        : Math.round(items.reduce((s, x) => s + x.amount, 0) * 100) / 100;
    const name = PROVIDER_LABEL[provider] ?? provider;
    const itemLabels = own.map((l) => l.label).join(", ");
    const label =
      itemLabels.length > 60
        ? `${name} (${own.length} items) - ${fmtMoney(amount, currency)}`
        : `${name}: ${itemLabels}`;
    return { module: basketModuleOf(provider), label, amount, currency, items };
  });
  return [...cardEntries, ...billEntries];
}

// ─── Checkout payload ───────────────────────────────────────────────────────

export interface BuildBasketCheckoutInput {
  /** Every priced line of the basket (all groups). */
  lines: PricedLine[];
  /** Basket discount, in the basket's ONE currency (0 = none). */
  discount?: number;
  /** IN tender lines from the payment window. */
  payments: PaymentLine[];
  /** Change handed back (incl. unreturned change to the client's account). */
  returnLegs: PaymentLine[];
  paidByMethod: string;
  exchangeRate?: number | undefined;
  keptChange?: { usd: number; lbp: number } | null;
  extra?: { usd: number; lbp: number };
  client: {
    clientId?: number | null | undefined;
    clientName?: string;
    clientPhone?: string;
  };
  /** The operator — required by the schema; the server stamps its own. */
  userId: number;
  newId?: () => string;
}

/**
 * The ONE `rechargeBasketCheckout` payload for a basket of 2+ providers: one
 * `financial:create` `_batch` entry per provider, the legs once for the whole
 * basket (IN tender, OUT change — snake_case, as session checkout reads them),
 * and kept change / extra / client once.
 */
export function buildBasketCheckoutPayload(
  input: BuildBasketCheckoutInput,
): RechargeBasketCheckoutPayload {
  const newId = input.newId ?? (() => crypto.randomUUID());
  const client = {
    clientId: input.client.clientId,
    ...(input.client.clientName ? { clientName: input.client.clientName } : {}),
  };
  const entries = basketEntries(input.lines, input.discount ?? 0);
  const cartItems = entries.map((e) => ({
    id: newId(),
    module: e.module,
    label: e.label,
    amount: e.amount,
    currency: e.currency,
    ipcChannel: "financial:create",
    // LIRA-327: a bill is its own (non-batch) cart item.
    formData: e.bill
      ? { ...withClient(e.items, client)[0] }
      : { _batch: true, items: withClient(e.items, client) },
  }));

  const toLeg =
    (direction: "IN" | "OUT", kind?: "CHANGE") => (l: PaymentLine) => ({
      method: l.method,
      currency_code: l.currencyCode,
      amount: l.amount,
      direction,
      ...(kind ? { kind } : {}),
      ...(l.method === "GIFT_CARD" && l.voucherCode
        ? { voucher_code: l.voucherCode }
        : {}),
    });
  const payments = [
    ...input.payments.map(toLeg("IN")),
    ...input.returnLegs.map(toLeg("OUT", "CHANGE")),
  ];

  const kept = input.keptChange;
  const extra = input.extra;
  return {
    cartItems,
    ...(payments.length > 0 ? { payments } : {}),
    paidByMethod: input.paidByMethod,
    ...(input.exchangeRate && input.exchangeRate > 0
      ? { exchangeRate: input.exchangeRate }
      : {}),
    ...(input.client.clientId ? { clientId: input.client.clientId } : {}),
    ...(input.client.clientName ? { clientName: input.client.clientName } : {}),
    ...(input.client.clientPhone
      ? { clientPhone: input.client.clientPhone }
      : {}),
    ...(kept && (kept.usd > 0 || kept.lbp > 0)
      ? { kept_change_usd: kept.usd, kept_change_lbp: kept.lbp }
      : {}),
    ...(extra && extra.usd > 0 ? { extra_usd: extra.usd } : {}),
    ...(extra && extra.lbp > 0 ? { extra_lbp: extra.lbp } : {}),
    userId: input.userId,
  };
}

// ─── The combined payment window ────────────────────────────────────────────

/** What the payment window shows and owes for a combined basket. */
export interface BasketSheetSummary {
  items: PricedLine["sheetItem"][];
  /** Owed per currency (LBP first). */
  totals: Array<{ amount: number; currency: "LBP" | "USD" }>;
  /** The sheet's base currency: the one currency, else LBP. */
  currency: "LBP" | "USD";
  /** The total in `currency` when the basket has one currency, else the LBP
   *  part (the sheet lists every currency from `totals`). */
  totalAmount: number;
  /** A discount is offered only on a one-currency basket (never converted). */
  singleCurrency: boolean;
  /** Largest discount: the basket's whole profit (each sale stays ≥ cost). */
  maxDiscount: number;
  /** Units in the basket. */
  count: number;
}

export function basketSheetSummary(lines: PricedLine[]): BasketSheetSummary {
  const totals = basketTotals(lines);
  const singleCurrency = totals.length === 1;
  const currency = totals[0]?.currency ?? "LBP";
  const maxDiscount = lines
    .flatMap((l) => l.subItems)
    .reduce((s, x) => s + Math.max(0, x.commission), 0);
  return {
    items: lines.map((l) => l.sheetItem),
    totals,
    currency,
    totalAmount: totals[0]?.amount ?? 0,
    singleCurrency,
    maxDiscount:
      currency === "LBP" ? maxDiscount : Math.round(maxDiscount * 100) / 100,
    count: lines.reduce((n, l) => n + l.subItems.length, 0),
  };
}

/** True for the providers whose grids share the basket. */
export function isBasketProvider(p: string): p is BasketProvider {
  return MODULE_BY_PROVIDER.has(p);
}

// ─── For Partner across the basket (LIRA-327) ───────────────────────────────

/** How many things the basket holds: card units + bills. */
export function basketItemCount(lines: PricedLine[]): number {
  return lines.reduce((n, l) => n + l.subItems.length, 0);
}

type PartnerSale = RechargePartnerOrderPayload["sales"][number];

export interface BuildPartnerOrderInput {
  /** Every priced line of the basket (all groups, bills included). */
  lines: PricedLine[];
  partnerId: number;
  transactionTime?: string | undefined;
  /** The drawer that pays out a zero-cost Whish App transfer unit (today's
   *  "Paid from" select); CASH when none was chosen. */
  paidFromMethod?: string | undefined;
  /** The operator — required by the schema; the server stamps its own. */
  userId: number;
}

/**
 * The ONE `rechargePartnerOrder` payload: exactly the sales today's per-tab
 * partner submits write, for every provider in the basket —
 *  - iPick / Katsh cards: ONE aggregated SEND per provider (the cards' total
 *    price and cost, the joined item names as the note);
 *  - each bill: its own BILL (cost = price = amount, no profit);
 *  - Whish App: one SEND per unit (a zero-cost unit pays its OUT leg from
 *    `paidFromMethod`).
 * No counter payment, no walk-in customer; partnerId / partnerMode are
 * stamped by the server on every sale. Providers in basket order (iPick,
 * Katsh, Whish App).
 */
export function buildPartnerOrderPayload(
  input: BuildPartnerOrderInput,
): RechargePartnerOrderPayload {
  const sales: PartnerSale[] = [];
  for (const module of RECHARGE_BASKET_MODULES) {
    const provider = RECHARGE_BASKET_MODULE_PROVIDER[module];
    const own = input.lines.filter((l) => l.provider === provider);
    const cards = own.filter((l) => l.kind !== "bill");
    const bills = own.filter((l) => l.kind === "bill");
    if (cards.length > 0 && provider !== "WHISH_APP") {
      const amount = cards.reduce((s, l) => s + l.amount, 0);
      const cost = cards.reduce((s, l) => s + l.cost, 0);
      sales.push({
        provider,
        serviceType: "SEND",
        amount,
        cost,
        currency: "LBP",
        commission: Math.max(0, amount - cost),
        payments: [],
        note: cards.map((l) => l.partnerNote ?? l.label).join(", "),
      });
    }
    if (provider === "WHISH_APP") {
      for (const sub of cards.flatMap((l) => l.subItems)) {
        const isTransferOutLeg = sub.cost === 0 && sub.serviceType === "SEND";
        sales.push({
          provider,
          serviceType: sub.serviceType as PartnerSale["serviceType"],
          amount: sub.amount,
          cost: sub.cost,
          currency: sub.currency,
          commission: sub.cost > 0 ? Math.max(0, sub.amount - sub.cost) : 0,
          payments: isTransferOutLeg
            ? [
                {
                  method: input.paidFromMethod || "CASH",
                  currencyCode: sub.currency,
                  amount: sub.amount,
                  direction: "OUT" as const,
                },
              ]
            : [],
          ...(sub.itemKey ? { itemKey: sub.itemKey } : {}),
          ...(sub.itemCategory ? { itemCategory: sub.itemCategory } : {}),
          ...(sub.note ? { note: sub.note } : {}),
        });
      }
    }
    for (const bill of bills) {
      sales.push({
        provider,
        serviceType: "BILL",
        amount: bill.amount,
        cost: bill.amount,
        price: bill.amount,
        currency: bill.currency,
        commission: 0,
        payments: [],
      });
    }
  }
  return {
    partnerId: input.partnerId,
    sales,
    ...(input.transactionTime
      ? { transaction_time: input.transactionTime }
      : {}),
    userId: input.userId,
  };
}
