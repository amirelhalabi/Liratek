/**
 * Which drawer(s) a checkout's money lands in — for the "This sale's money
 * goes to" line in CheckoutModal (production test 2026-10-07: it used to
 * name a hard-coded "DRAWER B" while the money went to General).
 *
 * Mirrors the server's posting rule (SalesRepository / MaintenanceRepository
 * `processSale` payment loop): each customer-paid line posts to its payment
 * method's configured drawer (`paymentMethodToDrawerName` reads
 * `payment_methods.drawer_name`) only when the method moves a drawer
 * (`affects_drawer === 1`); cash change handed back always comes out of
 * General. The method rows here are the SAME `payment_methods` rows
 * (`usePaymentMethods`), so the label cannot drift from the posting.
 */

export interface DrawerMethodRow {
  code: string;
  label: string;
  drawer_name: string;
  affects_drawer: number;
}

export interface DrawerLegLike {
  method: string;
  amount: number;
}

/** The drawer cash change is paid out of (SalesRepository: change → General). */
export const CHANGE_DRAWER_NAME = "General";

/** "Whish_App" → "Whish App". */
export const drawerDisplayName = (name: string): string =>
  name.replace(/_/g, " ");

/**
 * One "Method → Drawer" entry per distinct method that moves a drawer, in
 * line order, plus "change paid from General" when cash change is handed back and
 * General is not already named. Empty when nothing moves a drawer (an
 * all-account sale) — the caller then shows no drawer line at all.
 */
export function saleDrawerDestinations(
  lines: readonly DrawerLegLike[],
  methods: readonly DrawerMethodRow[],
  changeGiven: boolean,
): string[] {
  const out: string[] = [];
  const seenMethods = new Set<string>();
  const drawers = new Set<string>();
  for (const line of lines) {
    if (!(line.amount > 0) || seenMethods.has(line.method)) continue;
    const pm = methods.find((m) => m.code === line.method);
    if (!pm || pm.affects_drawer !== 1) continue;
    seenMethods.add(line.method);
    drawers.add(pm.drawer_name);
    out.push(`${pm.label} → ${drawerDisplayName(pm.drawer_name)}`);
  }
  if (changeGiven && !drawers.has(CHANGE_DRAWER_NAME)) {
    out.push(`change paid from ${drawerDisplayName(CHANGE_DRAWER_NAME)}`);
  }
  return out;
}
