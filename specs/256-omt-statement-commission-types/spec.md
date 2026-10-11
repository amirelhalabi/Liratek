# Feature Specification: OMT statement commission types

**Feature Branch**: `main` (no branch; ticket LIRA-256, worked on `main` per owner rule)

**Created**: 2026-10-11

**Status**: Draft (design complete; decisions taken on the owner's behalf, see Clarifications)

**Input**: User description: "OMT's balance SMS sometimes covers only some commission types ('INCLUDES INTRA SHARES', sometimes intra plus another type). Let the owner mark which OMT commission types a statement covers, so that (a) the LIRA-255 OMT statement check subtracts only those types' unsettled commission (display only), and (b) settlement in the FIFO queue deducts only those types' commission."

## Clarifications

### Session 2026-10-11 (owner asleep; every answer below was decided by the design agent under ground rule G4: "least money moved, easiest to reverse")

- Q: When a statement covers only some types, what happens at settlement to transfers of the OTHER types? → A: **They stay in the settle queue, unsettled, owed at their full (gross) amount, with their commission still pending.** A settlement that names covered types is refused if it includes a transfer of an uncovered type. They get settled later, when a statement covers their type (or with "All types"). Nothing is settled with a zero commission, so no commission can be silently lost. (Decision S1.)
- Q: Where is the covered-types choice kept? → A: **Nowhere permanent.** It is sent with each statement check and each settlement. The screen remembers the last choice per account on that device only, as a convenience (same as LIRA-255's typed SMS figures). Each settlement also writes the covered types into its own transaction details for the record. No new shop setting and no database change. (Decision S2.)
- Q: What does "no choice made" mean? → A: **All types covered**, i.e. exactly today's behaviour on every screen and both apps. (Decision S3.)
- Q: What about an OMT transfer saved without a type? → A: It appears as its own choice, **"Type not recorded"**, so it can always be covered and never gets stuck. (Decision S4.)
- Q: Do the covered types apply to old-style (pre-cutover) OMT rows at settlement? → A: **No.** Old-style rows already had their commission netted when they were created; the covered types only restrict new-style rows. (Decision S5.) In the statement check an old-style row is subtracted nothing more when its type is included and has its commission added back when it is not (Decision S9, analyze re-check 2026-10-11; supersedes S7's "not changed").
- Q: Should the shop be able to pay OMT's full statement figure while uncovered transfers stay in the queue? → A: **Yes, with the existing "pay more than the selected rows" credit on the OMT account settle sheet** (LIRA-203). No new money path. (Decision S6.)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Check OMT's SMS when it covers only some types (Priority: P1)

The owner receives OMT's balance SMS: "... USD -1,160.99 and LBP 11,584,062. INCLUDES INTRA SHARES". On the OMT account, in the statement check, they tick only "Intra". The "minus unsettled commission" line now counts only Intra transfers' commission, so "what OMT's statement should show" matches OMT's number, and a real gap (a missing or doubled transfer) stands out.

**Why this priority**: It is the daily reconciliation the owner asked for, it books nothing, and it is useful on its own.

**Independent Test**: With one unsettled Intra transfer and one unsettled Western Union transfer, ticking only Intra makes the expected figure equal gross minus the Intra commission only; ticking both (or "All types") gives today's figure.

**Acceptance Scenarios**:

1. **Given** an OMT account with unsettled Intra (commission 0.70) and Western Union (commission 1.20) transfers, **When** the owner ticks only Intra, **Then** the check shows commission 0.70 and expected = gross − 0.70, per currency.
2. **Given** the same account, **When** no type is ticked or "All types" is chosen, **Then** the check shows exactly what it shows today (commission 1.90).
3. **Given** the owner ticked Intra and reloads the page on the same device, **Then** Intra is still ticked; on another device the default "All types" shows.
4. **Given** the check panel, **Then** each type shows how much unsettled commission and how many transfers it holds, so the owner can see what each tick changes.

---

### User Story 2 - Settle only the covered types' transfers (Priority: P2)

When the owner settles the OMT queue after an "INCLUDES INTRA SHARES" statement, they pick "Intra" as covered. The settle screen pre-selects only the Intra transfers (oldest first), shows the uncovered transfers as "waiting: type not in this statement", and the commission the owner types is split only across the settled Intra transfers. The Western Union transfers stay in the queue, still owed at gross, until a later statement covers them.

**Why this priority**: It changes money posting (which rows a commission lands on), so it comes after the display-only check, and it relies on the same type list.

**Independent Test**: Settle a batch with only Intra covered, then void it. The Intra rows settle and un-settle cleanly (ledger, drawer and Profits commission return to zero difference per currency); the Western Union row is never touched and keeps its pending commission. A settlement naming Intra that includes the Western Union row is refused with a clear message on both apps.

**Acceptance Scenarios**:

1. **Given** unsettled Intra and Western Union transfers, **When** the owner settles with only Intra covered and a commission of 1.37, **Then** only the Intra transfers are settled, the whole 1.37 is split across them, and the Western Union transfer stays in the queue at gross.
2. **Given** the same, **When** a settlement naming only Intra includes the Western Union transfer (e.g. sent directly to the server), **Then** it is refused with "Cannot settle transfer #N: its commission type Western Union is not included in this statement" and nothing is booked.
3. **Given** a settlement made with only Intra covered, **When** it is voided, **Then** the supplier balance, cash drawer and Profits commission return to their values before the settlement, per currency, and the Intra transfers return to the queue.
4. **Given** no covered types are sent, **Then** settlement behaves exactly as today (all selected rows settle and share the commission).
5. **Given** the owner wants to pay OMT the full statement figure while Western Union transfers stay queued, **When** they use the OMT account settle sheet's existing "pay more" credit, **Then** the extra is kept as an account credit to apply later (existing behaviour, unchanged).

---

### Edge Cases

- A statement covers no type the queue contains: the settle screen has nothing pre-selected; settling is not possible until the choice changes. The check shows commission 0 and expected = gross.
- All selected transfers are uncovered and a commission is typed: refused (no row to receive the commission); nothing is silently dropped.
- A transfer saved without a type: shown and selectable as "Type not recorded".
- The batch contains old-style (pre-cutover) rows: the covered types do not restrict them at settlement (S5); mixing old-style and new-style rows is already refused today.
- The account settlement also contains OMT App / iPick rows: only OMT counter transfers are restricted by type; other members' rows behave as today.
- A covered-types value that is not one of the eight OMT types or "Type not recorded", or an empty list: refused by validation on both apps.
- A Whish transfer (Whish has no commission types): never restricted.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The OMT statement check MUST let the owner choose which OMT commission types the statement covers, from: Intra, Western Union, Cash to Business, Cash to Government, OMT Wallet, OMT Card, Ogero/Mécanique, Online Brokerage, and "Type not recorded".
- **FR-002**: With a choice made, the check's "unsettled commission" MUST count only OMT counter transfers of the chosen types; rows of other account members MUST be counted as today.
- **FR-003**: With no choice made (or all chosen), the check and every settlement MUST behave exactly as before this feature, on both the desktop and web apps — with one deliberate exception in the check only: old-style transfers are no longer subtracted twice (FR-014, S9).
- **FR-004**: The check MUST show, per type, the unsettled commission (per currency) and the number of transfers, so the owner can see each type's effect.
- **FR-005**: The check MUST stay display-only: it books nothing.
- **FR-006**: A settlement MAY name the covered types. When it does, the system MUST refuse the whole settlement, before booking anything, if any selected new-style OMT counter transfer has a type outside the covered list, and MUST name the offending transfer and its type.
- **FR-007**: The commission entered at a settlement MUST be split only across the transfers actually settled (unchanged split rule: in proportion to what each owed, adding up exactly).
- **FR-008**: Transfers of uncovered types MUST remain unsettled, owed at gross, with their commission still pending, until a later settlement includes them.
- **FR-009**: Both settle screens that can settle OMT transfers (the OMT account settle sheet and the supplier Settle tab) MUST offer the same covered-types choice, let only covered transfers be selected (the account settle sheet pre-selects them oldest first as it does today; the Settle tab keeps starting with nothing selected), and show uncovered ones as waiting.
- **FR-010**: The settle screens MUST pre-fill the covered-types choice from the last choice made for that account on that device (statement check or settle screen), defaulting to "All types".
- **FR-011**: Each settlement that names covered types MUST record them in its own transaction details, so the record shows which statement it followed.
- **FR-012**: Voiding a settlement made with covered types MUST return every ledger, drawer and Profits figure to its prior value per currency, exactly like any other settlement.
- **FR-013**: The covered-types choice MUST work identically on the desktop app and the web app, validated by the same rules on both.
- **FR-014**: Old-style (pre-cutover) OMT rows MUST NOT be restricted by the covered types at settlement. In the check, an old-style row's balance already has its commission taken off (it was booked net), so the check MUST subtract nothing more for it when its type is included, and MUST add its commission back when its type is not included (OMT still shows that transfer at full). Ticking or unticking a type therefore moves the expected figure by exactly that type's commission, for old-style and new-style rows alike. (Decision S9, found by the analyze re-check; supersedes S7.)

### Key Entities

- **OMT commission type**: the existing type recorded on every OMT transfer (eight values, or none). Not new.
- **Covered-types choice**: a list of commission types (plus "Type not recorded") that one OMT statement includes. Sent with a check request or a settlement; never stored as a shop setting.
- **Settlement record**: the existing settlement transaction; gains an informational list of covered types in its details.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a statement that includes only some types, the check's expected figure equals OMT's SMS figure to the cent (USD) / to 1 LBP whenever the app's transfers match OMT's, in a test with at least two types.
- **SC-002**: After settling with only some types covered and then voiding, the difference in supplier balance, cash drawer and Profits commission is 0, per currency.
- **SC-003**: 100% of uncovered-type transfers are still in the settle queue with their pending commission after a covered-types settlement.
- **SC-004**: With no covered types chosen, every existing settlement and statement-check test passes unchanged (no existing test holds an old-style row in the check, so S9 changes none of them). Two pre-existing test edits only: the zeroed-statement `toEqual` gains the two new keys, and the commission-drift guard's exclusion key follows the new column in the SELECT text.
- **SC-005**: The owner can tick the covered types and see the updated expected figure in under 10 seconds, with no extra screens.

## Assumptions

- OMT's statement balance is the running balance of all transfers at gross, minus the commission of the types it says it includes. Commission for other types reaches the shop later, deducted on a later statement. (Basis: owner's LIRA-255 notes and the LIRA-138 closure; not confirmed with OMT.)
- The commission per transfer stored at creation (from OMT's own fee tables) is a good stand-in for what OMT deducts, for the check only (LIRA-255's existing rule). At settlement the owner still types the real figure.
- Profits recognises a new-style transfer's commission only when it is entered at settlement, so keeping uncovered transfers unsettled delays their commission in Profits until they are settled; it never removes it.
- No new shop setting, no database change, no change to Profits queries.
- Desktop end-to-end tests do not run on this Mac; the desktop twin spec is verified by CI only (ground rule G5).
