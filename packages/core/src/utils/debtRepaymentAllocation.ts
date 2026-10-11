/**
 * LIRA-304 — the ONE calculation that decides, for a customer debt
 * repayment:
 *
 *   1. coverage — which open debt items the payment pays, and how much of
 *      each (in the item's own currency), and
 *   2. routing — how much of the cash goes into the shop's primary-system
 *      cash drawer (OMT_System / Whish_System) instead of the payment
 *      method's own drawer.
 *
 * Called by BOTH the repayment modal (the "Goes to" preview, FR-010) and
 * `DebtRepository.addRepayment` (the authoritative posting, FR-012) with
 * server-read data, so the two can never disagree (research D8).
 *
 * Pure and Node-free on purpose: it is reachable from `browser.ts`, so it
 * must import nothing (CLAUDE.md rule 29).
 *
 * Owner rules (specs/304-debt-item-picking/spec.md FR-001/004/008/009,
 * research D3; LIRA-308 owner decisions 2026-10-11):
 *  - Coverage: the cashier's ticked items first, then the items the amount
 *    ticked by itself (`auto` targets, LIRA-308 decision 5) — inside each
 *    group cash-drawer items (open primary-system transfers) first, then
 *    oldest first (LIRA-308 decision 4; LIRA-304 had "oldest first" only).
 *    Whatever is left in today's order — sales first (USD), then charges
 *    and basket members oldest first (unchanged: write-off and callers with
 *    no ticks). Strictly same currency, like today's FIFO: a USD
 *    reduction never pays an LBP item (the ledger is kept per currency).
 *  - The "Earlier balance (no items)" line (`kind: "balance"`, LIRA-308
 *    owner answer 2): the part of the balance no listed item accounts for.
 *    Ticked (by the cashier or the amount) it is paid in the order above as
 *    the OLDEST item; unticked it is never walked — it stays the implicit
 *    remainder after every item, as before. It is never routed.
 *  - Routing: a ticked primary-system transfer's share goes to its drawer; a
 *    ticked item of any other kind does not; the value left after the
 *    ticked items goes to the drawer first ("OMT drawer first"), oldest
 *    transfer first. Routing is capped per transfer at its remaining cap
 *    (amount − what earlier repayments already routed for it, kept in the
 *    transfer's own currency) and by the cash actually applied.
 */

export type DebtItemKind = "sale" | "charge" | "member" | "balance";

/** Identifies one open debt item: a `sales.id`, a coverable `debt_ledger`
 *  row id, or a basket member's `customer_session_transactions.id`. */
export interface DebtItemRef {
  kind: DebtItemKind;
  id: number;
  /** LIRA-308 decision 5 — ticked by the amount (it was more than the
   *  cashier's ticked sum), not by the cashier: paid only after every
   *  cashier tick. Absent = the cashier ticked it. */
  auto?: boolean;
}

export type Currency = "USD" | "LBP";

export interface AllocationItem extends DebtItemRef {
  /** Creation time of the item (sales) or of its debt row (charges and
   *  basket members) — the "oldest first" key. */
  createdAt: string;
  /** The debt row id (charges, members) or sale id (sales) — tie-break
   *  after `createdAt`, as today's FIFO orders by `created_at, id`. */
  rowId: number;
  openUsd: number;
  openLbp: number;
  /** Present only on an open primary-system transfer: how much may still be
   *  routed to the primary cash drawer for it, per debt currency. */
  routingCap?: { usd: number; lbp: number } | null;
}

/** LIRA-308 owner answer 2 (2026-10-11) — the "Earlier balance (no
 *  items)" line: the part of a client's balance no listed item accounts
 *  for (manual / imported / opening debt). One per client, so its id is a
 *  fixed 1. */
export const EARLIER_BALANCE_REF: DebtItemRef = { kind: "balance", id: 1 };

/** The earlier-balance line as an allocation item. Sorts as the OLDEST
 *  item (empty `createdAt`); never routed (no cap); has no row to cover. */
export function earlierBalanceItem(open: {
  usd: number;
  lbp: number;
}): AllocationItem {
  return {
    kind: "balance",
    id: EARLIER_BALANCE_REF.id,
    rowId: 0,
    createdAt: "",
    openUsd: Math.max(0, open.usd),
    openLbp: Math.max(0, open.lbp),
    routingCap: null,
  };
}

export interface AllocateRepaymentInput {
  items: AllocationItem[];
  /** Items the cashier ticked (optional). */
  targets?: DebtItemRef[];
  /** The ledger reduction in the DEBT's currencies (what the repayment
   *  removes from the customer's balance). */
  reductionUsd: number;
  reductionLbp: number;
  /** Tender actually applied to the debt per tender currency (IN − OUT −
   *  kept change). */
  appliedUsd: number;
  appliedLbp: number;
  /** Cash that may be routed, per tender currency (cash legs only, ≤ the
   *  applied amount in that currency). */
  cashUsd: number;
  cashLbp: number;
  /** The repayment's stamped USD→LBP rate. */
  rate: number;
}

export interface CoverageTake extends DebtItemRef {
  usd: number;
  lbp: number;
}

export interface RoutingTake extends DebtItemRef {
  /** The transfer's own currency this part of the cap is counted in. */
  debtCurrency: Currency;
  /** How much of the transfer's cap this consumes, in `debtCurrency`. */
  value: number;
  /** The cash moved into the primary cash drawer. */
  tenderCurrency: Currency;
  tenderAmount: number;
}

export interface AllocateRepaymentResult {
  coverage: CoverageTake[];
  routing: RoutingTake[];
  /** Σ routing tender amounts per tender currency. */
  routedUsd: number;
  routedLbp: number;
}

const EPS_USD = 0.005;
const EPS_LBP = 1;
/** Sales use today's `_markSalesPaidFIFO` tolerance. */
const EPS_SALE = 0.01;

const roundUsd = (n: number): number => Math.round(n * 100) / 100;
const roundLbp = (n: number): number => Math.round(n);
const roundIn = (c: Currency, n: number): number =>
  c === "USD" ? roundUsd(n) : roundLbp(n);

const sameRef = (a: DebtItemRef, b: DebtItemRef): boolean =>
  a.kind === b.kind && a.id === b.id;

function byAge(a: AllocationItem, b: AllocationItem): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  if (a.rowId !== b.rowId) return a.rowId - b.rowId;
  return a.id - b.id;
}

/** LIRA-308 — an item whose payment goes to the shop's primary-system cash
 *  drawer (an open primary-system transfer). The ONE predicate behind both
 *  the picker's "Cash drawer" badge (`OpenDebtItem.isPrimary`) and the
 *  coverage order below. */
export function isCashDrawerItem(it: AllocationItem): boolean {
  return !!it.routingCap;
}

/** LIRA-308 decision 4 — the order inside the ticked items: cash-drawer
 *  items first, then oldest first. */
function byTickedPriority(a: AllocationItem, b: AllocationItem): number {
  const pa = isCashDrawerItem(a) ? 0 : 1;
  const pb = isCashDrawerItem(b) ? 0 : 1;
  return pa !== pb ? pa - pb : byAge(a, b);
}

export function allocateRepayment(
  input: AllocateRepaymentInput,
): AllocateRepaymentResult {
  const rate = input.rate > 0 ? input.rate : 1;
  const open = new Map<string, { usd: number; lbp: number }>();
  const key = (r: DebtItemRef): string => `${r.kind}:${r.id}`;
  for (const it of input.items) {
    open.set(key(it), {
      usd: Math.max(0, it.openUsd),
      lbp: Math.max(0, it.openLbp),
    });
  }
  const takes = new Map<string, CoverageTake>();
  const addTake = (it: DebtItemRef, usd: number, lbp: number): void => {
    if (usd <= 0 && lbp <= 0) return;
    const k = key(it);
    const cur = takes.get(k) ?? { kind: it.kind, id: it.id, usd: 0, lbp: 0 };
    cur.usd = roundUsd(cur.usd + usd);
    cur.lbp = roundLbp(cur.lbp + lbp);
    takes.set(k, cur);
    const o = open.get(k);
    if (o) {
      o.usd = Math.max(0, o.usd - usd);
      o.lbp = Math.max(0, o.lbp - lbp);
    }
  };

  let budgetUsd = Math.max(0, input.reductionUsd);
  let budgetLbp = Math.max(0, input.reductionLbp);

  // The cashier's ticks, then the amount's own ticks (LIRA-308 decision 5)
  // — each group cash drawer first, then oldest (decision 4). A ref sent
  // both ways counts as the cashier's.
  const targets = input.targets ?? [];
  const cashierTicked = input.items
    .filter((it) => targets.some((t) => !t.auto && sameRef(t, it)))
    .sort(byTickedPriority);
  const autoTicked = input.items
    .filter(
      (it) =>
        !cashierTicked.includes(it) &&
        targets.some((t) => t.auto && sameRef(t, it)),
    )
    .sort(byTickedPriority);
  const ticked = [...cashierTicked, ...autoTicked];

  // ── Coverage, step 1: ticked items in that order, same currency ────────
  const tickedTakes: CoverageTake[] = [];
  for (const it of ticked) {
    const o = open.get(key(it))!;
    const usd = budgetUsd > EPS_USD ? Math.min(budgetUsd, o.usd) : 0;
    const lbp = budgetLbp > EPS_LBP ? Math.min(budgetLbp, o.lbp) : 0;
    const u = usd > EPS_USD ? roundUsd(usd) : 0;
    const l = lbp > EPS_LBP ? roundLbp(lbp) : 0;
    if (u > 0 || l > 0) {
      addTake(it, u, l);
      budgetUsd -= u;
      budgetLbp -= l;
      tickedTakes.push({ kind: it.kind, id: it.id, usd: u, lbp: l });
    }
  }

  // ── Coverage, step 2: today's order — sales first (USD), then charges and
  //    basket members oldest first, per currency ────────────────────────
  //    The earlier-balance line (LIRA-308 answer 2) is paid only when
  //    ticked; unticked it stays today's implicit remainder after every
  //    item, so a no-target repayment or write-off is unchanged.
  const rest = input.items
    .filter((it) => it.kind !== "balance" && open.get(key(it)))
    .sort(byAge);
  for (const it of rest.filter((i) => i.kind === "sale")) {
    if (budgetUsd <= EPS_SALE) break;
    const o = open.get(key(it))!;
    const u = roundUsd(Math.min(budgetUsd, o.usd));
    if (u > EPS_SALE) {
      addTake(it, u, 0);
      budgetUsd -= u;
    }
  }
  for (const it of rest.filter((i) => i.kind !== "sale")) {
    const o = open.get(key(it))!;
    const u = budgetUsd > EPS_USD ? roundUsd(Math.min(budgetUsd, o.usd)) : 0;
    const l = budgetLbp > EPS_LBP ? roundLbp(Math.min(budgetLbp, o.lbp)) : 0;
    const uu = u > EPS_USD ? u : 0;
    const ll = l > EPS_LBP ? l : 0;
    if (uu > 0 || ll > 0) {
      addTake(it, uu, ll);
      budgetUsd -= uu;
      budgetLbp -= ll;
    }
  }

  // ── Routing ─────────────────────────────────────────────────────────────
  let cashUsd = Math.max(0, Math.min(input.cashUsd, input.appliedUsd));
  let cashLbp = Math.max(0, Math.min(input.cashLbp, input.appliedLbp));
  const caps = new Map<string, { usd: number; lbp: number }>();
  for (const it of input.items) {
    if (it.routingCap) {
      caps.set(key(it), {
        usd: Math.max(0, it.routingCap.usd),
        lbp: Math.max(0, it.routingCap.lbp),
      });
    }
  }
  const routing: RoutingTake[] = [];
  let routedUsd = 0;
  let routedLbp = 0;

  /** Route up to `wantValue` (in `debtCurrency`) for `it`, drawing cash in
   *  the same currency first, then the other one at the stamped rate.
   *  Returns the value actually routed, in `debtCurrency`. */
  const route = (
    it: DebtItemRef,
    debtCurrency: Currency,
    wantValue: number,
  ): number => {
    const cap = caps.get(key(it));
    if (!cap) return 0;
    const capLeft = debtCurrency === "USD" ? cap.usd : cap.lbp;
    let want = Math.min(wantValue, capLeft);
    const eps = debtCurrency === "USD" ? EPS_USD : EPS_LBP;
    if (want <= eps) return 0;
    let routed = 0;
    const order: Currency[] =
      debtCurrency === "USD" ? ["USD", "LBP"] : ["LBP", "USD"];
    for (const tender of order) {
      if (want <= eps) break;
      const avail = tender === "USD" ? cashUsd : cashLbp;
      if (avail <= (tender === "USD" ? EPS_USD : EPS_LBP)) continue;
      // Convert the wanted value into this tender currency.
      const wantInTender =
        tender === debtCurrency
          ? want
          : tender === "LBP"
            ? want * rate
            : want / rate;
      const tenderAmount = roundIn(tender, Math.min(avail, wantInTender));
      if (tenderAmount <= 0) continue;
      const value =
        tender === debtCurrency
          ? tenderAmount
          : debtCurrency === "USD"
            ? tenderAmount / rate
            : tenderAmount * rate;
      const valueRounded = roundIn(debtCurrency, Math.min(value, want));
      if (tender === "USD") {
        cashUsd -= tenderAmount;
        routedUsd = roundUsd(routedUsd + tenderAmount);
      } else {
        cashLbp -= tenderAmount;
        routedLbp = roundLbp(routedLbp + tenderAmount);
      }
      if (debtCurrency === "USD") cap.usd -= valueRounded;
      else cap.lbp -= valueRounded;
      want -= valueRounded;
      routed += valueRounded;
      routing.push({
        kind: it.kind,
        id: it.id,
        debtCurrency,
        value: valueRounded,
        tenderCurrency: tender,
        tenderAmount,
      });
    }
    return routed;
  };

  // Routing, step 1: the ticked items' coverage, in the order paid. A
  // ticked transfer's share is routed; any ticked item consumes its value
  // from the applied amount either way (a ticked cable keeps its cash).
  let tickedValue = 0;
  for (const t of tickedTakes) {
    tickedValue += t.usd + t.lbp / rate;
    if (t.usd > 0) route(t, "USD", t.usd);
    if (t.lbp > 0) route(t, "LBP", t.lbp);
  }

  // Routing, step 2: the value left after the ticked items goes to the
  // primary cash drawer first, oldest open transfer first.
  const appliedValue =
    Math.max(0, input.appliedUsd) + Math.max(0, input.appliedLbp) / rate;
  let remainderValue = Math.max(0, appliedValue - tickedValue);
  const transfers = input.items.filter((it) => caps.has(key(it))).sort(byAge);
  for (const it of transfers) {
    if (remainderValue <= EPS_USD) break;
    const cap = caps.get(key(it))!;
    if (cap.usd > EPS_USD) {
      const got = route(it, "USD", Math.min(remainderValue, cap.usd));
      remainderValue -= got;
    }
    if (remainderValue > EPS_USD && cap.lbp > EPS_LBP) {
      const got = route(it, "LBP", Math.min(remainderValue * rate, cap.lbp));
      remainderValue -= got / rate;
    }
  }

  return {
    coverage: [...takes.values()],
    routing,
    routedUsd,
    routedLbp,
  };
}

export interface PlanRepaymentTargetsInput {
  items: AllocationItem[];
  /** What the cashier ticked (any `auto` flag on these is ignored). */
  ticked: DebtItemRef[];
  /** What the payment AND any bundled discount remove from the debt, in the
   *  debt's currencies (LIRA-308 decision 8: applied together). */
  reductionUsd: number;
  reductionLbp: number;
  rate: number;
}

export interface PlanRepaymentTargetsResult {
  /** The targets to send: the cashier's ticks, then every unticked item the
   *  amount reaches, flagged `auto`. */
  targets: DebtItemRef[];
  /** What each item is paid — the "pays $X · leaves $Y" figures. */
  coverage: CoverageTake[];
}

/**
 * LIRA-308 decision 5 — which unticked items an amount above the ticked sum
 * reaches (cash drawer first, then oldest), so the screen ticks them by
 * itself and sends them as `auto` targets. Pure coverage (no routing): the
 * same `allocateRepayment` walk the server runs, with every unticked item
 * offered as an `auto` target. Sending `targets` back to `allocateRepayment`
 * with the same reduction gives exactly `coverage` (the reached items are a
 * prefix of that walk).
 */
export function planRepaymentTargets(
  input: PlanRepaymentTargetsInput,
): PlanRepaymentTargetsResult {
  const ticked: DebtItemRef[] = input.items
    .filter((it) => input.ticked.some((t) => sameRef(t, it)))
    .map((it) => ({ kind: it.kind, id: it.id }));
  // Keep the cashier's own order for the payload.
  ticked.sort(
    (a, b) =>
      input.ticked.findIndex((t) => sameRef(t, a)) -
      input.ticked.findIndex((t) => sameRef(t, b)),
  );
  const others = input.items.filter(
    (it) => !ticked.some((t) => sameRef(t, it)),
  );
  const { coverage } = allocateRepayment({
    items: input.items,
    targets: [
      ...ticked,
      ...others.map((it) => ({ kind: it.kind, id: it.id, auto: true })),
    ],
    reductionUsd: input.reductionUsd,
    reductionLbp: input.reductionLbp,
    appliedUsd: 0,
    appliedLbp: 0,
    cashUsd: 0,
    cashLbp: 0,
    rate: input.rate,
  });
  const reached = others
    .filter((it) =>
      coverage.some((c) => sameRef(c, it) && (c.usd > 0 || c.lbp > 0)),
    )
    .sort(byTickedPriority)
    .map((it): DebtItemRef => ({ kind: it.kind, id: it.id, auto: true }));
  return { targets: [...ticked, ...reached], coverage };
}

/**
 * LIRA-304 — one open debt item as the repayment screen lists it: the
 * allocation fields plus what the cashier reads. Returned by
 * `DebtRepository.findOpenDebtItems` (desktop IPC `debt:get-open-items`,
 * web `GET /api/debts/clients/:clientId/open-items`).
 */
export interface OpenDebtItem extends AllocationItem {
  /** The item's own transaction summary, e.g. "OMT SEND: … — $101". */
  label: string;
  /** The item's transaction type (SALE, FINANCIAL_SERVICE, LOTO, …). */
  type: string | null;
  /** Set for items inside a customer-session basket. */
  sessionId: number | null;
  /** True when this item is a transfer on the shop's primary system — the
   *  money paid for it goes to the primary cash drawer. */
  isPrimary: boolean;
  /** That drawer ("OMT_System" / "Whish_System") on a primary item. */
  primaryDrawer: string | null;
}
