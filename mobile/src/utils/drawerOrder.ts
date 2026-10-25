/**
 * Home's drawer order (owner decision 2026-10-25): the cash drawer first, the
 * shop's own money-transfer drawer second, then the digital ones — wallets,
 * voucher stock, SIM credit. Drawers not listed here go last, alphabetically,
 * so a new drawer is never dropped.
 */
const DIGITAL_ORDER = ["Whish_App", "OMT_App", "Binance", "Katsh", "iPick", "Alfa", "MTC"];

export function homeDrawerOrder(names: readonly string[], baseSystem: "OMT" | "WHISH" | null): string[] {
  // The primary system's cash drawer comes right after General; the other
  // one (shown only while it holds money) follows it. Unknown base: OMT first.
  const systemDrawers = baseSystem === "WHISH" ? ["Whish_System", "OMT_System"] : ["OMT_System", "Whish_System"];
  const order = ["General", ...systemDrawers, ...DIGITAL_ORDER];
  const known = order.filter((d) => names.includes(d));
  const others = names.filter((d) => !order.includes(d)).sort();
  return [...known, ...others];
}
