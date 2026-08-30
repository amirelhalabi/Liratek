# Max Returned Credits — per-card override

**Status:** planned, not started · **Owner interview:** 2026-08-30 · **Migration:** v160 (v159 is the last shipped)

## 0. The problem in one paragraph

`maxReturnableCredits(face)` computes what SMS transfer can recover from a **bare** card —
nothing but the card's own credit on the line. For the alfa 77.28 card that is **$73.00**:
24 messages × $3.16 = $75.84 spent, $1.44 left, and a final $1.50 message needs $1.66.
In practice the customer's line almost always holds a little of their own credit, and
**$0.22 of it** closes that gap, so the shop actually gets **$73.50** back. The computed
number is right about the physics and wrong about the shop. This adds a per-card override.

This is not special to the 77.28 card — every credit-bearing card in the catalog sits
$0.03–$0.49 from another half-dollar — but the backfill is deliberately scoped to 77.28
(§1, decision 5), because that is the only one with counter experience behind it.

| face  | computed | +$0.50 | needs |     | face  | computed | +$0.50 | needs |
| ----- | -------- | ------ | ----- | --- | ----- | -------- | ------ | ----- |
| 3.79  | 3.00     | 3.50   | $0.03 |     | 4.50  | 4.00     | 4.50   | $0.32 |
| 22.73 | 21.00    | 21.50  | $0.05 |     | 7.58  | 7.00     | 7.50   | $0.40 |
| 10.00 | 9.00     | 9.50   | $0.14 |     | 1.22  | 1.00     | 1.50   | $0.44 |
| 15.15 | 14.00    | 14.50  | $0.15 |     | 1.67  | 1.50     | 2.00   | $0.49 |
| 3.03  | 2.50     | 3.00   | $0.13 |     | 1.00  | 0.50     | 1.00   | $0.16 |
| 77.28 | 73.00    | 73.50  | $0.22 |     |       |          |        |       |

## 1. Owner decisions (interview, 2026-08-30)

1. **Shape.** A per-card **"Max returned credits"** field. It always shows the computed
   value; an operator may override it. Same derived/override pattern `days_cost_lbp`
   already uses — badge plus a one-click reset to the formula.
2. **Direction & cap.** Override may only go **UP**, and at most one transfer step:
   `computed ≤ override ≤ computed + CREDIT_TRANSFER_STEP_USD` ($0.50). The data above
   shows one step is exactly what a small customer balance buys, so the cap is the real
   mechanism, not an arbitrary bound. It also blocks the 83-for-73.5 typo class.
3. **Applies everywhere.** The override is the single number used by the sale default, the
   kept-credits base (what the customer is charged), the profit stamp, the carrier-line /
   drawer credit, and the Settings economics block. One definition, no second base.
4. **Short transfer bills the customer.** The sale form autofills 73.5 and the box stays
   editable. If the operator types a lower number, `kept = base − returned` is charged as
   today — returning 73 against a 73.5 base bills 0.5 × credit price = **+50,000 LBP**.
   Owner-confirmed: the shop does not absorb a failed transfer.
5. **Backfill: 77.28 only.** Migration writes 73.5 to the six 365-day 77.28 rows
   (iPick ×2, Katsh ×2, WHISH_APP ×2). Every other card keeps computing bare until the
   owner sets it by hand.
6. **Stale override blocks the save.** Editing `credits` such that a stored override
   breaks the cap is **rejected** with a message naming the conflict, mirroring the
   existing `days_cost_lbp` split guard. No silent auto-clear.

## 2. What the numbers become (alfa 77.28, iPick 7,728,000, days price 1,780,000)

|                       | computed (73.0) | override (73.5) |
| --------------------- | --------------- | --------------- |
| Recovered             | $73.00          | **$73.50**      |
| Rate/$                | 89,984          | **89,371**      |
| Resale 1$ / 2$ / 3$   | 104,381 / 97,182 / 94,783 | **103,671 / 96,521 / 94,138** |
| Margin at 100,000/$   | −4,381 / +2,818 / +5,217 | **−3,671 / +3,479 / +5,862** |
| Only-Days profit stamp | 257,000        | **299,500** (+42,500 = 0.5 × R) |

`days_cost_lbp` does **not** move. It is anchored on FACE credit by design
([telecomCredit.ts:520-533](../../../packages/core/src/utils/telecomCredit.ts#L520-L533)) —
it allocates a purchase before any sale, when no haircut has been paid. The override
prices what actually comes back from a specific sale. Different questions; do not merge.

## 3. Rule 20 — already satisfied, do not re-solve

A refund of an Only-Days sale reverses the carrier-line credit by reading
`carrier_line_movements.credits_delta` back by `transaction_id`
(`CarrierLineMovementRepository`), never by recomputing from the catalog item. So changing
a card's override later cannot desync a sale booked before the change. **No new ledger row
type is introduced, so no new reversal owner is needed.** Add a guard test that proves it
(§6, T7) rather than assuming it stays true.

## 4. Implementation

### 4.1 Core — `packages/core/src/utils/telecomCredit.ts` (rule 14: define once)

```ts
/** Item fields the resolver needs. Any mobile_service_items row fits. */
// extend TelecomCreditReturnItem + TelecomSplitCandidate with:
//   max_returned_credits_usd?: number | null

export function resolveMaxReturnedCredits(
  faceCredits: number | null | undefined,
  override?: number | null,
): number
// override when usable (finite, > 0, passes the cap), else maxReturnableCredits(face).
// The ONE definition. Never re-derive `override ?? computed` at a call site.

export function isValidMaxReturnedOverride(
  override: number,
  faceCredits: number,
): boolean
// computed <= override <= computed + CREDIT_TRANSFER_STEP_USD
// Reuses the existing CREDIT_TRANSFER_STEP_USD constant — no 0.5 literal.
```

Then repoint, in this file:

- `resolveReturnedCredits` ([:765](../../../packages/core/src/utils/telecomCredit.ts#L765)) →
  `resolveMaxReturnedCredits(item.credits, item.max_returned_credits_usd)`
- `deriveItemEconomics` ([:261](../../../packages/core/src/utils/telecomCredit.ts#L261)) →
  take the override in `TelecomItemEconomicsInput`, use it for `maxReturnedUsd`, which
  flows into `recoveredRateLbp` and the resale table for free.

### 4.2 Schema

- **Migration v160** `add_max_returned_credits_override`:
  `ALTER TABLE mobile_service_items ADD COLUMN max_returned_credits_usd REAL` then backfill
  `73.5 WHERE credits = 77.28 AND validity_days = 365 AND max_returned_credits_usd IS NULL`
  (expect **6 rows**). `down()` drops the column. Pin 77.28 / 73.5 as **literals** — a
  migration must keep doing the same thing forever (v146 `OLD_RATE` / v159 convention).
- **`electron-app/create_db.sql`**: add the column to the table body AND the ledger row
  `(160, 'add_max_returned_credits_override')`.

### 4.3 Validator — `packages/core/src/validators/mobileServiceItem.ts`

Add `max_returned_credits_usd: z.number().positive().nullable().optional()` to both create
and update schemas. Cross-field cap via `superRefine` **when `credits` is present in the
payload**. A partial update carrying only the override cannot see `credits`, so the
authoritative check lives in the service (§4.4) — the schema check is the fast path, not
the guarantee.

### 4.4 Service — `MobileServiceItemService`

Enforce decision 6 on **both** edges, since either side can break the pair:

- setting/changing `max_returned_credits_usd` → validate against the row's `credits`
- changing `credits` → validate against the row's **stored** `max_returned_credits_usd`

Reject with a message naming both numbers and the valid range. Rule 13: the service asks
the repository for the row and calls `isValidMaxReturnedOverride`; no SQL, no re-derived
cap arithmetic.

### 4.5 Dual transport (rule 19)

The update path already exists end to end; this is field passthrough, and every one of
these is a place the field silently disappears if missed:

| Layer | File | Change |
| --- | --- | --- |
| IPC handler | `electron-app/handlers/mobileServiceItemHandlers.ts` | payload passthrough |
| Preload | `electron-app/preload.ts` | add to the `data` param type (**rule 12**) |
| REST | `backend/src/api/mobileServices.ts` | same core schema + service |
| Adapter | `frontend/src/api/backendApi.ts`, `ElectronApiAdapter.ts` | field on the write payload |
| Types | `packages/ui/src/api/types.ts`, `frontend/src/types/electron.d.ts` | `MobileServiceItem` |
| Core exports | `packages/core/src/index.ts` **and `browser.ts`** | both new fns — the renderer resolves `@liratek/core` to `browser.ts` |

### 4.6 Frontend

**Settings → `MobileServicesManager.tsx`**

- Edit row: a "Max returned ($)" `DecimalInput` beside the existing split fields, with the
  `= 73` reset button and a derived/override badge, copying the `days_cost_lbp` treatment
  at [:1334](../../../frontend/src/features/settings/pages/Settings/MobileServicesManager.tsx#L1334).
- Display row: `Recovered:` already renders `economics.maxReturnedUsd`, so it picks the
  override up automatically once §4.1 lands. Add the override/derived marker next to it.
- Inline cap feedback while typing, so the operator learns the bound before the save is
  rejected.

**Recharge → `KatchForm.tsx`** — three call sites, all currently `maxReturnableCredits(...)`:

- [:169](../../../frontend/src/features/recharge/components/KatchForm.tsx#L169) `keptCredits`
  base → `resolveMaxReturnedCredits(...)`. This is decision 4; it is the line that bills the
  customer.
- [:916](../../../frontend/src/features/recharge/components/KatchForm.tsx#L916) sale
  autofill → the override, so the box prefills 73.5.
- [:922](../../../frontend/src/features/recharge/components/KatchForm.tsx#L922) the
  **denomination** path has no catalog item and therefore no override — it must keep
  computing. Leave it, and say so in a comment, or the next reader will "fix" it.

## 5. Order of work

1. Core util + its unit tests (pure, no DB — fastest feedback)
2. Migration v160 + `create_db.sql` + migration test
3. Validator + service guard + tests
4. IPC/REST/adapter/types passthrough
5. Settings UI
6. KatchForm (money — do it last, with §6 green behind it)

## 6. Tests — each must fail first (rule 17)

| # | Guards | Fails-first proof |
| --- | --- | --- |
| T1 | `resolveMaxReturnedCredits` returns the override when set, computed when NULL | drop the override branch → 73 not 73.5 |
| T2 | cap: 73.5 accepted, 73.51 / 74 / 83 rejected, 72.9 rejected (downward) | widen the cap → 74 passes |
| T3 | v160 backfills exactly 6 rows; leaves non-77.28 and non-365 rows NULL | drop the `credits = 77.28` filter → more rows move |
| T4 | service blocks a `credits` edit that strands a stored override | remove the reverse-edge check → save succeeds |
| T5 | `deriveItemEconomics` yields rate 89,371 and table 103,671 / 96,521 / 94,138 at 73.5 | leave economics on face → old numbers |
| T6 | Only-Days sale with override books stamp **299,500** and credits the carrier line **73.5** | leave `resolveReturnedCredits` unpatched → 257,000 / 73.0 |
| T7 | **rule 20** — sale at 73.5, then change the override to 73.0, then refund; carrier line and every ledger net to **0 per currency** | make the refund recompute from the item instead of reading `credits_delta` |
| T8 | short transfer: base 73.5, operator returns 73.0 → charge **1,830,000** (decision 4) | clamp kept against computed → 1,780,000 |
| T9 | e2e desktop + web: set the override in Settings, sell Only-Days, assert autofill and charge | — |

E2E must follow the [e2e README](../../../frontend/tests/e2e-electron/README.md) and
**rule 15** — match the row by identity (`item_key` / `service_type`), assert **deltas**
against a pre-action snapshot, never `getRecent(...)[0]` or absolute totals.

## 7. Risks

- **Decision 4 is the sharp edge.** A failed transfer now bills the customer 50,000 for
  credit that burned in fees. Owner-confirmed and deliberate, but it is the item most
  likely to generate a counter dispute, and T8 is what pins the behaviour if it is ever
  revisited.
- **Six call sites, one fact.** `resolveMaxReturnedCredits` must be the only place
  `override ?? computed` is written. A second copy is how Settings and the sale screen end
  up disagreeing about what a card returns — the exact failure `resolveCreditSellPriceLbp`
  was extracted to prevent.
- **`browser.ts`** — a core export missing there kills the renderer at load with a resolve
  error that points nowhere near the real cause.
- **Not retroactive.** Profit is stamped at sale time, so past Only-Days sales keep their
  257,000. Only sales made after the override lands book 299,500. Correct, but worth
  saying out loud before someone reads the Profits page and files a bug.
