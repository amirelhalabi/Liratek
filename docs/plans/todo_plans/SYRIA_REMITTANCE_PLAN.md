# Syria Remittance — a custom transfer provider that can pay OUT

> **Status**: planned, nothing built. **Written**: 2026-09-17, after the owner asked
> how to record a Syria transfer in both directions.
> **Money plan** — read `docs/FEATURE_GUIDE.md` §13 before touching any of it
> (root `CLAUDE.md` rule 18).
> Related: `ongoing_plans/PARTNER_DISBURSEMENT_MATRIX.md` (names "7welet souria" as
> an open gap), `done_plans/FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md` (built the
> provider taxonomy this plan finishes).

---

## 1. What the owner actually needs

A remittance corridor with Syria, run through a partner ("7welet souria"),
in **both** directions:

| Direction | Physical event | Drawer | Partner ledger |
| --- | --- | --- | --- |
| **SEND** | Customer hands us cash for a relative in Syria | **+** cash in | **CREDIT** — we owe the partner |
| **RECEIVE** | Relative in Syria sent money; we hand the customer cash | **−** cash out | **DEBIT** — the partner owes us |

The shop keeps a commission on both. Neither direction exists today.

---

## 2. What exists today, and exactly what each piece gets wrong

All rows **verified by reading source**, 2026-09-17.

| Piece | State | What it gets wrong for Syria |
| --- | --- | --- |
| `service_providers` table | ✅ Genuinely provider-agnostic. `code`/`label`/`drawer_name`/`is_system_provider`, FK'd from `financial_services.provider` since v154 (`electron-app/create_db.sql:1700-1713`) | Nothing — this is the foundation to build on |
| Settings → Service Providers UI | ✅ Can create a `SYRIA` provider today (`ServiceProvidersManager.tsx`) | New providers hardcode `drawer_name = 'General'` with no picker (`ServiceProviderService.createProvider`) |
| `assertValidProvider` | ✅ Validates against the table, not a literal list (`FinancialServiceRepository.ts:1116-1129`) | Nothing — repository-level provider check is already open |
| **Services page provider list** | ❌ `const PROVIDERS: Provider[] = ["OMT", "WHISH"]` (`Services/index.tsx:182`), `type Provider = "OMT" \| "WHISH"` (`:42`) | A `SYRIA` provider is **unreachable from the UI** |
| **`"OMT" \| "WHISH"` elsewhere** | ❌ Six production sites, not two — `useShopBase.ts:11` (`type BaseSystem`), `SetupContext.tsx:16` (`base_system`), `StepBaseSystem.tsx:6`, `Partners/index.tsx:1409,1713` (ledger filter), plus the two above | **Read §4a before widening any of these** — most must stay closed |
| **FOR-partner RECEIVE** | ❌ Hard-throws for any provider outside the mapped set: `` `FOR-partner is not supported for provider ${data.provider}` `` (`FinancialServiceRepository.ts:2626-2628`) | A FOR-mode Syria RECEIVE throws. Tied to **D1** |
| **RECEIVE payout branch** | ❌ Both payout postings gated on `useSystemDrawerFlow = isOMT \|\| isWHISH` (`FinancialServiceRepository.ts:2878`, `:3799-3803`, `:3827-3831`) | A non-OMT/WHISH RECEIVE **never debits anything** |
| **RECEIVE generic branch** | ❌ `if (!useSystemDrawerFlow)` credits `+receiveAmount` (`:3763-3781`) | Cash moves **the wrong way** — drawer goes UP on a payout |
| IN/OUT badge | `FINANCIAL_SERVICE` + RECEIVE → **out**, unconditionally (`frontend/src/features/audit/cashFlow.ts:73-88`) | Badge would say OUT while the drawer went IN — silent, and it reconciles to nothing |
| `THROUGH_PROVIDER_LEDGER_KEY` | ❌ Closed map; throws for anything unmapped (`FinancialServiceRepository.ts:107-115`) | No `SYRIA` key ⇒ a partner-linked Syria transfer throws |
| `CreateLedgerEntryData.transaction_type` | ⚠️ Closed **TypeScript** union (`PartnerRepository.ts:145-185`) — but the **DB column is `string \| null`** (`:40`) | A TS edit, not a migration. Cheap |
| Custom Services | ❌ `cost`/`price` are all `min(0)` (`validators/customService.ts:12-15`) | Negatives impossible ⇒ **payout cannot be expressed at all** |
| Partner ledger DEBIT/CREDIT | ✅ Both directions exist and settle (`PartnerRepository.ts:535-545`, `Partners/index.tsx:899,910`) | Nothing — reuse wholesale |

### The one-line diagnosis

**Payout capability is keyed on provider _identity_, not on a provider
_capability_.** `isOMT || isWHISH` is asking "which provider is this?" where it
should ask "can this provider pay out?". Every other blocker is downstream of
that one line.

---

## 3. What we reuse (this is most of the plan)

The owner asked for reuse alignment. Almost all of it already exists:

| Need | Reuse | Evidence |
| --- | --- | --- |
| **"Shop pays out, partner owes us"** posting shape | **`ExchangeRepository` FOR-partner** — the canonical implementation. Inflow skipped (`:490`), outflow real regardless of partner mode (`:510-514`), `FOR_EXCHANGE` **DEBIT** (`:618-632`) | `PARTNER_DISBURSEMENT_MATRIX.md:212` calls it "the one place that already implements the owner's rule exactly" |
| Provider taxonomy + CRUD UI | `service_providers` + `ServiceProvidersManager.tsx` — already dual-transport, already tested | `backendApi.serviceProviders.write.dualmode.test.ts` |
| Partner selection, system-filtered | `PartnerSelector` + `ForPartnerToggle` — `systemFilter` already filters on `system_association` | `PartnerSelector.tsx:47` |
| Partner owes ⇄ we owe, and settling either | `partner_ledger` + Settle modal + balance breakdown | `PartnerRepository.ts:535-545,669-670` |
| Commission/profit deferral until the partner settles | `notPartnerPending(...)` in `ProfitRepository` — already defers FOR-partner profit | `ExchangeRepository.ts:612-617` |
| Payment legs, split payouts, change | `partitionLegs` + the shared end-of-transaction OUT loop | `utils/payments.ts`, root `CLAUDE.md` rule 16 |
| Transfer form, fee field, history, void | The whole `financial_services` module | `FinancialServiceRepository.createTransaction` |

**Net new code is small**: one schema column, one capability check replacing one
identity check, four ledger type strings, and a data-driven provider list.

---

## 4. Design — capability flag, not provider identity

Add **one column** to `service_providers`:

```sql
supports_remittance INTEGER NOT NULL DEFAULT 0   -- 1 = offers SEND/RECEIVE with a real payout
```

Then replace the identity gate:

```ts
// before — FinancialServiceRepository.ts:2878
const useSystemDrawerFlow = isOMT || isWHISH;

// after
const useSystemDrawerFlow = isOMT || isWHISH;          // PCD 3-drawer reserve — UNCHANGED
const canPayOut = providerRow.supports_remittance === 1 || useSystemDrawerFlow;
```

**Why two flags and not one.** `useSystemDrawerFlow` means *"routes through the
PCD / a dedicated system drawer"* — OMT and Whish only, and that must not
change. `canPayOut` means *"a RECEIVE hands real cash to the customer"*. OMT and
Whish are both; Syria is only the second. Collapsing them would drag Syria into
PCD routing, which is precisely what the owner ruled out
(`FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md:238-243`: *"7welet syria should not
affect the whish system drawer"*).

The payout postings at `:3799` and `:3827` then gate on `canPayOut`; the
wrong-direction credit at `:3763` gates on `!canPayOut`.

### 4a. Syria is a CORRIDOR, not a base system — do not widen `BaseSystem`

The `"OMT" | "WHISH"` literal appears in six production places, and they mean
**two different things**. Widening the wrong set is the most likely way to break
this app while "following the plan":

| Keep CLOSED — the shop's own primary system | Widen to `string` |
| --- | --- |
| `useShopBase.ts:11` `type BaseSystem` | `Services/index.tsx:42` `type Provider` |
| `SetupContext.tsx:16` `base_system` | `Services/index.tsx:182` `PROVIDERS` |
| `StepBaseSystem.tsx:6` (setup wizard) | `FinancialServiceEntity.provider` (`:119-128`) |
| `useSystemDrawerFlow` (`:2878`) — PCD routing | |
| `Partners/index.tsx:1409,1713` — see note | |

**The shop's base system is OMT or Whish and stays that way.** It selects PCD
routing, the setup wizard's drawer provisioning and the "secondary system"
partner rule. Syria is a *corridor the shop also offers* — it never becomes the
base. `Partners`' ledger filter is a display union; widening it is optional
polish, not part of the payout fix.

**Assumption (unverified):** that the owner does not want Syria as a base
system. It follows from Syria having no system drawer and settling to General,
but it was not put to them. If that is wrong, this plan roughly doubles.

### 4b. ⚠ Phase 3 breaks an invariant you already ruled on once

`Services/index.tsx` hardcodes `partnerMode: "THROUGH"` when building the
payload. That hardcode is **correct only because the provider list is closed**:
the THROUGH-mode selector renders only on the matching tab and filters to
`partner.system_association === systemFilter` (`PartnerSelector.tsx:47`), so a
mismatched partner is unselectable and the mode cannot be wrong.

Three things follow, all verified:

1. **You already cancelled the obvious fix.** A change deriving `partnerMode`
   from `system_association` was scoped, dispatched, and **stopped mid-build and
   reverted by the owner** (`current_sprint.md:669-692`). Its recorded process
   lesson — *"check reachability before building enforcement"* — is why that
   document says Syria belongs in Custom Services.
2. **A guard test pins the invariant, and it uses `"SYRIA"` as its counter-example.**
   `Services.throughPartnerInvariant.test.tsx` asserts a partner with
   `system_association: "SYRIA"` is **never offered** in the THROUGH-mode
   selector (`:23-26`). It was proven failing-first.
3. **Making `SYRIA` a real tab therefore inverts that test's premise.** Under
   this plan a Syria partner on a Syria tab *should* be selectable.

**What to do — not delete it (rule 24).** Rewrite it to assert the invariant
that still holds: a partner is offered on a tab **iff** its
`system_association` matches that tab's provider — which keeps the mismatch
guard (a Syria partner still must not appear on the Whish tab) while allowing
the matching case. Re-prove it failing-first against the pre-fix code. Until
that rewrite lands, `partnerMode: "THROUGH"` stays correct by construction, so
**Phase 3 must not ship without it.**

---

## 5. Phases

### Phase 1 — Schema (migration + `create_db.sql`, rule 10)

1. `ALTER TABLE service_providers ADD COLUMN supports_remittance INTEGER NOT NULL DEFAULT 0`.
2. Backfill `OMT`/`WHISH` to `1` so behaviour is byte-identical on day one.
3. Mirror into `electron-app/create_db.sql` (both the DDL and the 9-row seed).
4. `down()` implemented.

### Phase 2 — Repository: make payout capability-driven

1. Read `supports_remittance` alongside the existing `assertValidProvider`
   lookup (same query — it already fetches the row).
2. Introduce `canPayOut`; re-gate `:3763`, `:3799`, `:3827` per §4.
3. Extend `THROUGH_PROVIDER_LEDGER_KEY` to derive a key from the provider `code`
   for remittance providers instead of throwing on an unmapped one.
4. Add `THROUGH_REMITTANCE_SEND` / `THROUGH_REMITTANCE_RECEIVE` /
   `FOR_REMITTANCE_SEND` / `FOR_REMITTANCE_RECEIVE` to
   `CreateLedgerEntryData.transaction_type` — **generic, not `SYRIA_*`**, so the
   next corridor needs no code.
5. Decide FOR-mode: today `FinancialServiceRepository.ts:2626-2628` **throws**
   for any unmapped provider on a FOR RECEIVE. Either add the remittance arm or
   leave the throw with a clearer message — **D1 decides which**.
6. **Direction assertion**: RECEIVE ⇒ drawer delta negative, partner **DEBIT**.
   SEND ⇒ drawer delta positive, partner **CREDIT**.

⚠ **`partnerLedgerTypes.guard.test.ts` is bidirectional** — verified by reading
it, not assumed. It fails if a `"FOR_…"`/`"THROUGH_…"` literal exists in core
source without a union member, **and** if a union member is never used in
source. Because these four would be template-composed by
`THROUGH_PROVIDER_LEDGER_KEY` rather than written as literals, adding them to
the union alone **fails the guard**. Do what LIRA-126 did for its four: name
each literal in the doc comment above the union (the scanner's plain-text match
counts that as usage), or add an `UNUSED_ALLOWLIST` entry with a reason. Adding
the union members and the wiring in the **same commit** avoids the problem.

⚠ **The trap in step 2.** Re-gating `:3763` changes behaviour for `BOB` and
`OTHER`, which also fail `useSystemDrawerFlow` today. They are unreachable from
the UI (same hardcoded list), so this is **believed dead code** — but that is
`Likely`, not verified. **Query the live DB for `financial_services` rows with
`provider IN ('BOB','OTHER') AND service_type = 'RECEIVE'` before touching that
branch** (Python `sqlite3` on a copy of `~/Documents/LiraTek/liratek.db` — never
the better-sqlite3 probe, per the ABI note in `CLAUDE.md`). If rows exist, leave
`BOB`/`OTHER` on the old branch explicitly.

### Phase 3 — Schema-first contract, then UI (rules 21-24)

1. Lift/extend the Zod schema in `packages/core/src/validators/financial.ts`
   **before** any UI work; derive adapter payload types from it (`z.input<…>`).
   Verify the export resolves from `browser.ts` **and** `index.ts` (rule 29).
2. Services page: replace `PROVIDERS` / `type Provider` with the fetched
   `service_providers` list filtered on `supports_remittance = 1`. Provider
   becomes `string`.
3. Keep the OMT/Whish fee tables and service-type dropdowns gated on their own
   codes — a remittance provider shows amount + fee + partner only.
4. `FinancialServiceEntity.provider` (`:119-128`) widens from a 9-value union to
   `string`. Expect fallout at every `switch` on it — that is the real cost of
   this phase. **Widen only the right-hand column of §4a**; `BaseSystem`,
   `base_system` and the setup wizard stay closed.
5. **Rewrite `Services.throughPartnerInvariant.test.tsx` first — §4b.** Phase 3
   must not ship without it.
6. **One payload shape, no transport branch** (rule 22). Build once, hand to the
   adapter.

### Phase 4 — Reversal symmetry (rule 20)

Every new ledger row needs a named reversal owner **in the same change**. A
Syria RECEIVE writes a drawer debit **and** a partner DEBIT; voiding it must net
both to **0 per currency**. Either extend the generic
`TransactionRepository` void path or gate the type in
`NON_REVERSIBLE_TRANSACTION_TYPES` with a module-owned reversal. Prove
create + void = 0 across drawer and partner ledger, failing-first (rule 17).

### Phase 5 — Dual transport + proof (rule 19)

1. REST route mirroring the IPC handler, same core service, same Zod schema,
   `authenticateJWT` → `requireRole`, IPC-identical envelope.
2. **No `new Date()` / `date('now')` on the request path** for the transfer day
   — client supplies it, server value is fallback only (rule 27).
3. Desktop e2e (`frontend/tests/e2e-electron/lira-*.spec.ts`) **and** web e2e.
   Assert by **identity + deltas**, never row position (rule 15) — a partner-linked
   remittance writes more than one row.
4. Regression tests proven to fail on pre-fix code (rule 17): specifically, a
   RECEIVE on a remittance provider must **fail** before Phase 2 by crediting
   the drawer.

---

## 6. Decisions needed from the owner

| # | Question | Why it blocks |
| --- | --- | --- |
| **D1** | Is the Syria counterparty always a **partner**, or can a Syria transfer be walk-in with no partner at all? | Decides whether the partner ledger is mandatory or optional on this provider |
| **D2** | On a Syria **RECEIVE**, is the commission deducted from the customer's payout, or charged on top / collected separately? | Changes the payout amount and where profit is stamped |
| **D3** | Should Syria profit be **deferred until the partner settles** (like `FOR_EXCHANGE`) or realized immediately? | §3 reuse of `notPartnerPending` depends on it |
| **D4** | Does Syria cash live in **General**, or does it need its own drawer (e.g. `Syria_System`)? | Today new providers hardcode `General`; a dedicated drawer means a drawer picker in the Settings UI |
| **D5** | Is this **one** corridor or the first of several (Turkey, Iraq, …)? | Answer decides `SYRIA_*` vs generic `REMITTANCE_*` naming. §5 assumes generic |
| **D6** | **This plan reverses a position you already recorded.** `current_sprint.md:682` says Syria partners are served through **Custom Services**. This plan moves them into `financial_services`. Still what you want? | If Custom Services stays the home, the whole plan collapses to "let Custom Services express a payout" — a different, smaller change to a `min(0)` constraint, with no §4b invariant to rewrite |

**D5 already has a recommendation**: build it generic. The marginal cost is
zero — `supports_remittance` is a flag on a table the owner can already edit —
and it makes corridor #2 a data-entry task rather than a repeat of this plan.

---

## 7. Interim workaround (available today, no code)

Until Phase 2 ships, book a Syria RECEIVE as:

**Partners → the Syria partner → Add Credit/Debt → "DEBIT (they owe us)" + tick
"Cash moved"** (`Partners/index.tsx:899`, `:929-931`). That produces General
−amount and a partner DEBIT — the correct money.

**What it gets wrong**, and why it is not a substitute: no customer name, no
commission or profit, transaction type is `PARTNER_PAYMENT` rather than a
service, and the row's note reads *"cash OUT of the drawer to the partner"* when
the cash actually went to the customer. It also runs settlement FIFO when
`applyCoverage` is set (`PartnerRepository.ts:427-433`), which can prematurely
realize deferred FOR-partner profit.

SEND has a better interim: **Custom Services → Via Partner**, which is already
money-IN with a partner cost — the shape is right, only the reporting is generic.

---

## 8. Non-goals

- **Not** changing OMT/Whish behaviour. Phase 1's backfill exists so their
  postings stay byte-identical; any diff in an OMT/Whish e2e is a bug in this work.
- **Not** touching PCD routing. `useSystemDrawerFlow` keeps its current meaning.
- **Not** making Custom Services support payouts. The `min(0)` constraint stays;
  remittance belongs in `financial_services`.
- **Not** an FX feature. If Syria transfers need a rate applied, that is
  `ExchangeRepository`'s job and a separate plan.

---

## 9. Confidence

| Claim | Tier |
| --- | --- |
| Every `file:line` in §2, §3, §4a, §4b | **Certain** — each read directly, 2026-09-17 |
| The guard-test mechanics in Phase 2 | **Certain** — `partnerLedgerTypes.guard.test.ts:18-24,45-55` read directly. The first draft of this plan asserted it without opening the file |
| `BOB`/`OTHER` RECEIVE is dead code | **Likely** — unreachable from the UI, but the live DB was not queried. Phase 2 names the check |
| The §4a split (which unions widen, which stay closed) | **Likely** — the six sites were located by grep and read, but their consumers were not each traced |
| D1-D6 are the complete decision set | **Assumption (unverified)** — derived from the code, not from the owner's business process |

**Revision note.** §2's last two rows, §4a, §4b, Phase 2's guard warning and D6
were added 2026-09-17 after a completeness review of the first draft. That draft
cited two hardcode sites (there are six), missed the FOR-RECEIVE throw, missed
the cancelled derivation work and its guard test, and asserted the guard-test
mechanics without reading the file. **The omission that mattered was §4b** — the
first draft would have had someone break a deliberately-guarded invariant the
owner had already ruled on.
