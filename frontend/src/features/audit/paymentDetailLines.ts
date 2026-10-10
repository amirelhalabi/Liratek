/**
 * LIRA-304 (spec FR-019 – FR-021) — the payment-detail lines under a
 * Transactions-page row: ONE line per payment method and direction, with all
 * its currencies on that line, and — when that line's money went to more
 * than one drawer — the amount per drawer in braces:
 *
 *   In  — Cash: $115 + 200,000 LBP  {$101 OMT Cash Drawer · $14 + 200,000 LBP General}
 *   Out — Customer Account: $115 + 200,000 LBP
 *
 * Pure: legs in, display parts out. The per-drawer amounts always add up to
 * the line's amount, per currency, because both are summed from the same
 * legs.
 */
import { formatLegAmount, type TransactionPaymentLeg } from "./cashFlow";

export interface PaymentDetailLine {
  direction: "in" | "out";
  method: string;
  /** "$115 + 200,000 LBP" */
  amountText: string;
  /** "$101 OMT Cash Drawer · $14 + 200,000 LBP General" — only when the
   *  line's money touched more than one drawer. */
  drawersText: string | null;
  reversal: boolean;
}

/** Customer-facing drawer names (the internal ones are code identifiers). */
export function drawerDisplayName(drawer: string): string {
  if (drawer === "OMT_System") return "OMT Cash Drawer";
  if (drawer === "Whish_System") return "Whish Cash Drawer";
  if (drawer === "OMT_App") return "OMT Wallet";
  if (drawer === "Whish_App") return "Whish Wallet";
  return drawer;
}

const CURRENCY_ORDER = ["USD", "LBP"];

function currencySort(a: string, b: string): number {
  const ia = CURRENCY_ORDER.indexOf(a);
  const ib = CURRENCY_ORDER.indexOf(b);
  return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
}

/** "$115 + 200,000 LBP" from per-currency totals (zero currencies omitted). */
function joinCurrencies(
  byCurrency: Map<string, number>,
  direction: "in" | "out",
  method: string,
): string {
  return [...byCurrency.entries()]
    .filter(([, amount]) => Math.abs(amount) > 1e-9)
    .sort(([a], [b]) => currencySort(a, b))
    .map(([currency, amount]) =>
      formatLegAmount({
        direction,
        amount: Math.abs(amount),
        signed_amount: amount,
        currency_code: currency,
        method,
      }),
    )
    .join(" + ");
}

/** LIRA-304 — an internal move of the customer's cash from one of the shop's
 *  drawers to another (a repayment's primary-system share). */
export interface DrawerMove {
  from: string;
  to: string;
  currency_code: string;
  amount: number;
}

export function buildPaymentDetailLines(
  legs: TransactionPaymentLeg[],
  moves: DrawerMove[] = [],
): PaymentDetailLine[] {
  type Group = {
    direction: "in" | "out";
    method: string;
    reversal: boolean;
    total: Map<string, number>;
    byDrawer: Map<string, Map<string, number>>;
    moved: boolean;
  };
  const groups: Group[] = [];
  for (const leg of legs) {
    const reversal = leg.reversal === true;
    let g = groups.find(
      (x) =>
        x.direction === leg.direction &&
        x.method === leg.method &&
        x.reversal === reversal,
    );
    if (!g) {
      g = {
        direction: leg.direction,
        method: leg.method,
        reversal,
        total: new Map(),
        byDrawer: new Map(),
        moved: false,
      };
      groups.push(g);
    }
    const amount = Math.abs(leg.amount);
    g.total.set(
      leg.currency_code,
      (g.total.get(leg.currency_code) ?? 0) + amount,
    );
    if (leg.drawer_name) {
      const d = g.byDrawer.get(leg.drawer_name) ?? new Map<string, number>();
      d.set(leg.currency_code, (d.get(leg.currency_code) ?? 0) + amount);
      g.byDrawer.set(leg.drawer_name, d);
    }
  }
  // Fold each internal move into the IN line whose cash sat in the `from`
  // drawer: that line's money now shows where it ended up.
  for (const m of moves) {
    const g = groups.find(
      (x) =>
        x.direction === "in" &&
        !x.reversal &&
        (x.byDrawer.get(m.from)?.get(m.currency_code) ?? 0) > 0,
    );
    if (!g) continue;
    const from = g.byDrawer.get(m.from)!;
    const moved = Math.min(m.amount, from.get(m.currency_code) ?? 0);
    from.set(m.currency_code, (from.get(m.currency_code) ?? 0) - moved);
    if ([...from.values()].every((v) => Math.abs(v) < 1e-9)) {
      g.byDrawer.delete(m.from);
    }
    const to = g.byDrawer.get(m.to) ?? new Map<string, number>();
    to.set(m.currency_code, (to.get(m.currency_code) ?? 0) + moved);
    g.byDrawer.set(m.to, to);
    g.moved = true;
  }
  return groups.map((g) => ({
    direction: g.direction,
    method: g.method,
    reversal: g.reversal,
    amountText: joinCurrencies(g.total, g.direction, g.method),
    drawersText:
      // Shown when the line's money ended up in 2+ drawers, or was moved
      // away from the drawer it was paid into (e.g. all of it into the OMT
      // Cash Drawer).
      g.byDrawer.size > 1 || g.moved
        ? [...g.byDrawer.entries()]
            .map(
              ([drawer, cur]) =>
                `${joinCurrencies(cur, g.direction, g.method)} ${drawerDisplayName(drawer)}`,
            )
            .join(" · ")
        : null,
  }));
}
