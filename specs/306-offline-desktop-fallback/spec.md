# Feature Specification: Offline desktop fallback — every PC keeps working, events merge back

**Feature Branch**: `306-offline-desktop-fallback` (work on `main`; no branch — owner rule)

**Created**: 2026-10-11 (redesign; replaces the lock-based design committed in `a3698788`)

**Status**: Draft — design only

**Ticket**: LIRA-306 (`current_sprint.md`)

**Input**: Owner, live conversation 2026-10-11 (decisions N1–N9 below), on top of
`docs/plans/todo_plans/OFFLINE_DESKTOP_FALLBACK_PLAN.md` (D1–D5, 2026-09-27). "When the shop's internet or power goes
down, every PC keeps working on its own copy of the shop's data. The web and phones never stop. When the internet comes
back, everything each PC did lands on the web, once, on the day it happened. Real money is always booked; anything
doubtful goes on a list for me."

## Clarifications

### Session 2026-10-11 (owner, live conversation — binding)

- **N1** The web app NEVER locks. Other devices (web, phones, other PCs) keep working online while any PC is offline.
  Replaces old D2.
- **N2** Offline mode allows every cashier action the online app has: POS/sales, customer sessions/baskets,
  OMT/Whish/wallet transfers, recharge, debts/repayments, expenses, exchange, maintenance/repairs, custom services, loto,
  refunds/voids, clients, stock movements. Online-only (refused offline with a clear message): Settings,
  users/permissions, Reset Data, supplier/partner settlement, subscription/licensing, setup.
- **N3** The worst case is the shop network or power going down, so EVERY desktop PC can go offline independently and
  works on its OWN local copy of the shop's online data. While online, each PC keeps a fresh local copy (target every
  ~5 minutes; precedent: today's hourly local backup). Today's desktop can share one database file over a Windows share;
  offline mode must not rely on the shop network being up.
- **N4** Events model: each PC records an event for every write action — the already-validated request (channel +
  shared-schema-parsed payload + acting user + occurred-at instant + the PC's calendar day and time-zone offset + a per-PC
  sequence number + a globally unique event id) — in the same database transaction as the local write. On reconnect the
  PC uploads its queue; the server processes events ordered by time across PCs while ALWAYS preserving each PC's own
  sequence, re-running each through the same core services the website uses, with the event's original time and day.
  Events reference other events, not local row ids. Records created offline get ids from a per-PC far-away range so
  the server can recognise any offline-created id in a payload and rewrite it to the real id assigned on replay (D4).
- **N5** Change detection: a PC with events has changes. Cross-check: compare the PC's working file with its starting
  copy (new rows per key table) and require agreement with the event log; a mismatch is flagged on the review list,
  never silently ignored.
- **N6** Real money is always booked. If stock goes negative after the merge, the sale is booked and flagged "stock
  count was off" (the system's count was wrong; one physical item cannot be sold twice — that case is a duplicate, N7).
- **N7** Duplicates: same event id → skipped silently (a resend). Certain external duplicate (same OMT/Whish reference
  number; same recharge carrier + phone + amount within 10 minutes) → skipped and noted. Likely duplicate (all listed
  fields match within ±5 minutes, ignoring the acting user and the exact second) → held on the review list (Apply /
  Dismiss), never dropped automatically. Fields — every event: type, total + currency, each payment leg (method,
  currency, amount), client id or phone; sale: items (product, quantity, price); transfer: provider, direction, amount,
  fee, sender/receiver phone; recharge: carrier, phone, amount; expense: category, description, amount; repayment:
  client, amount, ticked items; exchange: currencies, amounts, rate. Compared against BOTH online rows created during
  the outage and other PCs' events.
- **N8** Drawer counts / checkpoints taken offline are never applied automatically; they go to the review list.
- **N9** Still valid from the original plan: D1 the web is primary; D3 Google Drive is not in the sync path; D4 row ids
  are assigned only by the database that stores the row. Old D2 (web read-only during an outage) is revoked by N1.

Decisions the agent took within these (O-new-1…) are listed in `docs/plans/OVERNIGHT_DECISIONS_2026-10-11.md` §4 and
referenced below by number. Two need the owner's yes before the device routes are built (plan Complexity Tracking E1–E3, tasks gate G0):
**O-new-7** (whose name goes on replayed work) and **O-new-8** (the PC's own key replaces a sign-in for its uploads).

## Verified facts this design rests on (checked against source 2026-10-11)

- **414 desktop channels**, all registered one by one in `electron-app/handlers/*.ts` (45 files), no central wrapper.
  183 write: 71 cashier actions (offline-allowed under N2), 105 online-only (incl. `voucher:create`, O-new-6), 7 drawer counts/checkpoints; 215 reads; 16
  local-only (sign-in bookkeeping, printing, file dialogs). Full list: `contracts/channel-policy.md`.
- **23 offline/checkpoint channels are not validated by a shared core schema today**: 14 have no validation at all
  (e.g. `closing:create-checkpoint`, `session:close`, the basket writes, `maintenance:update-metadata`) and 9 use a
  schema hand-written in the desktop app (`omt:add-transaction`, `db:add-expense`, `custom-services:add`,
  `clients:create/update`, `debt:add-credit`, `transactions:void/refund`, `loto:update`). N4 requires a shared-schema
  payload, so these are lifted first.
- **Ids are not only in the body**: void/refund/basket channels take ids as positional arguments; a basket checkout
  nests other modules' payloads (`cartItems[].formData`), which is also stored as a JSON string; repayments use
  `{kind, id}` targets.
- **No offline channel reliably carries its original time**: 49 have no time field at all (every refund and void, all
  session/basket writes, clients, stock moves) and the other 29 accept an optional time or day field that is normally
  empty. Without help every replayed row — including the void reversal row, which leaves `created_at` to the column
  default (`TransactionRepository.ts` ~:5388) — would be stamped at replay time.
- **Money conversions read the shop's current exchange rate** (`resolveStampedExchangeRate`, `moneyPosting.ts` ~:193);
  a rate changed online during an outage would otherwise apply to replayed work.
- **Existing refusals that a replay would hit**: an out-of-stock sale is refused unless the shop allows out-of-stock
  sales (`allow_out_of_stock_sales`, off by default); a repayment whose ticked item is no longer open is refused as a
  whole; a second void/refund is refused; a client with an existing phone is refused (unique per shop). Paying more
  than is owed is accepted today.
- **Nothing in the schema stops a duplicate money booking** (no unique keys on sales, transactions, financial services,
  debt ledger; the OMT/Whish reference number is not unique).
- **Receipt numbers are `RCP-<sale id>`**, worked out from the id. Voucher codes are made randomly on the server.
- **1,000,000,000 LBP ≈ $11,200** at the shop rate (89,500) — an ordinary phone sale. An offline id range starting at
  1,000,000,001 would collide with real amounts; the range therefore starts at 10¹².
- **Queries that treat id order as time order** exist (`_clientBalanceBeforeRow`, `TransactionRepository.ts` ~:3381 —
  deliberately, because `created_at` is second-granular and ties inside one checkout; carrier-line movement queries
  `CarrierLineMovementRepository.ts` ~:170/:193). With N1, replayed rows get ids above online rows written during the
  outage although they happened earlier (O-new-19).
- **Last migration is v209**; this feature adds **v210**. Production still runs one shared database file (hosting Phase
  D not done); nothing here depends on Phase D.
- **Desktop sign-in works offline** against the local users table (password hash); Google-only users cannot sign in
  offline.

## User Scenarios & Testing *(mandatory)*

Stories are in build order. US1–US3 are buildable and testable on this Mac (server, core, web app, web e2e through the
device API). US4–US5 are desktop code with unit tests; their on-screen behaviour is **unverified** until CI or the
owner's Windows PC (no Electron on this Mac). US6 is owner-run.

### User Story 1 — Offline work lands on the web once, on its own day, through the web's own rules (Priority: P1)

A PC that worked offline sends its events. The server books each one through the same service the web app uses
(stock, drawers, ledgers, profit), as the person who did it, at the time and on the day it happened, numbers every new
row itself, and rewrites any reference to a row created offline to the row it just created. Sending the same events
again changes nothing.

**Why this priority**: it is the money path; everything else feeds it or reports on it.

**Independent Test**: with a paired device key, upload a recorded outage — a new customer, a sale to that customer on
account, a repayment ticking that sale, a refund of an earlier online sale — stamped "yesterday 23:50 Beirut". Confirm
each is booked once, on yesterday, with the right customer and sale links, and that drawers, debt, stock and profit
moved exactly as the same actions made on the web would move them (per currency). Re-upload: nothing changes.

**Acceptance Scenarios**:

1. **Given** a batch of events from a paired PC, **When** the server processes it, **Then** each event is booked through
   the same core service the web uses, in that PC's own order, as the recorded user.
2. **Given** an event already processed, **When** the same event id arrives again (minutes or days later), **Then**
   nothing is booked and the stored outcome is returned.
3. **Given** an event recorded at 23:50 on day N, **When** it is processed on day N+1, **Then** the row, its transaction,
   its payment lines and its profit belong to day N.
4. **Given** event B refers to a customer, sale, session or transaction created offline by event A on the same PC,
   **When** B is processed, **Then** the reference points at the row the server created for A.
5. **Given** an event the server cannot book for a business reason (for example a second refund of the same sale),
   **When** it is processed, **Then** the reason is stored, the event appears on the review list, later events of the
   same PC continue, and later events that depend on it are held.
6. **Given** a whole outage replayed, **Then** drawer, ledger, stock and profit totals per currency equal the same
   actions done online.

---

### User Story 2 — Several PCs offline at once, merged in time order; duplicates caught (Priority: P1)

The shop's network dies; PC A and PC B both work offline on their own copies while the owner keeps selling from the
web app and phone. When the internet returns, the server merges A's and B's events by time (never reordering either
PC's own events), books real money every time, and catches duplicates: a resend is skipped, a certain duplicate
(same OMT/Whish reference, same recharge within 10 minutes) is skipped and noted, a likely duplicate is held for the
owner.

**Why this priority**: N3 makes several offline PCs the normal worst case; duplicates are where money is double-booked.

**Independent Test**: upload interleaved events from two device keys plus online rows created through the web routes
during the "outage"; check processing order, a held likely duplicate, a skipped certain duplicate with its note, a
sale that drives stock negative booked and flagged, and a drawer count held.

**Acceptance Scenarios**:

1. **Given** events from two PCs, **When** both have arrived, **Then** they are processed earliest-first by
   clock-corrected time, and each PC's own events stay in that PC's order even if its clock jumped backwards.
2. **Given** PC B has not reconnected, **When** PC A's events arrive, **Then** A's events are processed without waiting
   for B; B's events, when they arrive later, are booked at their own original times.
3. **Given** an OMT/Whish event whose reference number matches a transfer already booked (online or by another PC),
   **When** processed, **Then** it is skipped and a note appears on the review list; any later event of that PC that
   refers to it waits until the owner resolves the note (Mark reviewed links it to the existing transfer; Book anyway
   books it).
4. **Given** a recharge event with the same carrier, phone and amount as a recharge booked within 10 minutes of it,
   **Then** it is skipped and noted.
5. **Given** an event whose listed fields all match a row created during the outage (online or by another PC) within
   ±5 minutes, ignoring user and seconds, **Then** it is held on the review list with the matching row shown; nothing
   is booked until the owner presses Apply; Dismiss books nothing.
6. **Given** a sale whose items are no longer in stock on the server, **Then** the sale is booked and flagged "stock
   count was off".
7. **Given** a drawer count, opening/closing checkpoint, loto checkpoint or carrier-line balance reading recorded
   offline, **Then** it is never applied automatically; it is held on the review list.

---

### User Story 3 — The owner reviews offline work on the web app (Priority: P1)

The web app shows admins an "Offline work to review" page: held items (possible duplicates, held checkpoints, items
waiting on a held item), refused items with the reason, and notes on booked items (stock count was off, certain
duplicate skipped, PC clock corrected, customer already existed, ticked items already paid, a closed day changed, a
PC's data did not match its events, came out differently online, made by a user since switched off, exchange rate
changed during the outage). Each item can be applied, dismissed or marked reviewed. Settings shows each paired
PC: name, last seen, waiting events, and a revoke button.

**Why this priority**: N6–N8 send decisions to the owner; without the page they would be invisible.

**Independent Test**: web e2e: seed review items through the device API, open the page as admin, apply one (booked once,
row appears in Transactions), dismiss one (nothing booked, who/when recorded), mark a note reviewed; staff cannot open
the page.

**Acceptance Scenarios**:

1. **Given** held, refused and noted items, **When** an admin opens the page, **Then** each shows what, when, which PC,
   who, amounts and the reason in plain words, grouped by kind.
2. **Given** a held item, **When** the admin presses Apply, **Then** it is booked once through the same path and its
   waiting dependants are processed in their original order.
3. **Given** a held or refused item, **When** the admin presses Dismiss, **Then** nothing is booked and who/when is
   recorded; dependants stay held with the reason "depends on a dismissed item", unless they can be linked to the
   matching existing row (duplicates).
4. **Given** a note on a booked item, **When** the admin presses Mark reviewed, **Then** it leaves the open list and stays
   in history.
5. **Given** a certain duplicate that was skipped, **When** the admin decides it was a real second transfer, **Then**
   "Book anyway" books it once (O-new-5).
6. **Given** a staff user, **Then** the page and its actions are refused.

---

### User Story 4 — Every PC keeps a fresh copy and shows whether it is ready (Priority: P2)

Each paired PC refreshes its copy of the shop's data about every 5 minutes while online and shows a standby screen:
"This computer can keep working if the internet goes down. Copy updated 3 minutes ago — ready." with a button that
opens the web app in the browser. A PC whose app version does not match the server's data version says "Update this
app to be ready". A desktop that was never paired works exactly as today.

**Why this priority**: without a recent copy there is nothing to work offline on. The server half is testable tonight;
the screen is desktop-only.

**Independent Test**: request a copy with a device key from a server holding two shops; it holds only the requesting
shop's rows, no sign-in secrets other than password hashes, its real shop id, the high-water mark of every table, and
passes an integrity check. Desktop state logic unit-tested.

**Acceptance Scenarios**:

1. **Given** a paired PC online, **When** 5 minutes pass, **Then** it downloads a fresh copy and the "updated" age resets.
2. **Given** several shops on the server, **When** shop A's PC asks for a copy, **Then** the copy holds no row of another
   shop and no session, token, device key, licence key or API key.
3. **Given** the PC's app data version differs from the copy's, **Then** the standby screen says it is not ready and
   offline mode cannot start.
4. **Given** a desktop that was never paired, **Then** nothing changes.

---

### User Story 5 — The cashier keeps working on a PC during an outage, then goes back to the web (Priority: P2)

The internet drops. After 30 seconds without the server, the PC offers "Work offline". The cashier signs in with their
usual username and password and can do every cashier action (N2); online-only actions say "Not available while offline —
do this on the web app when the internet is back". A banner shows "Working offline — 12 actions waiting to send".
When the internet is back, waiting actions start sending by themselves and the banner offers "Back to the web app";
pressing it finishes sending, runs the cross-check (N5) and returns the PC to standby with a fresh copy.

**Why this priority**: the user-facing payoff; desktop-visible behaviour is verified only on CI / the owner's PC.

**Independent Test**: desktop unit/integration tests: an allowed action writes to the working copy and records its
event in the same transaction (both or neither); an online-only action is refused and writes nothing; an offline row
gets an id in the PC's range; a crash mid-action leaves both or neither; sending marks each event from the server's
answer; the cross-check reports an unrecorded write.

**Acceptance Scenarios**:

1. **Given** the server has been unreachable for 30 seconds and the copy is ready, **When** the cashier presses Work
   offline, **Then** a working copy is made from the latest copy and the PC opens on the sign-in screen.
2. **Given** offline mode, **When** the cashier completes any offline-allowed action, **Then** the change and its event
   are saved together.
3. **Given** offline mode, **When** the cashier tries an online-only action, **Then** it is refused with the offline
   message and nothing changes.
4. **Given** offline mode, **When** the cashier refunds a sale made offline earlier that day, **Then** it works locally,
   and on replay the refund lands on the server's copy of that sale.
5. **Given** the internet is back, **Then** events upload in the background; new offline actions are still allowed (no
   sale is lost mid-way) and the banner asks the cashier to go back to the web app.
6. **Given** sending is interrupted, **When** it resumes, **Then** nothing already booked is booked again.
7. **Given** an offline sale's receipt is printed, **Then** its number `RCP-<offline id>` still finds the sale on the web
   after replay (warranty lookup and reprint) (O-new-10).

---

### User Story 6 — Production switch-on (owner-run, blocked on infrastructure) (Priority: P3)

The owner deploys, ships a desktop release, pairs two PCs at the test shop, runs an outage drill (pull the network on
both, sell on both and on the phone, reconnect one then the other, review the list), then CornerTech. Optionally later:
a faster copy feed through Litestream, and hosting Phase D.

**Why this priority**: needs Fly, a desktop release and the owner's machines (G5).

**Independent Test**: the runbook's own checks in `docs/OPERATIONS.md`.

**Acceptance Scenarios**:

1. **Given** the drill, **Then** the web app shows each PC's work on the right day, once; duplicates and the drawer
   counts are on the review list; nothing else is.

---

### Edge Cases

- **Power cut**: PCs die without warning → nothing locks (N1). When they come back on without internet, the cashier
  presses Work offline on the copy they already have. A PC that loses power **during** offline mode reopens the same
  working copy with its waiting events on restart — never a fresh one (FR-008a).
- **Only some PCs reconnect**: the server processes what arrived; Settings shows the other PCs as "last seen …, N
  actions not yet sent" (from their last check-in).
- **PC clock wrong**: the server measures each PC's clock offset at every check-in and upload and corrects event times
  by it when it is more than 2 minutes; a corrected time can never be in the server's future and never more than 5
  minutes before the copy the PC was working on was built; the item carries a "PC clock corrected" note, and any clamped
  event always carries a note. Events of one PC whose times run backwards are noted too.
- **Clock changed during the outage** (the two measured offsets differ by more than 2 minutes): the upload-time offset
  is used and the note says so.
- **Debt already paid online**: a repayment that ticked an item someone paid online is booked oldest-first without the
  ticks (any extra becomes credit, as today) and noted (O-new-3).
- **Customer created offline whose phone was created online meanwhile (or by another PC)**: the offline customer is
  linked to the existing one; later events use it; noted (O-new-4).
- **Refund or void of something already reversed online**: cannot be booked; on the review list with "already refunded
  online — check the drawer".
- **Basket checked out offline but closed online**: refused by today's rule → review list.
- **Edits of the same record online and offline** (notes, statuses, client name): applied in processing order; the
  later-processed one wins (O-new-12).
- **A day already closed online receives late offline work**: booked; a "closed day changed" note names the day.
- **App version differences**: a PC newer than the server cannot upload until the server is updated (events stay on the
  PC); an event recorded by an older app that today's rules can no longer read is refused to the review list.
- **Device key revoked or lost while holding events**: the upload is refused; an admin re-pairs the PC, which gives the
  same PC number a new key (same queue position); the events keep their ids, so nothing is double-booked (FR-001a).
- **Internet drops again while finishing**: the PC goes back to offline mode on the same working copy.
- **The fresh copy after finishing failed to download**: the PC is not ready for the next outage until a copy newer than
  its last finished work has been processed on the server (so a debt it collected and the server booked is never shown
  as open again). A repayment still held for review is not yet booked; the standby screen lists such held items so the
  cashier does not collect them twice.
- **A PC copy edited by hand**: nothing reaches the server except events, which the server re-validates; the cross-check
  flags rows that no event explains.
- **A read screen that quietly writes** (lazy seeding) in offline mode: refused by the offline write guard and fixed per
  screen (sweep task); if it slips through, the cross-check flags it.
- **Google-only users** cannot sign in on an offline PC (no password); known limitation.

## Requirements *(mandatory)*

### Functional Requirements

**Pairing and device identity**

- **FR-001**: An admin MUST be able to pair any number of desktop PCs to the shop by signing in on each PC with the shop
  name and their admin username and password; the server returns a device key kept only on that PC (the server keeps a
  one-way hash) and assigns the PC a **PC number** unique within the shop and never reused, even after revoke.
- **FR-001a**: Re-pairing a PC that already has a PC number (its key lost or revoked) MUST issue a new key for the SAME
  device row — same PC number, same expected sequence — so its waiting events and offline ids stay valid; the old key
  stops working. Re-keying is allowed only with the PC's own saved identity, or for a revoked PC whose waiting count was
  zero at its last check-in AND the admin confirms that PC will never send again (never to give a second machine a
  number that is in use).
- **FR-002**: An admin MUST be able to see every paired PC (name, number, paired on, last seen, state, waiting events,
  app version) and revoke one from Settings on the web app.
- **FR-003**: Every PC-to-server call of this feature MUST authenticate with the device key; a revoked or unknown key is
  refused; the key identifies its shop without trusting anything else in the request (O-new-8, owner to confirm).
- **FR-004**: While online, each paired PC MUST check in about every 30 seconds with its state, waiting-event count, app
  and data versions and its own clock reading (used for clock correction, FR-022); check-ins never lock anything (N1).

**Copy of the shop's data**

- **FR-005**: The server MUST provide each paired PC with a copy of only its own shop's data at most every 5 minutes,
  built from the live database with the same narrowing used by the hosting split, with sessions, tokens, codes, device
  keys, stored replies, invitations, API keys and the licence key removed (password hashes kept for offline sign-in), and
  with the **high-water mark** (largest id) of every table recorded in the copy and on the server.
- **FR-006**: A paired PC MUST keep its copies in its own local app folder (never on a network share), keep the newest 2,
  and never change a downloaded copy.
- **FR-007**: A PC MUST refuse to start offline mode when its app's data version differs from the copy's or from the
  server's last reported version.

**Offline mode on a PC**

- **FR-008**: Offline mode MUST be startable on a paired PC when the server has been unreachable for at least 30 seconds
  and a ready copy exists; it opens a fresh **working copy** of the newest copy. "Ready" also requires the copy to be
  built after every event of the PC's last offline period left the server's "received" state. A copy older than 24 hours
  is still usable, with a warning on the standby screen.
- **FR-008a**: If a working copy exists at start-up (power cut, crash), the PC MUST reopen it in offline mode — never
  overwrite it — and continue its sequence (FR-011 rule). The next offline id per table MUST be
  the highest of: the PC's saved counters, the working and finished copies, and the server's maximum for that PC and
  table (reported at check-in).
- **FR-009**: Every desktop channel MUST be classified exactly once as offline-allowed, online-only, checkpoint, read or
  local (`contracts/channel-policy.md`); in offline mode an online-only channel MUST refuse with "Not available while
  offline — do this on the web app when the internet is back" and write nothing; an unclassified channel MUST be refused
  (fail closed).
- **FR-010**: In offline mode each offline-allowed or checkpoint action MUST be written to the working copy and recorded
  as an event in the same transaction; if the action fails, neither is kept.
- **FR-011**: An event MUST carry: a globally unique event id; the PC's sequence number (gap-free per PC, never reused);
  the channel; the payload as parsed by the shared core schema of that channel (named arguments, not positions); the
  acting user; the instant (UTC); the PC's calendar day and time-zone offset at that instant; the copy it was made on;
  the app and data versions and a description of the channel's schema shape (keys, types, optional, defaults); the exchange rates in force on the PC at that
  moment; the ids of rows the action created, per table; and the ids of earlier events it depends on. The sequence number
  is taken inside the same transaction as the write: one more than the highest of the outbox's sequences, the PC's saved
  last sequence and the server's last sequence for that PC (so a second outage on a fresh copy continues, never restarts).
- **FR-012**: Rows created in a working copy MUST get ids in the PC's range: `PC number × 10¹² + table index × 10⁹ + n`
  (table index from one fixed append-only list of tables; `n` continues from the PC's last used value for that table, so
  a PC never reuses an id). Every table that offline actions can write MUST be covered.
- **FR-013**: In offline mode stock MUST be treated as a count that may be wrong: a sale of an item the copy shows as out
  of stock is allowed, with a warning on screen (N6, O-new-2).
- **FR-014**: The offline PC MUST refuse at record time an action whose payload carries an offline-range id in a position
  the server will not rewrite (FR-019), so no unrewritable reference is ever sent. A number written as text in an id
  position counts as an id.

**Upload and processing**

- **FR-015**: A PC MUST upload waiting events automatically whenever the server is reachable, in sequence order, in
  batches; the server MUST store each event once (by event id) and acknowledge it before processing. An event the server
  cannot accept for its content (unknown or non-recordable channel) MUST still be stored, as refused with the reason, so
  the PC's sequence stays gap-free and the item reaches the review list; identity conflicts (`EVENT_ID_REUSED`,
  `SEQ_CONFLICT`) stop that PC's queue and show on the PCs panel.
- **FR-016**: The server MUST refuse a whole upload from a PC whose data version is newer than the server's (the events
  stay on the PC) and MUST accept events from older versions. An event is compatible when every key of its channel schema
  exists unchanged in the server's, and every key only the server has is optional with no default (Zod would otherwise
  fill it silently); an incompatible or unparsable event is refused to the review list with its full content shown so
  the owner can re-enter it (Dismiss only — Apply is not offered). Parsing a payload twice MUST equal parsing it once for
  every recorded schema. Operations rule: no deploy that changes an offline channel's schema while the PCs panel shows
  waiting events.
- **FR-017**: The server MUST process stored events per shop in rounds: among the events that have arrived, the earliest
  next event of each PC by corrected time is processed first; a PC's events are never processed out of its sequence; a
  gap in a PC's sequence stops that PC's queue until the missing event arrives; the server does not wait for PCs that
  have not reconnected. A short gathering pause (default 30 s, configurable) lets PCs that reconnect together interleave.
- **FR-018**: Each event MUST be processed in one database transaction that books it through the same core service the
  web app uses (via a per-channel binding), stores its outcome, stores its id-map rows and its review items — all or
  nothing; a technical failure leaves the event waiting for the next round; a business refusal is stored as an outcome.
  The event's transaction MUST never yield to the event loop between its start and its commit, and any database
  statement issued from outside the replay while its transaction is open MUST be refused (`REPLAY_IN_PROGRESS`, a visible
  error; the user saves again) — so no web or phone write can ever join, or be silently undone with, a replayed event; sequence conflicts (same PC and sequence number, different event id) are refused per
  event and shown on the PCs panel.
- **FR-019**: Before booking, the server MUST rewrite every offline-range id in the event's id positions — id-named keys
  (`id`, `*_id`, `*Id`), declared polymorphic pairs (`{kind, id}`, `referenceTable`+`referenceId`) and declared nested
  payloads (basket `cartItems[].formData`, including JSON-string copies) — to the server id from the shop's id map. Values
  outside id positions are never touched; a number written as text in an id position is treated as an id. An
  offline-range id with no map entry MUST hold the event ("refers to an offline item that was not booked").
- **FR-020**: After booking, the server MUST map the rows the PC created to the rows the server created, per table, in
  creation order; where the counts per table differ, those rows MUST stay unmapped and the event MUST carry a "came out
  differently online" note; the audit log, activity log and sign-in `sessions` tables are excluded from the comparison
  (customer baskets — `customer_sessions`, `customer_session_transactions`, `session_cart_items` — are mapped). When ticks were dropped
  (FR-029) or a customer was linked (FR-030), only the event's main row is mapped; the out-of-stock path (FR-028) does
  not change row shapes and maps fully when counts agree. A reference to an unmapped row of a booked event is held with
  the reason "booked, but this part could not be linked".
- **FR-021**: The server MUST book with the event's own time: the request day and time-zone offset of the event, and an
  "effective now" equal to the event's (corrected) instant, written in the same text format the database uses today, for
  every timestamp the services write, including payment
  lines and every row whose insert relies on a column default; a time the user typed in the payload (backdating) still
  wins. This applies to every offline and checkpoint channel, not only those without a time field.
- **FR-021a**: The server MUST convert and stamp money with the exchange rates recorded in the event, not the rates in
  force at replay, through one rate getter that every money path uses; a recorded rate that differs from the server's
  current rate at processing adds a "rate changed during the outage" note (rates keep no history). Other money settings (fee tables, commissions) use the server's current values (known limitation).
- **FR-022**: The server MUST correct an event's instant by the PC's measured clock offset when that offset exceeds 2
  minutes, clamp the result to no later than receipt and no earlier than 5 minutes before the copy was built, recompute
  the day from the corrected instant, and note the correction; every clamped event and every event whose time runs
  backwards against the previous event of the same PC MUST carry a note.
- **FR-023**: The actor MUST be the event's recorded user; the server MUST check that user belongs to the shop and holds a
  role the channel allows; a user switched off since is still booked, with a note (money moved, O-new-7); an unknown user or a
  role not allowed refuses the event to the review list (O-new-7, owner to confirm).

**Duplicates and state that changed meanwhile**

- **FR-024**: Same event id → the stored outcome is returned and nothing is booked.
- **FR-025**: The server MUST compute one duplicate fingerprint per money event from the rows the booking produced (inside
  a savepoint) with the N7 fields, and compare it with the fingerprints of rows created during this PC's outage by anyone
  other than this PC — rows above the high-water mark of the copy the event was made on, excluding every server row this
  PC's booked or applied events created (from their stored results, mapped or not); the ±5-minute window is applied after clock
  correction.
- **FR-026**: Certain duplicate (same non-empty OMT/Whish reference number; same recharge carrier + phone + amount
  within 10 minutes) → the savepoint is rolled back, the event is recorded as skipped and a note is added (Mark reviewed
  / Book anyway). Events that depend on it are held until the note is resolved: Mark reviewed maps the event's MAIN row
  to the matching existing row (child rows such as sale items or payment lines stay unmapped, because an independently
  typed row can list them in a different order) and releases them; Book anyway books it, maps to the new rows and
  releases them. A later reference to an unmapped child row is held "booked, but this part could not be linked".
- **FR-027**: Likely duplicate (every N7 field equal within ±5 minutes, ignoring user and seconds) → rolled back and held
  on the review list showing the matching row; Apply books it; Dismiss books nothing and maps only the event's main row
  to the matching row (as FR-026).
- **FR-028**: Stock that goes negative because of a replayed sale or stock use MUST be booked (replay uses the
  out-of-stock path regardless of the shop setting, never changing web behaviour) and flagged "stock count was off" per
  product.
- **FR-029**: A repayment whose ticked items are no longer open MUST be booked oldest-first without the ticks (existing
  overpayment rules apply) and noted (O-new-3).
- **FR-030**: An offline-created customer whose phone already exists in the shop MUST be linked to the existing customer
  (map entry to it) and noted, instead of refused (O-new-4).
- **FR-031**: Any other business refusal (already voided/refunded, basket already closed, over-refund…) MUST go to the
  review list with the service's reason; dependants are held.
- **FR-032**: Checkpoint-class events (drawer counts, opening/closing checkpoints, loto checkpoints, carrier-line balance
  readings) MUST never be booked automatically; they are held with Apply / Dismiss (N8). Apply recomputes any expected
  amount on the server at the event's time (the PC's figure missed online and other PCs' sales) and shows both figures
  before the admin confirms.
- **FR-033**: A booked event whose day already has a completed closing or checkpoint after its time MUST carry a "closed
  day changed" note naming the day.
- **FR-034**: Events that depend on a held, refused, dismissed or skipped (unresolved) event MUST be held with the reason;
  when the item they wait on is resolved, they are processed in their original order automatically (O-new-20). A waiting
  item cannot be applied on its own while the item it waits on is open.

**Change detection (N5)**

- **FR-035**: When the cashier presses "Back to the web app", the PC MUST send a manifest: per key table, the rows in the
  working copy with ids in its range; the server MUST flag any row present in the working copy that no received event
  says it created (rows created and later deleted offline are not a mismatch), as a "PC data does not match its events"
  review item listing the tables and ids.
- **FR-036**: The PC MUST also check, in offline mode, that read screens wrote nothing (total change count unchanged around
  each read, measured only while no write is in progress — reads wait while a write is being recorded); any such write
  is logged and included in the manifest.

**Review list**

- **FR-037**: The web app MUST offer admins an "Offline work to review" page with open items grouped by kind (possible
  duplicate, held checkpoint, waiting on another item, refused, notes) and actions Apply, Dismiss, Mark reviewed, Book
  anyway (certain duplicate), each recorded with who and when, each idempotent; plus a history of every processed event
  with the server row it became. Apply bypasses only the reason the item was held (a held duplicate skips the duplicate
  check; a refused item is re-run with every check; version refusals offer no Apply).
- **FR-038**: Every review route MUST be admin-only and return the shared `{ success, data?, error? }` envelope.

**Return to the web and receipts**

- **FR-039**: "Back to the web app" MUST be offered once the server is reachable; it stops new offline actions, finishes
  the upload, sends the manifest, keeps the working copy as a finished file (the newest 3 kept) and returns the PC to
  standby. If the server becomes unreachable for 30 seconds while finishing, the PC returns to offline mode on the same
  working copy.
- **FR-040**: A receipt number `RCP-<offline id>` printed offline MUST resolve on the web (web only — a later offline copy
  does not carry the alias list) to the server sale it became
  (reprint, warranty lookup).
- **FR-041**: Vouchers and product-catalog changes (create/edit/delete product, categories, product suppliers) MUST be
  online-only in this release (O-new-6, O-new-9).

**Correctness of time-ordered reads**

- **FR-042**: Running-balance and movement queries that order by id MUST keep today's online results unchanged (pinned by
  tests). Replayed rows appear in them in the order they were booked on the server, not the order they happened; this is
  a documented limitation (O-new-19), stated in the release note.

**Release**

- **FR-043**: The release note MUST tell shop owners that offline mode exists on the desktop app, that the review list
  exists on the web app, that totals for past days (sales, profit, closing) can change when a PC sends work late, and
  that in a customer's running balance offline work appears where it was sent.

### Key Entities

- **Paired PC (device)**: a desktop registered to a shop: PC number, name, key hash, paired by/at, revoked, last seen,
  state, waiting count, versions, clock offset measurements.
- **Copy (snapshot)**: one copy given to a PC: id, created at, data version, per-table high-water marks.
- **Event**: one recorded action (FR-011) and, on the server, its processing outcome (received, booked, skipped,
  held, refused, applied, dismissed) and result.
- **Id map entry**: shop + offline id → table, server id, creating event.
- **Review item**: kind (possible duplicate, certain duplicate note, stock count off, held checkpoint, waiting, refused,
  clock corrected, customer linked, ticks dropped, closed day changed, PC data mismatch, came out differently, user
  switched off, rate changed during the outage), the event, details, state (open, applied, dismissed, reviewed), resolver and time.
- **Outbox (on the PC)**: the PC's waiting events and their delivery state, inside the working copy.

## Success Criteria *(mandatory)*

- **SC-001**: For a recorded outage covering every offline channel family (sales, baskets, transfers, recharge, debts,
  expenses, exchange, repairs, custom services, loto, refunds/voids, clients, stock), replay and the same actions done
  online produce equal drawer balances, ledger sums, stock and profit per currency (automated test).
- **SC-002**: Re-sending any batch any number of times changes no total (automated test).
- **SC-003**: Every offline-created reference in a recorded outage lands on the matching server row; zero events are
  booked against a wrong row (automated test over the id-position guard and a full scenario).
- **SC-004**: Every N7 duplicate case is classified as specified, and no likely duplicate is booked without an admin
  Apply (automated tests + web e2e).
- **SC-005**: An event of every offline family recorded at 23:50 on day N appears on day N in its rows, transactions,
  payment lines and profit (automated test).
- **SC-006**: Zero desktop channels are unclassified (guard test fails on a new one).
- **SC-007**: A shop with no paired PC sees no behaviour change; web and phone writes are never refused because of this
  feature (web e2e regression).
- **SC-008**: In the owner's drill with two PCs, the shop can sell on both PCs within 1 minute of losing the internet and
  all their work is on the web within 2 minutes of reconnecting (owner-run measurement).

## Assumptions

- Assumption (unverified): building a copy takes well under a second at today's size (measured by a task).
- Assumption (unverified): the replayed services produce the same number of rows per table as on the PC for the same
  payload and code version in normal cases; differences are caught (FR-020), not prevented.
- Assumption (unverified): no offline-allowed service sends a message to the outside world (WhatsApp, SMS) as part of
  its write; a task checks and suppresses any during replay.
- The desktop app and server run the same code version during an outage in the normal case; a desktop release ships
  with every database change (operations rule).
- Phones and the web app are unchanged except the new review page and the PCs panel.
- Desktop-only shops (never paired) are unchanged.
