/**
 * LIRA-359 (owner decision 2026-10-29) — a settle box may be paid in the
 * other currency: "You pay SAMER $2,984" can be paid in LBP, converted at
 * the box's rate. Each box still pays only its own currency's amount; the
 * drawer moves in the currency each line was actually paid in.
 *
 * The ONE conversion (rule 14) used by the settle sheets' previews and by
 * the server, so both agree on what a box's lines pay. OMT never converts
 * (its boxes keep exact amounts per currency) — callers decide that.
 *
 * Pure and browser-safe (rule 29): no Node built-in, no repository.
 */

export type SettleBoxCurrency = "USD" | "LBP";

/** Ledger rounding: USD to the cent, LBP to the whole lira (owner decision
 *  2026-10-29: a converted fraction under one cent is dropped). */
export function roundSettleAmount(
  amount: number,
  currency: SettleBoxCurrency,
): number {
  return currency === "USD"
    ? Math.round(amount * 100) / 100
    : Math.round(amount);
}

/** One line's amount in the box's currency, converted at `rate` (LBP per
 *  USD) when the line is in the other currency. Unrounded — sum first, then
 *  round once with {@link roundSettleAmount}. */
export function settleLegAmountIn(
  leg: { currency_code: string; amount: number },
  currency: SettleBoxCurrency,
  rate: number,
): number {
  const amount = Math.abs(leg.amount);
  if (leg.currency_code === currency) return amount;
  if (!(rate > 0)) return 0;
  return currency === "USD" ? amount / rate : amount * rate;
}

/** Whether any line is in a currency other than the box's own. */
export function settleLegsCrossCurrency(
  legs: ReadonlyArray<{ currency_code: string }>,
  currency: SettleBoxCurrency,
): boolean {
  return legs.some((leg) => leg.currency_code !== currency);
}

/** A box's lines in the box's currency: each line converted at `rate` and
 *  rounded on its own (what the server books per line). */
export function settleLegsInBoxCurrency<
  L extends { currency_code: string; amount: number },
>(legs: ReadonlyArray<L>, currency: SettleBoxCurrency, rate: number): L[] {
  return legs.map((leg) => ({
    ...leg,
    currency_code: currency,
    amount: roundSettleAmount(settleLegAmountIn(leg, currency, rate), currency),
  }));
}

/** What a box's lines pay in the box's currency: paid lines minus change
 *  handed back (`direction: "OUT"`), each converted at `rate` and rounded
 *  per line ({@link settleLegsInBoxCurrency}). */
export function settleLegsNetIn(
  legs: ReadonlyArray<{
    currency_code: string;
    amount: number;
    direction?: "IN" | "OUT";
  }>,
  currency: SettleBoxCurrency,
  rate: number,
): number {
  const net = settleLegsInBoxCurrency(legs, currency, rate).reduce(
    (sum, leg) => sum + (leg.direction === "OUT" ? -1 : 1) * leg.amount,
    0,
  );
  return roundSettleAmount(net, currency);
}

/** The "Total" line under the boxes: every box's paid lines added up by the
 *  currency they were paid in (change handed back taken off). */
export function settleLegsTotalByCurrency(
  legs: ReadonlyArray<{
    currency_code: string;
    amount: number;
    direction?: "IN" | "OUT";
  }>,
): { usd: number; lbp: number } {
  let usd = 0;
  let lbp = 0;
  for (const leg of legs) {
    const v = (leg.direction === "OUT" ? -1 : 1) * Math.abs(leg.amount);
    if (leg.currency_code === "USD") usd += v;
    else if (leg.currency_code === "LBP") lbp += v;
  }
  return {
    usd: roundSettleAmount(usd, "USD"),
    lbp: roundSettleAmount(lbp, "LBP"),
  };
}

/**
 * LIRA-359 — one payment box that settles BOTH currencies (the supplier
 * sheet's main box): which part of each line pays which currency.
 *
 * Each currency is paid first by the lines in its own currency. Whatever a
 * currency's own lines pay beyond its amount covers the other currency's
 * shortfall, converted at `rate` (the line is split: that part is sent in
 * the other currency's section, still in its own currency). What is left
 * over stays in its own currency's section — extra paid stays in the
 * currency it was paid in (owner decision 2026-10-29).
 *
 * `owed` is what the box settles per currency (magnitudes). A currency the
 * box does not settle has no section: its lines go to the other currency.
 */
export function splitBoxLinesAcrossCurrencies<
  L extends { currencyCode: string; amount: number },
>(
  lines: readonly L[],
  owed: Partial<Record<SettleBoxCurrency, number>>,
  rate: number,
): Record<SettleBoxCurrency, L[]> {
  const out: Record<SettleBoxCurrency, L[]> = { USD: [], LBP: [] };
  const settled = (["USD", "LBP"] as const).filter((c) => owed[c] !== undefined);
  const paid = lines.filter((l) => l.amount > 0);
  if (settled.length === 0) return out;
  if (settled.length === 1) {
    out[settled[0]] = [...paid];
    return out;
  }
  const own = (c: SettleBoxCurrency) => paid.filter((l) => l.currencyCode === c);
  const sum = (ls: readonly L[]) => ls.reduce((s, l) => s + l.amount, 0);
  const other = (c: SettleBoxCurrency): SettleBoxCurrency =>
    c === "USD" ? "LBP" : "USD";
  for (const c of ["USD", "LBP"] as const) {
    const d = other(c);
    const surplus = sum(own(c)) - (owed[c] ?? 0);
    const shortOther = (owed[d] ?? 0) - sum(own(d));
    // The other currency's shortfall, in this currency's units.
    const shortInC =
      shortOther > 0 && rate > 0
        ? c === "USD"
          ? shortOther / rate
          : shortOther * rate
        : 0;
    let move = roundSettleAmount(
      Math.max(0, Math.min(surplus, shortInC)),
      c,
    );
    // Split the lines, taking the moved part from the last lines first.
    const keep: L[] = [];
    const moved: L[] = [];
    for (const line of [...own(c)].reverse()) {
      const take = roundSettleAmount(Math.min(line.amount, move), c);
      move = roundSettleAmount(move - take, c);
      if (take > 0) moved.unshift({ ...line, amount: take });
      const rest = roundSettleAmount(line.amount - take, c);
      if (rest > 0) keep.unshift({ ...line, amount: rest });
    }
    out[c].push(...keep);
    out[d].push(...moved);
  }
  return out;
}
