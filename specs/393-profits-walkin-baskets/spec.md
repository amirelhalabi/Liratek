# Feature Specification: Profits — anonymous baskets count as Walk-in

**Feature Branch**: `393-profits-walkin-baskets`

**Created**: 2026-11-18

**Status**: Draft (owner decision 2026-11-18: build)

**Input**: Owner audit of the Cornertech Profits page (2026-11-16): "Profits › By Client shows Client2, Client10, Client7… as real customers."

## Established facts (verified on Cornertech, 2026-09-01 → 2026-11-16)

- The Sessions page names an unnamed basket automatically: `frontend/src/features/sessions/components/CustomerSessionButton.tsx:267-271` picks the first free `Client${counter}` among today's basket names and calls `startSession({ customer_name: "Client7" })`. The name is stored on the session and copied onto every transaction the basket writes (`transactions.client_name = 'Client7'`, `client_id NULL`, `client_phone NULL`, `session_id` set).
- Profits › By Client (`ProfitRepository.getByClient`, ~line 9451) groups rows without a `client_id` by name, so "Client2" is one By Client row with 40 transactions, "Client5" 32, "Client4" 29 — each one is dozens of unrelated walk-ins who happened to be basket number N on different days. 11 such rows on Cornertech, together $400+ of profit attributed to people who do not exist.
- Every drill-down's counterpart column shows the same name (`ProfitService` builders: `r.client_name || r.client_phone || "Walk-in"`), e.g. "Client4 · SEND" under Katsh.
- The transaction history pages are NOT in scope (they show the basket label on purpose so the cashier can find the basket).

## User Scenarios & Testing *(mandatory)*

### User Story 1 — By Client never lists an auto-named basket (Priority: P1)

A shop owner opens Profits › By Client for any range. Baskets that were never given a real name are part of the "Walk-in" row, never a row of their own.

**Independent Test**: seed two sessions named `Client1` and `Client2` with no client, each with a sale; seed one real client named "Client2" (with a `client_id`) with a sale. By Client shows exactly one "Walk-in" row containing the two anonymous sales and one "Client2" row (the real client) containing only its own sale.

**Acceptance Scenarios**:

1. **Given** transactions with `client_id NULL` and `client_name` matching the auto-name pattern, **When** By Client is computed, **Then** they are summed into the Walk-in row (revenue, profit, counts, pending) and no row carries the auto-name.
2. **Given** a real client whose stored name happens to match the pattern (`clients.id` set on the row), **When** By Client is computed, **Then** that client keeps its own row — the fold applies only to rows with no client id.
3. **Given** the same range, **When** the owner compares By Client's total to Summary, **Then** the total is unchanged by this feature (money moves between rows, never disappears).

### User Story 2 — Drill-down counterpart reads "Walk-in" (Priority: P2)

Every Profits drill-down (By Module › Show transactions, for all modules) shows "Walk-in" as the counterpart for such rows.

**Independent Test**: a basket named `Client3` with a Katsh SEND and a POS sale → both drill-down rows show counterpart "Walk-in".

### Edge Cases

- Name `Client 7` (with a space), `client7`, `Client7b`, `Client` alone: NOT auto-names (the generator writes exactly `Client` + digits, no space). Only `^Client\d+$` folds.
- A basket started as `Client4` and later renamed to a real name: nothing to fold (name no longer matches).
- A basket later linked to a real client (`client_id` set): grouped under that client by id, as today.
- Transactions whose only link is `client_phone` (no id, no name): unchanged.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The auto-name pattern MUST be defined ONCE in `packages/core` (a leaf module reachable from `browser.ts`, rule 29) and used by (a) the Sessions page generator (`CustomerSessionButton.tsx` imports the prefix / builder from `@liratek/core`) and (b) the Profits fold. Two copies of the pattern are the defect (rule 14).
- **FR-002**: `ProfitRepository.getByClient` MUST attribute rows with `client_id IS NULL` and an auto-name to Walk-in, via ONE named SQL fragment (e.g. `isAnonymousSessionName(alias)`), reused anywhere else Profits groups by client name. Grouping by `client_id` for real clients is unchanged.
- **FR-003**: Every `ProfitService` drill-down builder MUST derive the counterpart through ONE helper (`counterpartLabel(name, phone, clientId?)`) that returns "Walk-in" for an auto-name with no client id. Replace every inline `r.client_name || r.client_phone || "Walk-in"` with it.
- **FR-004**: Stored data is NOT rewritten. No migration.
- **FR-005**: Failing-first tests (rule 17): a core test on `getByClient` (real schema via `create_db.sql` + `runMigrations`, as `ProfitService.rechargeDetailLabel.test.ts` does) that fails on today's code with a "Client2" row, and a drill-down counterpart test; a frontend unit test proving the generator produces names the core matcher accepts (and that a renamed name is not matched).

### Key Entities

- **Anonymous session name**: `Client<N>`; a label the shop never typed; carries no identity.

## Success Criteria *(mandatory)*

- **SC-001**: On the Cornertech range above, By Client has no `Client<N>` rows; Walk-in absorbs them; Σ By Client (incl. Walk-in) unchanged.
- **SC-002**: No drill-down row has a counterpart matching `^Client\d+$` unless it is a real client with an id.

## Assumptions / Decisions taken (2026-11-18)

- Fold in reporting only; the Sessions and Transactions pages keep showing the basket label.
- The real-client exception (same name but with `client_id`) is kept even though no such client exists today.

## Open questions for the owner (do not block)

- Should the Sessions page stop storing an auto-name at all (store NULL and render "Basket N" client-side)? Would remove the ambiguity at the source; bigger change, not done here.

## File ownership (parallel build — other agents are editing these files at the same time)

- Yours: new `packages/core/src/constants/anonymousSessionName.ts` (+ export from `index.ts` and `browser.ts`), `ProfitRepository.getByClient` only, the counterpart lines in `ProfitService.ts` builders, `CustomerSessionButton.tsx`, your test files.
- Not yours: sale drill-down query/reason (394), by-module/by-user totals (395), FS/loto/maintenance/custom `detail:` text and KEPT_CHANGE/TOPUP_BUYBACK listing (396). Re-read a shared file immediately before each edit; keep edits surgical; do not run prettier `--write` on `ProfitRepository.ts` / `ProfitService.ts` (run `--check` and report).

## Decisions taken unattended (2026-11-18)

- **Fold at the outermost `GROUP BY` of `getByClient` only.** The inner arms (settlement commission, kept change, pending commission, orphan rows, extra charges) keep matching their source rows on the raw stored name, so each basket's money is computed exactly as before and only the final merge sums them into Walk-in. Wrapping `CLIENT_NAME_KEY` instead would have made `ft.client_name = 'Client2'` stop matching and silently dropped commission/kept change.
- **SQL matcher is GLOB, not LIKE** (`x GLOB 'Client[0-9]*' AND substr(x, 7) NOT GLOB '*[^0-9]*'`): LIKE ignores case and would fold `client7`. The JS regex and the SQL fragment live in the same module and a table-driven test runs both over the same names. `Client07` folds (digits only, as `^Client\d+$` says).
- **Drill-down rows carry no `client_id`**, so `counterpartLabel(name, phone, clientId?)` is called without it and treats an automatic name as anonymous. Plumbing the id through every detail query would mean editing queries owned by 394/396. Consequence: a real client literally named `Client<N>` would read "Walk-in" in drill-downs (none exists today; By Client keeps such a client's own row because it groups by id).
- **Automatic name + phone**: the name counts as absent, so the phone shows (keeps the existing `name || phone || "Walk-in"` order).
- **Story 2 test uses an MTC recharge + a Katsh SEND** instead of a POS sale: the sale drill-down query is being changed by 394 in parallel; the counterpart line for sales goes through the same helper.
- **Existing fixture renamed**: `ProfitRepository.round3.laneLCC.test.ts` ("empty By Client rows are hidden") used `Client1`/`Client2` as basket names; under this feature those fold into Walk-in, which hid what that block guards. Renamed to typed names (`Bob basket`/`Alice basket`); its assertions are unchanged.
- The `CustomerSessionButton` generator moved into core as `nextAnonymousSessionName(todayNames)`; behaviour unchanged (first free number from 1).
