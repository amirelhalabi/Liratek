# Research — LIRA-391

## R1. Which core branches route money on a lump flag while legs exist?

- **Decision**: two branches, both in `FinancialServiceRepository.createTransaction`:
  - the wallet RECEIVE block shared by BINANCE, OMT_APP and WHISH_APP (`isAppWallet || isBINANCE`,
    `cashoutMethod === "CUSTOMER_ACCOUNT"` lump credit before the per-leg loop);
  - the system OMT / WHISH RECEIVE block (driven by the Services page): account lump, wallet lump
    (`cashoutMethod !== "CASH"` posts the whole payout from the wallet drawer), CASH per-leg
    `postPayoutLegs`. A stale `WHISH` flag with a CASH second line is the same hole.
- **Note**: the spec's "OMT App / Whish App branch ~5574" is in fact the system OMT/WHISH branch;
  the app wallets share the Binance block. Both are fixed; each gets its own sweep rows.
- **Not fenced**: the other-provider RECEIVE (BOB, OTHER — `!useSystemDrawerFlow`) has no
  per-leg payout path, so it keeps the flag. A first cut fenced it and the BOB sweep row caught
  the dropped account credit; no screen sends these providers (REST only).
- **Not holes** (read and confirmed): `LotoTicketRepository` (legs checked before
  `payment_method`), `LotoCashPrizeRepository` (always CASH, no flag), `RechargePartnerOrderService`
  (the flag is a refusal, loosening it would be wrong), the `paidBy` sites inside no-leg `else`
  branches of the SEND / BILL paths.

## R2. Routing vs eligibility

- **Decision**: two helpers. Routing ignores the flag once any non-zero IN leg exists (per-leg path
  even for an all-account payout, so `reconcileLegs` runs). Eligibility reads the method from the
  legs (shared method, else `"MIXED"`).
- **Rationale**: "legs present ⇒ CASH" would quietly lift today's refusal of kept change / round-up
  on an all-wallet system payout (`isSystemReceive && cashout !== "CASH"`).
- **Alternatives**: throw on contradiction — rejected by FR-2 (every shipped page sends the stale flag).

## R3. Page helper location

- **Decision**: `lumpMethodOf` in `frontend/src/utils/paymentUtils.ts` next to `derivePaidByMethod`,
  which is rewritten on top of it; the FR-5 guard allowlists that one file.
- **Rationale**: one allowlisted file; `derivePaidByMethod` already lives there.

## R4. Zero-amount legs

- **Decision**: a leg counts only when `|amount| > 0` (same rule the wallet branch already uses for
  added change). A page that sends one empty line plus a flag keeps the legacy flag path.
