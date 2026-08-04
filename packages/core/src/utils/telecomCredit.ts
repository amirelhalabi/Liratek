/**
 * Telecom Days & Credit Validity Model (MTC/Alfa) — pure calculation core.
 *
 * Spec: docs/plans/todo_plans/TELECOM_DAYS_VALIDITY_PLAN.md §2.
 *
 * A telecom catalog item (an MTC/Alfa "cart") bundles validity days and USD
 * credit that the shop pays for together. When a customer only wants the
 * days, the shop charges the whole cart and the customer SMSes the credit
 * back — losing a little to per-SMS transfer fees along the way. Every
 * function in this file is pure (no DB, no I/O) so it can be unit-tested in
 * isolation and shared verbatim between Settings validation, the sale-time
 * gate, and the checkout UI (rule 14 — one definition, reused everywhere).
 *
 * All money math below is done in integer USD *cents* internally. 0.16 and
 * 0.5 are not exactly representable in binary floating point, so doing this
 * arithmetic in raw doubles risks a value like 72.99999999999999 instead of
 * 73.0 — which would silently floor to the wrong 0.5$ step and cost the shop
 * real money on every sale. Converting to integer cents up front (rounding
 * once, at the boundary) makes every intermediate step exact.
 */

// =============================================================================
// Carrier constants (hardcoded — owner's explicit choice, spec §2.1)
// =============================================================================

/** Most credit ($) that can ride on a single SMS transfer. */
export const MAX_CREDIT_PER_SMS_USD = 3;

/** Fee ($) burned per SMS transfer, charged to the *sender's* balance. */
export const SMS_TRANSFER_FEE_USD = 0.16;

/** Credit transfers must be a multiple of this ($) — 0.5, 1, 1.5, 2, 2.5, 3. */
export const CREDIT_TRANSFER_STEP_USD = 0.5;

// -----------------------------------------------------------------------------
// Integer-cents helpers (internal — keeps the floating point demons out)
// -----------------------------------------------------------------------------

const USD_CENTS_SCALE = 100;

/** Round a USD amount to the nearest integer cent. Used ONLY for the fixed
 *  carrier constants below (§2.1) — those are exact decimal literals, so
 *  only binary floating-point noise (never real sub-cent precision) needs
 *  correcting, and rounding vs. flooring makes no difference for them. */
function toCents(usd: number): number {
  return Math.round(usd * USD_CENTS_SCALE);
}

/**
 * Floor a USD BALANCE down to the nearest integer cent (M1 fix, 2026-07-30
 * adversarial review). `balanceUsd` is a REAL column an admin can type by
 * hand to arbitrary precision (e.g. a carrier receipt reading 76.999$).
 * Running that value through `toCents` (`Math.round`) rounds a sub-cent
 * balance UP — `maxReturnableCredits(76.999)` silently became
 * `maxReturnableCredits(77)`, expecting 0.5$ MORE credit back than the
 * SMS-transfer math actually supports (73 vs. the true 72.5). Flooring is
 * the only direction that can never overstate what the shop will recover.
 *
 * The `1e-9` nudge before flooring guards the SAME binary floating-point
 * noise `toCents` above tolerates — without it, an EXACT balance like
 * 1.16$ (whose `* 100` lands on `115.99999999999999` in double precision,
 * not 116) would wrongly floor to 115 instead of 116, corrupting an
 * already-exact cent value. The nudge (a ten-millionth of a cent) is far
 * too small to ever mask a genuine sub-cent fraction the admin typed.
 */
function floorBalanceToCents(usd: number): number {
  return Math.floor(usd * USD_CENTS_SCALE + 1e-9);
}

/** Convert integer cents back to a USD amount. */
function fromCents(cents: number): number {
  return cents / USD_CENTS_SCALE;
}

const MAX_CREDIT_PER_SMS_CENTS = toCents(MAX_CREDIT_PER_SMS_USD); // 300
const SMS_TRANSFER_FEE_CENTS = toCents(SMS_TRANSFER_FEE_USD); // 16
const CREDIT_TRANSFER_STEP_CENTS = toCents(CREDIT_TRANSFER_STEP_USD); // 50

/** Floor a cents amount down to the nearest transfer step, in integer cents. */
function floorToStepCents(cents: number): number {
  return (
    Math.floor(cents / CREDIT_TRANSFER_STEP_CENTS) * CREDIT_TRANSFER_STEP_CENTS
  );
}

// =============================================================================
// §2.2 — maxReturnableCredits
// =============================================================================

/**
 * The most USD credit that can be transferred back out of a balance via SMS,
 * given the per-message ceiling and the per-message fee.
 *
 * Sending X$ costs the sender X + 0.16$. With `n` messages, the most that can
 * be transferred is bounded by both the per-message ceiling (3$) and the
 * balance surviving the fees:
 *
 *   transferable(n) = min( MAX_CREDIT_PER_SMS_USD * n , balance - SMS_TRANSFER_FEE_USD * n )
 *   maxReturnable   = max over n in [0, ceil(balance / (MAX + FEE))] of floorToStep(transferable(n))
 *
 * The full small range of `n` is evaluated and the maximum taken — this does
 * **not** shortcut to a single `n`. Both `n-1` and `n` (the loop's ceiling)
 * can win depending on the balance (see the plan's §2.2 worked examples), so
 * skipping candidates would silently under- or over-count.
 *
 * @param balanceUsd - the USD face value of the credit to be returned
 * @returns the maximum returnable credit, floored to a 0.5$ step; 0 for any
 *   non-finite, negative, or zero input
 *
 * @example
 * maxReturnableCredits(77)   // 73.0  — the 77$ cart's headline case
 * maxReturnableCredits(3.2)  // 3.0   — the n-1 candidate wins
 * maxReturnableCredits(5)    // 4.5   — the loop-ceiling n wins
 */
export function maxReturnableCredits(balanceUsd: number): number {
  if (!Number.isFinite(balanceUsd) || balanceUsd <= 0) {
    return 0;
  }

  const balanceCents = floorBalanceToCents(balanceUsd);
  const perMessageCostCents = MAX_CREDIT_PER_SMS_CENTS + SMS_TRANSFER_FEE_CENTS; // 316
  const maxN = Math.ceil(balanceCents / perMessageCostCents);

  let bestCents = 0;
  for (let n = 0; n <= maxN; n++) {
    const capCents = MAX_CREDIT_PER_SMS_CENTS * n;
    const survivingCents = balanceCents - SMS_TRANSFER_FEE_CENTS * n;
    const transferableCents = Math.min(capCents, survivingCents);
    if (transferableCents <= 0) continue;

    const flooredCents = floorToStepCents(transferableCents);
    if (flooredCents > bestCents) {
      bestCents = flooredCents;
    }
  }

  return fromCents(bestCents);
}

// =============================================================================
// §5.1 — isTelecomSplitComplete (the single definition, rule 14)
// =============================================================================

/**
 * Structural shape `isTelecomSplitComplete` needs. Any item/form object with
 * at least these three fields satisfies it — callers do not need to import a
 * specific DB entity type (frontend form state, a repository row, and a
 * Settings draft can all pass their own shape as-is).
 */
export interface TelecomSplitCandidate {
  cost_lbp: number | null | undefined;
  days_cost_lbp: number | null | undefined;
  credits: number | null | undefined;
}

/**
 * The ONE definition of "this telecom catalog item's Only-Days split is
 * complete enough to offer the computed flow." Imported by Settings
 * validation, the sale-time gate, and the checkout checkbox-enable
 * condition — never re-encode this predicate anywhere else (rule 14).
 *
 * `cost_lbp > 0 AND days_cost_lbp IS NOT NULL AND days_cost_lbp > 0
 *  AND credits > 0 AND days_cost_lbp < cost_lbp`
 *
 * Items that fail this (the default — split columns start NULL) keep
 * today's manual "Only Days" behaviour; they are simply not eligible for the
 * computed default.
 */
export function isTelecomSplitComplete(item: TelecomSplitCandidate): boolean {
  const { cost_lbp, days_cost_lbp, credits } = item;

  return (
    typeof cost_lbp === "number" &&
    Number.isFinite(cost_lbp) &&
    cost_lbp > 0 &&
    typeof days_cost_lbp === "number" &&
    Number.isFinite(days_cost_lbp) &&
    days_cost_lbp > 0 &&
    typeof credits === "number" &&
    Number.isFinite(credits) &&
    credits > 0 &&
    days_cost_lbp < cost_lbp
  );
}

// =============================================================================
// §2.3 — deriveItemEconomics
// =============================================================================

/** Input to {@link deriveItemEconomics}. */
export interface TelecomItemEconomicsInput {
  /** The catalog item's total LBP cost (validity days + credit, combined). */
  costLbp: number;
  /** The LBP cost attributable to validity days alone. */
  daysCostLbp: number | null | undefined;
  /** The item's face USD credit value (the `credits` column). */
  creditsUsd: number | null | undefined;
}

/** Output of {@link deriveItemEconomics}. */
export interface TelecomItemEconomics {
  /** `costLbp - daysCostLbp` — the LBP cost attributable to the credit alone. */
  creditCostLbp: number | null;
  /** `maxReturnableCredits(creditsUsd)` — the default returned-credit default. */
  maxReturnedUsd: number | null;
  /** Cost (LBP) per $1 the shop actually gets back via SMS transfer. */
  recoveredRateLbp: number | null;
  /** Cost (LBP) per $1 when the cart is self-charged to the shop's own line. */
  selfChargeRateLbp: number | null;
}

const INCOMPLETE_ECONOMICS: TelecomItemEconomics = {
  creditCostLbp: null,
  maxReturnedUsd: null,
  recoveredRateLbp: null,
  selfChargeRateLbp: null,
};

/**
 * Derive the per-item economics of the Only-Days split (spec §2.3).
 *
 * Owner's equation, confirmed verbatim: `itemCost = maxReturnedCredits * rate + onlyDaysCost`.
 *
 * Returns nulls — never throws, never NaN — when the split is incomplete
 * (see {@link isTelecomSplitComplete}) or when a rate would require dividing
 * by zero (e.g. a `creditsUsd` too small to ever return anything via SMS).
 *
 * @example
 * // The 77$ cart
 * deriveItemEconomics({ costLbp: 7_600_000, daysCostLbp: 1_162_000, creditsUsd: 77 })
 * // → { creditCostLbp: 6438000, maxReturnedUsd: 73, recoveredRateLbp: ≈88191.78, selfChargeRateLbp: ≈83610.39 }
 */
export function deriveItemEconomics(
  input: TelecomItemEconomicsInput,
): TelecomItemEconomics {
  const { costLbp, daysCostLbp, creditsUsd } = input;

  if (
    !isTelecomSplitComplete({
      cost_lbp: costLbp,
      days_cost_lbp: daysCostLbp,
      credits: creditsUsd,
    })
  ) {
    return INCOMPLETE_ECONOMICS;
  }

  // isTelecomSplitComplete guarantees all three are finite numbers, credits > 0,
  // and daysCostLbp < costLbp — so creditCostLbp is guaranteed > 0 here too.
  const creditCostLbp = costLbp - (daysCostLbp as number);
  const maxReturnedUsd = maxReturnableCredits(creditsUsd as number);

  const recoveredRateLbp =
    maxReturnedUsd > 0 ? creditCostLbp / maxReturnedUsd : null;
  const selfChargeRateLbp = creditCostLbp / (creditsUsd as number);

  return { creditCostLbp, maxReturnedUsd, recoveredRateLbp, selfChargeRateLbp };
}

// =============================================================================
// One SMS transfer function (TELECOM_DAYS_COST_PLAN.md §9/§6, owner ask
// 2026-08-04) — replaces two independent re-derivations of the same 0.16$/
// message fee: RechargeRepository's real-sale SMS deduction and this file's
// resale decision table. Both now express themselves through this function
// (rule 14 — one definition, reused everywhere).
// =============================================================================

/** The result of planning an SMS credit transfer of a given USD amount. */
export interface SmsTransferPlan {
  /** Messages needed to move `amountUsd` (each capped at `perSmsUsd`). */
  messages: number;
  /** `messages * SMS_TRANSFER_FEE_USD` — the fee burned by the transfer. */
  feeUsd: number;
  /** `amountUsd + feeUsd` — what actually leaves the sender's balance. */
  totalCostUsd: number;
}

const ZERO_SMS_TRANSFER_PLAN: SmsTransferPlan = {
  messages: 0,
  feeUsd: 0,
  totalCostUsd: 0,
};

/**
 * Plan the SMS transfer of `amountUsd` of credit: how many messages it takes
 * and what it costs the sender. Never throws, never returns NaN — a zeroed
 * plan comes back for any non-finite or non-positive input, matching the
 * null/zero style used elsewhere in this file.
 *
 * @param amountUsd - the USD credit to move
 * @param perSmsUsd - the most credit ($) one SMS can carry; defaults to
 *   {@link MAX_CREDIT_PER_SMS_USD}
 */
export function planSmsTransfer(
  amountUsd: number,
  perSmsUsd: number = MAX_CREDIT_PER_SMS_USD,
): SmsTransferPlan {
  if (
    !Number.isFinite(amountUsd) ||
    amountUsd <= 0 ||
    !Number.isFinite(perSmsUsd) ||
    perSmsUsd <= 0
  ) {
    return { ...ZERO_SMS_TRANSFER_PLAN };
  }

  const messages = Math.ceil(amountUsd / perSmsUsd);
  const feeUsd = messages * SMS_TRANSFER_FEE_USD;
  const totalCostUsd = amountUsd + feeUsd;

  return { messages, feeUsd, totalCostUsd };
}

// =============================================================================
// §2.4 — deliveredCostLbp (the resale decision aid)
// =============================================================================

/**
 * The real LBP cost of delivering $1 of recovered credit when it is resold in
 * chunks of `chunkUsd` (typically 1, 2, or 3 — spec §2.4). Once the shop
 * holds recovered credit, reselling it also burns a 0.16$ SMS fee, so the
 * true cost per delivered dollar depends on the chunk size. Expressed
 * through {@link planSmsTransfer} (one SMS transfer function, see above):
 *
 *   deliveredCostLbp(chunk) = recoveredRateLbp * planSmsTransfer(chunk).totalCostUsd / chunk
 *                           = recoveredRateLbp * (chunk + 0.16) / chunk
 *                           = recoveredRateLbp * (1 + SMS_TRANSFER_FEE_USD / chunk)
 *
 * The three forms are algebraically identical for `chunk <= MAX_CREDIT_PER_SMS_USD`
 * (the only domain this is ever called with — 1$/2$/3$ chunks), since exactly
 * one message covers the whole chunk (`planSmsTransfer` returns `messages: 1`).
 *
 * This is a computed decision aid, not a stored per-item setting — render it
 * as a 3-row table (chunk = 1$, 2$, 3$) wherever the item's economics are
 * shown.
 *
 * @param recoveredRateLbp - the item's {@link TelecomItemEconomics.recoveredRateLbp}
 * @param chunkUsd - the resale chunk size in USD (must be > 0)
 * @returns the LBP cost per $1 delivered, or null for invalid input
 */
export function deliveredCostLbp(
  recoveredRateLbp: number,
  chunkUsd: number,
): number | null {
  if (
    !Number.isFinite(recoveredRateLbp) ||
    recoveredRateLbp < 0 ||
    !Number.isFinite(chunkUsd) ||
    chunkUsd <= 0
  ) {
    return null;
  }

  return (recoveredRateLbp * planSmsTransfer(chunkUsd).totalCostUsd) / chunkUsd;
}

/**
 * Fallback reference price (LBP) for $1 of resold telecom credit, used by the
 * resale decision table (Settings → Mobile Services, §2.4) when neither the
 * per-item `sell_credit_lbp` nor the tenant's `telecom_credit_sell_price_lbp`
 * setting is available. Matches the value migration v141 seeds for every
 * tenant's `telecom_credit_sell_price_lbp` (`packages/core/src/db/migrations/index.ts`),
 * so a tenant that has never touched the setting sees the same number either
 * way. Named here instead of as a bare literal in the UI (rule 14).
 */
export const DEFAULT_TELECOM_CREDIT_SELL_PRICE_LBP = 100_000;

// =============================================================================
// §4 — days_cost_lbp, credit-rate anchored (TELECOM_DAYS_COST_PLAN.md §4.3/4.4)
// =============================================================================

/**
 * The shop's cost of $1 of credit, LBP. **Owner-confirmed 2026-08-04.**
 *
 * Sourced from iPick > mtc > Credits — the ONE category in the whole catalog
 * where credit is bought with no validity days attached, so it is the only
 * place a per-dollar credit rate can be read directly instead of inferred:
 *
 *   280,000 LBP / 3$ = 93,333.33 LBP/$
 *
 * — and that rate is exactly linear across all five Credits entries in that
 * price list (3$, 5$, 8$, 10$, 15$), not just the one used to derive it.
 *
 * **Hard ceiling: this value must stay below 98,603.** That number is set by
 * the tightest card in the catalog, Katsh/WHISH_APP alfa 77.28
 * (`7,620,030 / 77.28 ≈ 98,602.87 LBP/$`, plan §4.4) — the per-dollar price
 * that specific card was actually sold at. Any global rate at or above that
 * ratio makes `days_cost_lbp = cost_lbp − credits × R` go zero or negative
 * for that card, which trips the `isTelecomSplitComplete` guard (§4.4) and
 * silently turns off the computed Only-Days flow for it. At the value below,
 * all 43 catalog items (plan §1) price positive, the smallest being iPick
 * mtc 3.79 at 25,267 LBP (plan §4.5, verified by
 * `deriveDaysCostLbp.spans the full 43-item catalog` in the test file).
 */
export const TELECOM_CREDIT_COST_RATE_LBP = 93333.33;

/**
 * Derive `days_cost_lbp` for a telecom Only-Days catalog item — the ONE
 * definition of this formula in the codebase (rule 14). Never re-encode this
 * arithmetic in a migration, a parser, or a UI component; import this
 * function instead.
 *
 * Algebra (plan §4.3): the shop pays `costLbp` for a card that bundles both
 * validity days and `creditsUsd` of face credit. `R` is what $1 of credit
 * costs the shop, sourced independently (see
 * {@link TELECOM_CREDIT_COST_RATE_LBP}). Whatever is left over after paying
 * for the credit at that rate is what the days actually cost:
 *
 *   days_cost_lbp = round(cost_lbp − credits × R)
 *
 * **Why `creditsUsd` is the card's FACE value, not `maxReturnableCredits`
 * (plan §4.3, "why credits and not maxReturnableCredits").** The card is
 * bought carrying its full face credit; the SMS recovery loss only happens
 * later, and only if that credit is actually transferred back out. Using
 * `maxReturnableCredits` here would fold that loss into `days_cost_lbp`,
 * making it invisible as an operating cost of the Only-Days flow — and it is
 * exactly the circularity that sank the rejected Model B (plan §4.2): under
 * Model B, `recoveredRateLbp` collapses algebraically to `cost/credits`,
 * the card's own per-dollar price, and stops telling you anything about
 * recovery losses at all. Anchoring on face credit keeps the SMS loss where
 * it belongs — visible, and computed once, downstream, by
 * {@link deriveItemEconomics}.
 *
 * Guard rail (plan §4.4): `isTelecomSplitComplete` requires
 * `0 < days_cost_lbp < cost_lbp`. This function enforces that same bound
 * itself and returns `null` — never a value the guard would reject — so
 * every caller (a migration backfill, a Settings save, a seed script) can
 * treat `null` uniformly as "cannot derive this one, leave it unset" without
 * re-deriving the bound check itself (rule 14).
 *
 * Never throws, never returns NaN — matches the null-returning style of
 * {@link deriveItemEconomics} elsewhere in this file.
 *
 * @param costLbp - the catalog item's total LBP cost
 * @param creditsUsd - the item's face USD credit value (the `credits` column)
 * @param rateLbp - LBP cost of $1 of credit; defaults to
 *   {@link TELECOM_CREDIT_COST_RATE_LBP}
 * @returns `round(costLbp - creditsUsd * rateLbp)`, or `null` if any input is
 *   non-finite/non-positive, or the result would not satisfy
 *   `0 < days_cost_lbp < cost_lbp`
 *
 * @example
 * // iPick alfa 77.28 (plan §4.5)
 * deriveDaysCostLbp(7_728_000, 77.28) // → 515,200
 */
export function deriveDaysCostLbp(
  costLbp: number,
  creditsUsd: number | null | undefined,
  rateLbp: number = TELECOM_CREDIT_COST_RATE_LBP,
): number | null {
  if (
    typeof costLbp !== "number" ||
    !Number.isFinite(costLbp) ||
    costLbp <= 0 ||
    typeof creditsUsd !== "number" ||
    !Number.isFinite(creditsUsd) ||
    creditsUsd <= 0 ||
    !Number.isFinite(rateLbp) ||
    rateLbp <= 0
  ) {
    return null;
  }

  const daysCostLbp = Math.round(costLbp - creditsUsd * rateLbp);

  if (daysCostLbp <= 0 || daysCostLbp >= costLbp) {
    return null;
  }

  return daysCostLbp;
}
