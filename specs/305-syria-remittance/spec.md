# Feature Specification: Syria remittance — send and receive through a partner

**Feature Branch**: `305-syria-remittance` (spec directory only — work happens on `main`, no branch)

**Created**: 2026-10-11

**Status**: Ready for implementation (design phases done; decisions delegated by the owner overnight)

**Ticket**: LIRA-305 (`current_sprint.md`)

**Input**: "Syria remittance — a custom transfer provider that can pay out." A money-transfer corridor with Syria run through the partner "7welet souria", in both directions: SEND (the customer hands the shop cash for a relative in Syria; the shop now owes the partner) and RECEIVE (money sent from Syria; the shop hands the customer cash; the partner now owes the shop). The shop keeps a commission on both. It must work on the desktop app and the web app.

## What already exists (measured 2026-10-11, before writing a word of this spec)

The plan this ticket was opened from (`docs/plans/todo_plans/SYRIA_REMITTANCE_PLAN.md`, written 2026-09-17) proposed a new
"Syria" provider on the OMT/Whish page (its "Route B"). **The owner chose the other route on 2026-09-24 ("Route A", owner
notes #16) and confirmed it "as built — no change" on 2026-09-25.** Both directions were built then, in Custom Services
(the "Services" tile), and have shipped:

| Direction | How the cashier books it today | Cash drawer | Partner account | Commission |
| --- | --- | --- | --- | --- |
| SEND | Services → tick **Via Partner** → pick the partner → Cost = what the partner will deliver, Price = what the customer pays → take payment | General **+price** (any normal payment method) | the shop owes the partner the **cost** | price − cost, counted **the same day** |
| RECEIVE | Services → **Via Partner** → tick **Pay out** → Arrived = what the partner sent, Paid Out = what the customer gets | General **−paid out**, cash only | the partner owes the shop the **arrived** amount | arrived − paid out, counted **when the partner pays** (owner decision D5, 2026-10-06) |

Measured on the real schema and the real writers (temporary probe tests, deleted afterwards; existing suites
`CustomServiceRepository.payout`, `.viaPartner`, `ProfitRepository.viaPartnerCustomServiceDeferral`: 3 suites / 24 tests
pass):

- RECEIVE $100 arrived / $97 paid out: General −97, partner owes +100, profit stamp 3. Void: General 0, partner 0.
  Refund (no return lines): General 0, partner 0, profit 0. Refund with a cash return line of 97: General 0, partner 0.
- RECEIVE in LBP (9,000,000 / 8,700,000): void nets both to 0.
- SEND $100 cost / $103 price, cash: General +103, shop owes partner 100, profit 3. Refund: General 0, partner 0.
- The recipient's name and phone reach the transaction row.
- Both transports: REST `POST /api/custom-services` and IPC `custom-services:add` share one core schema; web spec
  `lira-web-custom-service-payout` and desktop spec `lira-custom-service-payout` (also run in web mode) exist.

### The one real gap (measured)

The RECEIVE commission waits for "the partner to pay". But in a two-way corridor the partner rarely pays it in cash: what
the shop owes the partner for SENDs **cancels** what the partner owes the shop for RECEIVEs. The app only counts a cash
payment from the partner, so the RECEIVE commission is never counted:

| Corridor (USD) | Partner account at the end | RECEIVE commission counted today | Should be |
| --- | --- | --- | --- |
| SEND cost 150 + RECEIVE arrived 100; the shop pays the partner the 50 difference | square (0) | **$0** of $3 | $3 |
| SEND cost 100 + RECEIVE arrived 100; nothing to pay | square (0) | **$0** of $3 | $3 |
| SEND cost 40 + RECEIVE arrived 100; the partner pays the 60 difference | square (0) | **$1.80** of $3 | $3 |

So "commission on both" does not hold today whenever the two directions offset — the normal shape of a corridor. This
ticket fixes that, proves the whole corridor end to end on both apps, and brings the documents up to date.

## Clarifications

### Session 2026-10-11 (decided on the owner's behalf — overnight batch, ground rule G4: the option that moves the least money and is easiest to undo, consistent with earlier owner decisions)

- Q: Build Syria as a provider on the OMT/Whish page (plan Route B) or keep it in Custom Services? → A: **Keep it in
  Custom Services.** The owner decided this three times (2026-08-10 decision log, #16 Route A, 2026-09-25 "as built — no
  change"). Route B is not built. (Y1)
- Q: Is the partner always required? (plan D1) → A: **Yes** — as built; a Pay out without a partner is refused on both
  apps. (Y2)
- Q: Which drawer? (plan D4) → A: **General.** SEND takes any normal payment method into its drawer; RECEIVE pays cash
  out of General only. Syria never touches the OMT or Whish cash drawers. No new drawer. (Y3)
- Q: Currency? → A: USD and LBP, each kept on its own; no conversion; netting (below) only within one currency. (Y4)
- Q: How is the RECEIVE commission charged? (plan D2) → A: **Taken out of the payout** (Arrived − Paid Out), as built. (Y5)
- Q: When is commission counted? (plan D3) → A: SEND: the same day (the customer paid, nothing to wait for). RECEIVE:
  when the partner pays (owner D5, 2026-10-06) — which supersedes the 2026-09-24 note "counted the same day". (Y5)
- Q: Does the shop owing the partner for SENDs count as the partner paying for RECEIVEs? → A: **Yes — netting counts as
  paying.** A RECEIVE's commission counts as the partner's account in that currency stops owing that money, whether
  the partner paid cash or the shop's own debt to the partner cancelled it. Oldest RECEIVE counts first. Nothing is stored
  for this; it is worked out each time Profits is read. (Y6) **Departs from part of owner D5**, which said "same coverage
  rule as For Partner rows" — that rule counts cash only, which would leave the RECEIVE commission uncounted forever in a
  two-way corridor. Y6 keeps "when the partner pays" and adds netting for Pay out rows only; For Partner rows keep the
  cash-only rule (Y7). Flagged for the owner to confirm first.
- Q: Do paper entries on the partner's account (a manual credit with "Cash moved" off, e.g. an opening balance) count as
  the shop owing the partner? → A: **No.** A manual credit entered with "Cash moved" off is left out; everything else on
  the account counts (partner work, settlements, discounts, entries where cash moved, wallet top-ups from the partner,
  and every void of any of these). A paper credit never releases profit; a paper debit still keeps it waiting (the safe
  side). (Y13)
- Q: Should netting also release profit on other partner work (For Partner sales, recharges, …)? → A: **No** — only on
  Custom Services Pay out rows. Everything else stays exactly as today. (Y7)
- Q: One corridor or several? (plan D5) → A: Already generic: any partner, any corridor (Turkey, Iraq, …) uses the same
  form. No code is Syria-specific. (Y8)
- Q: For Partner or Via Partner (THROUGH)? → A: Via Partner. "For Partner" in Custom Services stays what it is (the
  partner uses the shop's service and owes the full price). (Y9)
- Q: Which of the plan's "OMT | WHISH" sites must stay closed? (plan §4a) → A: **All of them** — none is touched: the
  shop's base system, the setup wizard, primary-cash-drawer routing, the OMT/Whish page provider list, the Partners
  filter, and the guarded test `Services.throughPartnerInvariant.test.tsx`. (Y10)
- Q: Reversal? → A: The generic void/refund already reverses the drawer, the partner account and the profit (measured).
  Netting stores nothing, so it has nothing to reverse; voiding a SEND, a RECEIVE or a settlement changes Profits on the
  next read. (Y11)
- Q: Session baskets? → A: A Pay out never joins a customer basket; it posts at once (as built). Keep. (Y12)

## User Scenarios & Testing *(mandatory)*

### User Story 1 — The RECEIVE commission counts when the corridor nets out (Priority: P1)

The owner books Syria SENDs and RECEIVEs through 7welet souria all week, then squares the partner's account (pays the
difference, receives the difference, or nothing is left to pay). The Profits page shows the commission of every SEND and
every RECEIVE.

**Why this priority**: it is the only part of "commission on both" that is wrong today, and it understates the shop's
profit on every netted RECEIVE.

**Independent Test**: book SEND + RECEIVE for one partner, square the account, read the Custom Services profit for the
period — it equals the sum of both commissions.

**Acceptance Scenarios**:

1. **Given** a SEND (cost 150, price 155) and a RECEIVE (arrived 100, paid out 97) for one partner, **When** the shop
   pays the partner the 50 difference, **Then** Custom Services profit is $8 (5 + 3) and the partner account shows 0.
2. **Given** a SEND (cost 100, price 103) and a RECEIVE (arrived 100, paid out 97), **When** nothing is paid, **Then**
   profit is $6 and the partner account shows 0.
3. **Given** a SEND (cost 40, price 42) and a RECEIVE (arrived 100, paid out 97), **When** the partner pays the 60
   difference, **Then** profit is $5; before that payment it is $2 + $1.20 (the 40 of 100 already netted).
4. **Given** a SEND (cost 100) that the shop has already paid the partner in cash, **When** a RECEIVE (arrived 100) is
   then booked, **Then** the RECEIVE commission is **not** counted (the partner really owes 100).
5. **Given** two RECEIVEs and a partial netting, **Then** the older RECEIVE counts first.
6. **Given** a SEND in USD and a RECEIVE in LBP, **Then** they do not net against each other.
7. **Given** a partner with a For Partner row (any module) and no Pay out rows, **Then** its profit timing is unchanged.

---

### User Story 2 — Both directions work end to end on both apps (Priority: P2)

On the web app and on the desktop app the cashier books a SEND and a RECEIVE for the same partner; the drawer, the
partner account and Profits all move by the right amounts; voiding each one puts every figure back.

**Why this priority**: the money paths exist and are unit-tested, but no end-to-end test drives a whole corridor (both
directions + settling + Profits) on either app; the existing Pay out e2e headers still say "NOT RUN".

**Independent Test**: one web e2e spec and one desktop e2e spec, each with a fresh partner, asserting deltas only.

**Acceptance Scenarios**:

1. **Given** a fresh partner, **When** a SEND (cost 100, price 103, cash) is booked, **Then** General +103, partner
   account −100 (shop owes), Custom Services profit +3.
2. **When** a RECEIVE (arrived 100, paid out 97) is then booked, **Then** General −97, partner account back to 0, Custom
   Services profit +3 more (netted).
3. **When** the RECEIVE is voided, **Then** General +97, partner account −100, profit −3; **When** the SEND is voided,
   **Then** every figure is back to its starting value.

---

### User Story 3 — The documents say what the app does (Priority: P3)

Anyone reading the money guides, the posting map or the plans finds Syria described as it is built, and is not sent to
build Route B.

**Independent Test**: the stale plan is archived with a "superseded" banner; FEATURE_GUIDE, COUNTERPARTY_LEDGERS and
POSTING_MAP describe the corridor, the netting rule and its reversal; no doc says a Pay out's commission counts "the same
day".

**Acceptance Scenarios**:

1. **Given** `docs/plans/todo_plans/SYRIA_REMITTANCE_PLAN.md`, **Then** it lives in `docs/plans/done_plans/` with a banner
   naming Route A, #16 and LIRA-305.
2. **Given** `docs/POSTING_MAP.md`'s Via-partner OUT row, **Then** its profit column says "when the partner's account
   covers it (cash or netting)", not "immediate".

### Edge Cases

- A RECEIVE is voided after it was netted: Profits stops counting it on the next read; the SEND it was netted against is
  free to net a later RECEIVE.
- A SEND is voided after netting a RECEIVE: the RECEIVE goes back to waiting (unless the partner then pays).
- A partner settlement is voided: its effect disappears (existing behaviour) and netting is re-worked on the next read.
- The partner overpays (account goes to "shop owes"): every RECEIVE counts in full; nothing counts twice.
- A RECEIVE refunded (not voided) through the Transactions page: same as void (measured: drawer, partner and profit 0).
- Rows from before this change: the rule is read-time, so it applies to old rows at once — a shop with old netted
  RECEIVEs will see their commission appear on Profits for their original day.
- Large ledgers: the read must stay fast for a partner with hundreds of corridor rows (see SC-004).
- A paper credit entry on the partner (opening balance, "Cash moved" off): never releases a RECEIVE's commission (Y13).
- Times saved in two text formats (with and without a "T…Z"): "oldest first" uses the real time, not the text order.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A RECEIVE (Custom Services, Via Partner, Pay out) MUST count its commission in proportion to how much of its
  arrived amount the partner no longer owes, where "no longer owes" includes both cash the partner paid and money the shop
  owes the partner in the same currency. Paper credit entries ("Cash moved" off) MUST NOT count (Y13); every other row,
  and every reversal row, MUST count, so that voiding anything restores the previous figure (FR-007).
- **FR-002**: When the partner's account (same currency, paper credits left out) shows the partner owing the shop an
  amount U > 0, exactly U of the RECEIVE amounts not yet covered by cash MUST stay uncounted, taken from the newest
  RECEIVEs first (the oldest count first, by real time — whatever text format the time was saved in).
- **FR-003**: A cash payment already recorded against a RECEIVE MUST keep counting as before; netting only adds to it and
  never counts the same dollar twice (a RECEIVE never counts more than 100%).
- **FR-004**: Netting MUST NOT change any drawer, any partner balance, any supplier balance, any customer balance, or any
  stored row — it changes only which commission Profits (and the screens built on it: Overview, By Module, By Date,
  By Employee, Top Clients, waiting-for-partner lists, Daily Closing) count, and when.
- **FR-005**: Netting MUST apply only to Custom Services Pay out rows. For Partner rows of every module and all other
  partner rows MUST keep today's timing exactly.
- **FR-006**: Netting MUST be per currency (USD with USD, LBP with LBP).
- **FR-007**: Voiding or refunding any SEND, RECEIVE or partner settlement MUST return every drawer, the partner account
  and Profits to their values before that row was created, per currency.
- **FR-008**: The rule MUST give the same answer on desktop and web (one shared definition in core; no transport code).
- **FR-009**: The SEND and RECEIVE booking behaviour (drawers, partner rows, profit stamps, validation, both transports)
  MUST stay byte-for-byte as built; OMT/Whish behaviour MUST NOT change.
- **FR-010**: The stale Route B plan MUST be archived as superseded, and FEATURE_GUIDE, COUNTERPARTY_LEDGERS, POSTING_MAP,
  the partner matrix plan and the Pay out test headers MUST describe the as-built corridor and the netting rule.
- **FR-011**: A plain-words release note MUST be added (Profits page section).

### Key Entities

- **Corridor partner**: a partner (e.g. 7welet souria) used on Custom Services with Via Partner. No new field.
- **SEND row**: a Via Partner custom service; its partner row says the shop owes the partner the cost.
- **RECEIVE row**: a Via Partner Pay out custom service; its partner row says the partner owes the shop the arrived
  amount. Its commission is held until covered.
- **Partner netting balance (per currency)**: the partner's balance with paper credit entries left out. Equal to the shown partner balance when there are no paper credits. Used only to decide how much of the RECEIVEs
  is still unpaid. Derived on read — no new entity, column or table.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In each of the three netted corridors in the table above, Profits counts 100% of both commissions once the
  partner account is square (today: 0%, 0%, 60% of the RECEIVE commission).
- **SC-002**: A RECEIVE whose arrived amount the partner still owes counts 0% of its commission (no early profit) —
  including after the shop paid the partner for earlier SENDs.
- **SC-003**: Creating then voiding any corridor row leaves General, the partner account and Profits at exactly their
  starting values, in both currencies, on both apps.
- **SC-004**: With 300 SENDs and 300 RECEIVEs on one partner and the account square, the Profits by-module read stays
  under 3 seconds in the core test suite; with 150 more RECEIVEs the partner still owes, under 10 seconds (measured
  1.1 s and 4.2 s on the owner's Mac at design time; the margin is for slower CI machines).
- **SC-005**: Every existing core, backend, electron-handler and frontend test still passes; no OMT/Whish figure changes.

## Assumptions

- Assumption (unverified): the owner's real Syria entries use Custom Services → Via Partner (and Pay out for RECEIVE). The
  2026-08-10 "7welet syria 100$" row was booked For Partner; such rows keep For Partner timing (Y7).
- Assumption (unverified): a corridor partner has little or no other partner work. If it has For Partner rows that the
  partner still owes, they also sit in the partner balance and keep RECEIVEs waiting longer — the safe direction (profit
  later, never earlier).
- Desktop e2e is never run on this Mac (ground rule G5): the desktop twin is written and typechecked but unverified until CI.
- No migration (database stays at v209), no new IPC channel, REST route, preload binding or adapter function: the change
  is one shared read rule in core.
- Out of scope, recorded (research R9): a RECEIVE carrying both USD and LBP gets one blended ratio (older behaviour); only
  the page keeps a Pay out out of a session basket; legacy paper credit entries from before 2026-07 (which have no
  transaction record) are left out of netting, the safe side.
