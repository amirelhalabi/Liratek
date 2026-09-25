/**
 * Pure formatting/parsing helpers for the dashboard Sales/Profit chart —
 * DC-4/DC-5/DC-6/DC-8 (OWNER_NOTES_2026-09-21.md §7.1).
 *
 * Split out of `DashboardChart.tsx` and `Dashboard.tsx` (round-2 verifier
 * finding LINT-1): react-refresh's `only-export-components` ESLint rule
 * flags a COMPONENT file that ALSO exports plain functions — Vite's fast
 * refresh can't preserve component state across an edit to a file whose
 * exports aren't all components, so the rule refuses to allow the mix.
 * These four functions never touch React; they belong in a plain module,
 * IMPORTED (not re-exported) by both component files and by their own
 * dedicated unit tests. Do not add a non-component export back to either
 * component file — add it here instead.
 */

/**
 * DC-5 (OWNER_NOTES_2026-09-21.md §7.1) — the left (USD) Y-axis used to
 * divide every tick by 1,000 and label it "Nk" unconditionally, so a shop
 * under ~$500/day saw ticks like "0k 0k 1k 1k" (several distinct dollar
 * values all rounding to the same one- or two-character label). Below
 * $1,000 this renders the plain dollar amount instead; at/above it keeps
 * the "k" shorthand (one decimal, e.g. "$1.2k").
 *
 * CHART-m1 (verifier finding, round 1 of the DC-10..12 fix pass) — the
 * Profit axis's domain is `['auto','auto']` (a day's gross profit can be
 * negative), so this formatter now also has to handle negative ticks. The
 * old `value >= 1000` check let every negative value fall to the `$Math
 * .round(value)` branch, which put the sign AFTER the `$` (`$-1500`) and
 * never engaged the 'k' shorthand no matter how large the magnitude — the
 * threshold compared the signed value, not its size. This buckets on
 * `Math.abs(value)` and renders the sign before the `$` (`-$1.5k`).
 */
export function formatUsdAxisTick(value: number): string {
  // CHART-V2-m2 (verifier finding, round 2) — the bucket used to be chosen
  // against the UNROUNDED magnitude, so a value whose DISPLAYED (rounded)
  // amount reaches 1,000 could still fall into the plain-dollar branch:
  // formatUsdAxisTick(999.6) returned "$1000" (four raw digits, no 'k')
  // instead of "$1.0k". Rounding the magnitude FIRST, once, and bucketing
  // on that rounded value keeps the branch and the printed number in
  // agreement at every boundary. This also fixes formatUsdAxisTick(-0.4)
  // printing "-$0" — a magnitude that rounds down to exactly 0 is signless.
  const magnitude = Math.round(Math.abs(value));
  const sign = value < 0 && magnitude !== 0 ? "-" : "";
  if (magnitude >= 1000) {
    return `${sign}$${(magnitude / 1000).toFixed(1)}k`;
  }
  return `${sign}$${magnitude}`;
}

/**
 * CHART-m1 (verifier finding) — the LBP right-axis tick formatter was a
 * bare inline `${(value/1_000_000).toFixed(1)}M`, unconditionally, inside
 * `DashboardChart.tsx` (both the Sales AND Profit axes). For a realistic
 * day's LBP GROSS PROFIT (0–100,000 LBP; a full LBP sales day tops out
 * higher but a day's profit slice is a fraction of that) every tick divides
 * to under 0.15, so `toFixed(1)` collapses several distinct ticks to the
 * same "0.0M"/"0.1M" label — the exact DC-5 symptom, reproduced on the new
 * axis. Mirrors `formatUsdAxisTick`'s magnitude buckets (plain below
 * 1,000; 'k' with one decimal from 1,000 up to 1,000,000; 'M' with one
 * decimal at/above 1,000,000) and is sign-aware the same way, for the same
 * reason (Profit's LBP axis is also `['auto','auto']` and can go negative).
 */
export function formatLbpAxisTick(value: number): string {
  // CHART-V2-m2 (verifier finding, round 2) — same magnitude-then-bucket
  // fix as `formatUsdAxisTick`, plus one more boundary specific to having
  // TWO buckets: a value can pick the 'k' bucket on its raw magnitude
  // (< 1,000,000) yet its own one-decimal 'k' display rounds up to
  // "1000.0k" (e.g. 999,950 → 999.95k → "1000.0k") — a 4-digit 'k' value
  // one step past where 'M' should have taken over. Escalate to 'M'
  // whenever the rounded 'k' display would itself reach 1000.
  const magnitude = Math.round(Math.abs(value));
  const sign = value < 0 && magnitude !== 0 ? "-" : "";

  if (magnitude >= 1_000_000) {
    return `${sign}${(magnitude / 1_000_000).toFixed(1)}M`;
  }
  if (magnitude >= 1000) {
    const kRounded = Math.round((magnitude / 1000) * 10) / 10;
    if (kRounded >= 1000) {
      return `${sign}${(magnitude / 1_000_000).toFixed(1)}M`;
    }
    return `${sign}${kRounded.toFixed(1)}k`;
  }
  return `${sign}${magnitude}`;
}

/**
 * DC-6 — the shared Tooltip formatter for both chart types, keyed off the
 * Recharts `dataKey` (a stable identifier: "usd" / "lbp" / "profit") rather
 * than the line's DISPLAYED `name`, so relabeling a series (DC-4) can never
 * silently break which currency formatter a value gets. Every value is run
 * through the app's own `formatAmount` — the pre-fix "USD Sales" line fell
 * through to a bare `toLocaleString()` with no `$` and no cents.
 */
export function formatTooltipValue(
  value: number | string | undefined,
  name: string | undefined,
  dataKey: string | undefined,
  formatAmount: (value: number, currency: string) => string,
): [string, string] {
  const valNum = typeof value === "number" ? value : Number(value ?? 0);
  const label = name ?? "";
  if (dataKey === "lbp") {
    return [formatAmount(valNum, "LBP"), label];
  }
  if (dataKey === "usd" || dataKey === "profit") {
    return [formatAmount(valNum, "USD"), label];
  }
  return [
    `${valNum.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
    label,
  ];
}

/**
 * DC-8 (OWNER_NOTES_2026-09-21.md §7.1) — parse a "YYYY-MM-DD" calendar-day
 * string as a LOCAL date, never via `new Date("YYYY-MM-DD")`. The bare ES
 * spec parses a date-only string as UTC MIDNIGHT, so any browser west of
 * UTC (every US timezone, for instance) renders the PREVIOUS calendar day.
 * The chart's dates already come pre-resolved to the operator's own local
 * day — both series now cover the SAME 30 client days, ending on the
 * `endDay` `SalesService.getChartData` resolves ONCE (`endDay ??
 * clientDay()`, DAY-1, rule 27) and passes through to
 * `SalesRepository.getChartData("Sales", endDay)`, not a second,
 * independently-resolved `date('now','localtime')` — so this just reads
 * y/m/d literally — no further timezone conversion belongs here.
 * `parseDbDate` (frontend/src/shared/utils/parseDbDate.ts) solves a
 * DIFFERENT problem — a full `YYYY-MM-DD HH:MM:SS` timestamp that IS meant
 * to be UTC — and would reproduce this exact bug if reused for a bare
 * calendar day.
 */
export function parseLocalDateOnly(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year || 1970, (month || 1) - 1, day || 1);
}

/**
 * DC-5 (OWNER_NOTES_2026-09-21.md §7.1) — round a chart axis max up to a
 * "nice" step proportional to its own magnitude, not a flat next-thousand.
 * A shop under ~$500/day used to get `Math.ceil(max / 1000) * 1000`, which
 * forces the domain to [0, 1000] regardless of how small `max` actually is
 * — every tick under $1,000 then collapses to the same "0k"/"1k" label
 * (`formatUsdAxisTick` dividing by 1000). Below $1,000 this rounds to the
 * next $100 instead, so a $420 max yields ticks at $100 increments instead
 * of one coarse $0/$1,000 pair.
 */
export function niceUsdAxisMax(value: number): number {
  if (value <= 0) return 0;
  if (value < 1000) return Math.ceil(value / 100) * 100;
  return Math.ceil(value / 1000) * 1000;
}
