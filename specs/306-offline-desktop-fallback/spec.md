# Feature Specification: Offline desktop fallback — web-first with a desktop Plan B

**Feature Branch**: `306-offline-desktop-fallback` (work on `main`; no branch — owner rule)

**Created**: 2026-10-11

**Status**: Draft — design only (overnight batch 2026-10-11, item 4; owner delegated every decision)

**Ticket**: LIRA-306 (`current_sprint.md`)

**Input**: `docs/plans/todo_plans/OFFLINE_DESKTOP_FALLBACK_PLAN.md` (owner decisions D1–D5, 2026-09-27) — "Most shops
work on the web app. When the shop's internet drops, the cashier switches to the desktop app on the same PC and keeps
working with the shop's own recent data. When the internet returns, the offline work lands on the web database and the
shop carries on in the browser. Nothing is lost, nothing is double-booked."

## Owner decisions this spec is bound by (2026-09-27, unchanged)

- **D1** Web is primary. The desktop is a fallback for outages, not a second everyday till.
- **D2** No writes on the web during an outage: while a shop's desktop works offline, that shop's web app is read-only.
- **D3** Google Drive is not in the sync path.
- **D4** Row IDs are assigned only by the database that stores the row. No client ever sends a row ID for a new row.
- **D5** Step 1 is finishing the hosting plan (per-tenant split, Phase D) — still owner-scheduled; this spec does not
  depend on it for the slices built first (see O3).

## Verified facts that correct the 2026-09-27 plan (checked against source 2026-10-11)

- **A "book once" key already exists.** LIRA-289 shipped `IdempotencyService` + table `idempotency_keys` (migration
  v208) + `runIdempotent` (`backend/src/middleware/idempotency.ts`), used by `POST /api/debts/repayments` and
  `POST /api/services/transactions`. It keeps replies for 24 h only and stores successful replies only, so it is not
  enough on its own for a multi-day outage or for recording refusals (see O9). The plan's "no such key exists" is stale.
- **Last migration is v209** (`session_member_debt_share`); this feature's migration is **v210**.
- **Receipts now print `RCP-<sale id>`** for both the first print and a reprint (LIRA-296). The plan's "checkout prints
  `RCP-${Date.now()}`" is stale; an offline sale's local id will differ from its server id (see O15).
- **Counts grew:** 81 `AUTOINCREMENT` tables in `create_db.sql` (plan: 68); 24 repository queries order by `id DESC` or
  use `MAX(id)` (plan: 18).
- **`sync_queue` / `sync_errors` are not reusable:** no `tenant_id`, no `updated_at`, a row-copy shape keyed by
  `record_id` (contradicts D4), and `sync_errors` is already read by the desktop diagnostics screen (see O9).
- **The desktop is hard-wired to tenant 1** in two places (`electron-app/main.ts` `initFixedTenantContext(1)`,
  `electron-app/licenseSync.ts` `DESKTOP_TENANT_ID = 1`). A copy of a web shop keeps its real tenant id (hosting
  decision A-D1), so paired mode must read the tenant id from the copy.
- **POS sales, expenses and debt repayments already accept an original time** (`transaction_time`, core
  `transactionTimeSchema`), and all three are allowed for admin and staff on both transports.
- **The anonymous API rate limit defaults to 100 requests / 15 min per IP** (`backend/.env.prod` raises it to 1000), and
  until LIRA-283 the IP is a proxy address shared by every shop. Desktop check-ins without a user token would eat into
  that shared bucket for everyone (see O17).
- **Hosting Phase D is still not done** (runbook § 12.4 of `PRODUCTION_DATABASE_AND_HOSTING_PLAN.md`); production still
  runs one shared file.

## User Scenarios & Testing *(mandatory)*

Stories are ordered by build order: the first two are fully buildable and testable on this machine tonight (server and
web app); the third and fourth are buildable as code with unit tests but their desktop-visible behaviour is unverified
until CI / the owner's Windows PC (no Electron on this Mac, G5); the fifth is owner-run.

### User Story 1 — The web app goes read-only while the shop's backup desktop is away (Priority: P1)

The owner pairs the shop's PC as its backup desktop. From then on, the desktop checks in with the server every few
seconds. If it stops checking in without saying goodbye (the shop's internet is down), or it reports that it is working
offline, every user of that shop on the web app and the phone app sees "Your shop's desktop is working offline — changes
are paused" and cannot save anything; they can still look at everything. An admin can press "Unlock — the desktop isn't
in use" on the web app (for example after a power cut); that choice is recorded. The phone app shows the same
refusal message on a save; it has no Unlock button in this release.

**Why this priority**: D2 is the owner's rule that keeps offline work from colliding with web work. It is also the
smallest slice that is complete and testable without any desktop.

**Independent Test**: Pair a device through the API, send check-ins, stop them, and confirm a web sale is refused with
the lock message while every page still loads; unlock as admin and confirm the sale goes through and an audit entry
exists. A shop with no paired device behaves exactly as today.

**Acceptance Scenarios**:

1. **Given** a shop with no paired desktop, **When** any user saves anything, **Then** behaviour is exactly as today.
2. **Given** a paired desktop that checked in within the last 90 seconds and reports "standby", **When** a web user
   saves a sale, **Then** it is saved.
3. **Given** a paired desktop silent for more than 90 seconds without a goodbye, **When** a web or phone user saves
   anything, **Then** it is refused with the lock message and nothing is written; **And** every read still works; **And**
   sign-in still works.
4. **Given** a paired desktop that is checking in and reports "working offline" or "sending offline work", **When** a
   web user saves anything, **Then** it is refused with the lock message.
5. **Given** the web app is locked, **When** an admin presses Unlock and confirms, **Then** saving works again and an
   audit entry names the admin and the time; **And** a staff user does not see the Unlock button.
6. **Given** the desktop said goodbye (app closed, PC going to sleep), **When** its check-ins stop, **Then** the web
   app is not locked.

---

### User Story 2 — Offline work lands on the web exactly once, on the day it happened (Priority: P1)

When the internet returns, the desktop sends its offline work — POS sales, expenses and debt repayments — to the server
in the order it happened. The server books each one through the same rules a web sale goes through (stock, drawers,
ledgers, profit), gives every new row its own number, keeps the original time and day, and books each operation only
once even if the desktop sends it twice. Anything the server refuses is kept, with the reason, on an "Offline work to
review" list the owner resolves on the web app (Apply / Dismiss). Nothing is dropped silently.

**Why this priority**: This is the money path. Shipping it without the "book once" guarantee would book real money
twice; shipping it without the original day would put a 23:50 sale in the next day's sales, transactions and profit.

**Independent Test**: Through the API with a paired device key, send a batch of three operations recorded "yesterday at
23:50 Beirut"; confirm they are booked once with that time and day, that drawer, stock, debt and profit moved exactly
as the same actions made on the web would move them, that resending the batch changes nothing, and that a refused
operation appears on the review list and can be applied or dismissed.

**Acceptance Scenarios**:

1. **Given** a batch of operations from the paired desktop, **When** the server receives it, **Then** each operation
   is booked through the same service the web uses, in the order sent, with the recording user as the actor.
2. **Given** an operation was already booked, **When** the same operation key arrives again (any time later, even days),
   **Then** nothing new is booked and the original result is returned.
3. **Given** an operation recorded at 23:50 on day N (shop's own day), **When** it is booked on day N+1, **Then** the
   sale, its transaction row and its profit belong to day N; the cash-drawer movement lines are dated when the work was
   sent, exactly as for any backdated entry today (O26).
4. **Given** an operation the server refuses (out of stock, user deactivated, time in the future), **When** the batch is
   processed, **Then** the refusal and its reason are stored, the rest of the batch continues, and the operation shows on
   "Offline work to review".
5. **Given** any change was saved on the web or phone app for that shop after the desktop's offline period began (for
   example after an admin Unlock, or because the desktop had said goodbye and then started offline without internet),
   **When** that period's work arrives, **Then** none of it is booked automatically; all of it is held on the review
   list for the owner, who can apply it item by item or all at once.
6. **Given** an item on the review list, **When** the owner presses Apply (or Apply all), **Then** each item is booked
   once (same rules as above); **When** the owner presses Dismiss, **Then** it is marked dismissed with who and when,
   and nothing is booked. Booked offline work stays visible under "Offline history" with the web sale number it became.
7. **Given** the whole outage day replayed, **Then** drawer, ledger, stock and profit totals per currency equal the same
   actions done online.
8. **Given** the desktop has delivered every operation (booked, refused or held), **When** it reports it is finished,
   **Then** the web app unlocks.

---

### User Story 3 — The backup desktop keeps a recent copy of the shop's data and shows whether it is ready (Priority: P2)

On the paired desktop, while the internet works, the app shows a standby screen: "This computer is <shop>'s backup till.
Use the web app. Copy of your data updated 3 minutes ago — ready to work offline." It refreshes the copy every few
minutes. The copy contains only this shop's data and none of its sign-in secrets other than what offline sign-in needs.
If the desktop app version does not match the web app's data version, the screen says "Update this app to be ready for
offline work". A desktop that was never paired keeps working exactly as today.

**Why this priority**: Without a recent copy there is nothing to work offline with. It is second because the copy can be
built and checked from the server side tonight, while the screen itself is desktop-visible (verified on CI/Windows only).

**Independent Test**: Request the copy with a device key from a shared-file server holding two shops; open it and
confirm it holds only the requesting shop's rows, no session/token/key rows, its real tenant id, and passes an integrity
check. On the desktop, the standby state logic is unit-tested.

**Acceptance Scenarios**:

1. **Given** a paired desktop online, **When** 5 minutes pass, **Then** it fetches a fresh copy and the "updated" age
   resets; the shop's own working data is never changed by this.
2. **Given** a server holding several shops (shared file, before Phase D), **When** shop A's device asks for a copy,
   **Then** the copy contains no row of any other shop.
3. **Given** a copy, **Then** it contains no sessions, sign-in codes, reset tokens, device keys, stored replies or
   licence key; users keep their password hash so they can sign in offline.
4. **Given** the desktop app's data version differs from the copy's, **Then** the standby screen says it is not ready
   and offline mode cannot start.
5. **Given** a desktop that was never paired, **Then** nothing changes: no standby screen, it uses its own database.
6. **Given** a paired desktop on standby, **When** anything tries to change the copy outside offline mode, **Then** it is
   refused.

---

### User Story 4 — The cashier keeps selling on the desktop during an outage, then sends the work back (Priority: P2)

The internet drops. After about two minutes (30 seconds more than the server waits before pausing the web app) the
standby screen offers "Work offline". The cashier presses it, signs in
with their usual username and password, and can ring up POS sales, record expenses and take debt repayments against the
shop's existing products and customers. Other actions say "Not available while offline — do this on the web app when the
internet is back". A banner shows "Working offline — 12 operations waiting to send". When the internet is back, the
banner says "Internet is back — send your offline work"; new offline work is refused after a minute so the shop returns
to the web app. Pressing Send delivers the work (Story 2), then the desktop returns to standby.

**Why this priority**: This is the user-facing payoff, but it depends on Stories 1–3 and its behaviour can only be seen
on the desktop, which is verified on CI / the owner's PC, not tonight.

**Independent Test**: Unit/integration tests in the desktop process: offline-OK operations write to the working copy
and record an operation in the same step; any other write is refused; a crash mid-operation leaves either both or
neither; sending marks each operation from the server's reply; the working copy is retired only once nothing is pending.

**Acceptance Scenarios**:

1. **Given** the server has been unreachable for longer than its lock delay plus 30 seconds (120 seconds by default),
   **When** the cashier presses Work offline, **Then** a
   working copy is made from the latest copy and the app opens on the sign-in screen for that shop.
2. **Given** offline mode, **When** the cashier completes a POS sale, **Then** the sale and its outgoing operation are
   saved together (both or neither).
3. **Given** offline mode, **When** the cashier tries any action outside the offline list (a refund, a new customer, a
   closing, a session basket, a supplier payment…), **Then** it is refused with the offline message and nothing changes.
4. **Given** offline mode, **When** a sale refers to a customer or product that exists in the copy, **Then** it is
   allowed; **When** an action would refer to a row created offline (refund an offline sale), **Then** it is refused.
5. **Given** the internet is back, **When** the cashier presses Send, **Then** every operation is delivered in order, its
   result recorded, and the desktop goes back to standby only when nothing is pending; the working copy is kept as a
   finished file (the last 3 are kept).
6. **Given** sending is interrupted (the line drops again), **When** Send is pressed later, **Then** already-booked
   operations are not booked again.
7. **Given** an offline sale is printed, **Then** its receipt number reads `RCP-OFFLINE-xxxxxxxx`, and the review /
   history list shows which web sale it became.

---

### User Story 5 — Production switch-on (owner-run, blocked on infrastructure) (Priority: P3)

The owner finishes hosting Phase D, deploys, issues the first device pairing on CornerTech's PC, verifies the tray app
and auto-start on Windows, and optionally switches the copy source from server-made copies to incremental Litestream
segments (spikes S1/S3). Each step follows a runbook in `docs/OPERATIONS.md`.

**Why this priority**: It needs Fly, R2 credentials, DNS or the owner's machines (overnight rule G5), so it cannot be done
tonight; it is written down so it is not lost.

**Independent Test**: The runbook's own checks (deploy verifier, a real outage drill on the test shop).

**Acceptance Scenarios**:

1. **Given** the runbook, **When** the owner runs the outage drill on the test shop (pull the network cable, sell, plug
   back in, send), **Then** the web app shows the sales on the right day, once, and unlocks.

---

### Edge Cases

- **Power cut at the shop**: the desktop dies without a goodbye → the web locks after 90 s. The admin unlocks from the
  web app (audited). If anything is saved on the web after that and the desktop later turns out to have offline
  work, that work is held for review (O8).
- **PC switched on in the morning without internet** (it said goodbye last night, so the web is not locked): the cashier
  can still work offline; if anyone saves anything on the web or phone meanwhile, the offline work is held for review
  instead of booked (O8).
- **PC asleep / app closed**: the desktop says goodbye → no lock.
- **The internet drops in the middle of sending**: the operations already booked are recognised by their keys and not
  booked again; the rest are sent on the next try.
- **The desktop's clock is a little fast** (an operation up to 5 minutes in the server's future) → booked at the
  server's current time and noted; more than 5 minutes → refused to the review list, where the owner can Apply it
  (booked at the current time, recorded as such) (O14).
- **A product went out of stock on the web just before the cut** → that offline sale is refused for stock and appears on
  the review list; the rest of the batch continues.
- **A user was deactivated on the web just before the cut** → their offline operations are refused (actor not active)
  and held on the review list.
- **The desktop app is older or newer than the web app's data version** → offline mode refuses to start (O11).
- **Someone edits the local copy by hand** → nothing reaches the server except operations, which the server validates
  with its own rules; the edited file itself is never uploaded.
- **Two desktops**: only one paired desktop per shop; pairing a second replaces the first, except while the first has
  unfinished offline work (then pairing is refused).
- **The device is revoked on the web while offline, or its key can no longer be read** (reinstall, Windows profile
  change) → its batch is refused as a whole and kept on the desktop; an admin re-pairs from the offline desktop without
  losing the waiting work (the operations keep their keys, so nothing is double-booked); a forced replacement counts as a
  web change, so that work is held for review (FR-035).
- **Lock lookup fails on the server (database error)** → writes are allowed and the failure logged (O7); the write is
  still noted as a web change when the database allows it (the note is attempted separately; if the database is down it
  may be lost), so colliding offline work is held for review in all but that case.
- **Screens that read through a POST** (audit search, report export, voucher check, product-unit list, Profits
  lock/unlock) → stay available while locked (a named list).
- **Phone app after-hours sale while the shop PC is off without a goodbye** → locked; an admin unlocks on the web app
  (O6 risk).
- **Windows shutdown at closing**: Windows does not give apps the normal quit signal on shutdown, so the goodbye is sent
  from the shutdown notice itself with a 2-second limit; if it does not get out, the web pauses 90 s later until an admin
  unlocks (named risk, checked in the owner drill).

## Requirements *(mandatory)*

### Functional Requirements

**Pairing and device identity**

- **FR-001**: An admin of a shop MUST be able to pair one desktop as that shop's backup by signing in on the desktop with
  the shop's name as it appears in its web address (`<name>.liratek.shop`) and their admin username and password; the server returns a device key shown to nobody and kept only
  on that desktop; the server keeps only a one-way hash of it.
- **FR-002**: A shop MUST have at most one active paired desktop. Pairing a new one revokes the old one, unless the old
  one has unfinished offline work or is currently silent (locking the shop), in which case pairing is refused with a
  clear message and a "Replace anyway" choice whose replaced period goes to review.
- **FR-003**: An admin MUST be able to see the paired desktop (name, paired on, last check-in, state) and revoke it from
  the web app's Settings.
- **FR-004**: Every desktop-to-server call for this feature MUST authenticate with the device key; a revoked or unknown
  key is refused; the key identifies its shop without trusting anything else in the request.

**Check-ins and the write lock (D2)**

- **FR-005**: The paired desktop MUST check in every 15 seconds while running, reporting its state (standby, working
  offline, sending) and the number of operations waiting; it MUST send a goodbye when the app quits or the PC sleeps or
  shuts down (on Windows from the shutdown/log-off notice, within 2 seconds), but never when the app restarts itself to
  switch mode.
- **FR-006**: A shop MUST be locked when its paired desktop (a) has been silent for more than 90 seconds since its last
  check-in without a goodbye after it (unless that last check-in said the desktop was not ready for offline work — then
  it cannot work offline and the web is not paused), or (b) last reported working offline or sending — unless an admin unlocked after
  the moment the lock began. A shop with no active paired desktop is never locked.
- **FR-007**: While locked, every write request from that shop's users (web and phone) MUST be refused with an
  IPC-identical envelope (`success: false`, a lock code and the plain-language message); reads (including the named
  reads that use POST), sign-in, sign-out, the admin Unlock, revoking a desktop, dismissing a review item, and the
  device's own routes MUST NOT be refused. Applying offline work from the review list IS a write and is refused while
  locked.
- **FR-008**: The web app MUST show the lock banner to every user of a locked shop, and the Unlock button only to admins;
  Unlock MUST ask for confirmation and write an audit entry (who, when).
- **FR-009**: If looking up the lock fails, the write MUST be allowed and the failure logged (O7).
- **FR-009a**: For a shop with a paired (or formerly paired) desktop, the server MUST note the time of every write it
  lets through from a web or phone user (the "last web change"); forcibly replacing or revoking a desktop that has an
  open offline period MUST also count as a web change.
- **FR-010**: The 90-second threshold MUST be configurable on the server (for tests), defaulting to 90 seconds.

**Operations and replay (D4)**

- **FR-011**: The offline operation list for this release MUST be exactly: POS checkout (a new, completed sale — no
  drafts, no edit of an existing sale, no partner share, and a customer only if picked from existing customers, never
  typed new), add
  expense, debt repayment. Every other write MUST be refused in offline mode (O1, O2).
- **FR-012**: Each offline operation MUST carry: a unique operation key generated on the desktop, the operation name, the
  payload validated by the same shared schema the server uses for that operation, the recording user, the instant it
  happened (UTC), the shop's own calendar day and UTC offset at that instant, and the offline period it belongs to. It
  MUST NOT carry a row ID for any row it creates.
- **FR-013**: The server MUST book each operation through the same core service the web route for that operation uses,
  as the recording user, after checking that user belongs to the device's shop, is active and holds a role the
  operation allows (admin or staff for all three).
- **FR-014**: The server MUST keep a permanent record per (shop, operation key) — booked, refused, held for review, or
  dismissed — with the result or reason; an operation key seen before MUST return the stored outcome and book nothing.
- **FR-015**: The server MUST apply each operation's own day and offset as the request day (never its own clock's day)
  and pass its instant as the operation's original time.
- **FR-016**: Operations in a batch MUST be processed in the order sent; a refused operation MUST NOT stop the rest,
  except that later operations of the same period for the same customer MUST be held for review (so a repayment is never
  booked against a sale the owner may still dismiss).
- **FR-017**: If the shop's last web change (FR-009a) is later than the start of an offline period, every operation of
  that period MUST be held for review instead of booked (O8). The period's start is the EARLIER of: the instant the
  desktop recorded when it started offline mode (never later than when the server received it), and the server's latest
  check-in from any of the shop's desktops before the first message of that period (or the pairing time if there was
  none) (server instants only for the latter; the earlier of the two is used so that a wrong desktop
  clock can only cause more holds, never fewer).
- **FR-018**: The web app MUST offer admins an "Offline work to review" list (held and refused operations: what, when,
  who, amount, reason) with Apply (book it now through the same path, once), Apply all (in recorded order) and Dismiss
  (record who and when, book nothing), plus an "Offline history" view of booked operations with the web sale number each
  became.
- **FR-019**: When the desktop reports it has delivered every operation of a period, the server MUST end that period's
  lock.
- **FR-020**: Replay batches MUST be at most 50 operations per request; the device routes MUST have their own rate limit
  bucket keyed by the verified device, separate from the anonymous per-IP bucket (O17).

**Copy of the shop's data (mirror)**

- **FR-021**: The server MUST give a paired device, on request, a copy of its own shop's data only — on a shared file as
  well as on a per-shop file — with sessions, sign-in codes, password-reset tokens, device keys, stored replies, replay
  records, staff invitations, e-mail verification tokens, linked Google identities, platform-only tables (email outbox,
  sign-up invitations, sign-in directory, hand-off tokens), secret settings (API keys, tokens) and the licence key value
  removed, the shop's own subscription row kept, row counters reset to the copy's own highest numbers, and
  users' password hashes kept. The copy MUST pass an integrity check and name its data version (latest migration).
- **FR-022**: The server MUST NOT build a new copy for the same shop more than once every 5 minutes (it reuses the last).
- **FR-023**: The paired desktop MUST refresh its copy every 5 minutes while online and show the copy's age; it MUST
  replace its copy only when it has no operation waiting.
- **FR-024**: A paired desktop MUST use the copy's own tenant id for everything, never tenant 1.
- **FR-025**: A paired desktop MUST NOT change the copy outside offline mode; any attempt MUST be refused.
- **FR-026**: A desktop that was never paired MUST behave exactly as today (own database, tenant 1, licence sync).
- **FR-026a**: A paired desktop MUST keep receiving app updates while on standby — downloaded automatically and
  installed only when someone presses "Restart to update" on the standby screen (never on its own at a quit or
  restart), with nobody signed in (so it stays
  ready after server updates) — and MUST NOT download or install one while working offline; it MUST skip the setup wizard (the copy is an already set-up
  shop).

**Offline mode on the desktop**

- **FR-027**: "Work offline" MUST become available only after the server has been unreachable for longer than the
  server's lock delay plus 30 seconds (the delay is learned from the check-in reply; 120 seconds by default), and only
  when the copy's data version equals the desktop app's (O11, O12).
- **FR-028**: Starting offline mode MUST make a working copy from the latest copy and open it; all offline writes and
  their outgoing operations MUST go to the working copy in one step (both saved or neither).
- **FR-029**: Offline sign-in MUST check the username and password against the copy's users; deactivated users cannot
  sign in.
- **FR-030**: An offline operation that refers to a row created offline MUST be refused (no local-to-server ID map in
  this release, O2).
- **FR-031**: Once the server has been reachable again for 60 seconds, new offline operations MUST be refused with "send
  your offline work"; sending MUST deliver operations in order, record each result, and return to standby only when
  every operation is delivered; the working copy MUST then be kept as a finished file (last 3 kept).
- **FR-032**: Offline receipts MUST print `RCP-OFFLINE-` followed by the first 8 characters of the operation key, and the
  web review / history list MUST show the sale number each became.

**Cross-cutting**

- **FR-033**: Every money invariant holds: an outage day replayed nets to the same drawer, ledger, stock and profit totals
  per currency as the same actions online; voiding or refunding a replayed sale on the web works exactly as for any sale.
- **FR-034**: No production deploy, DNS, Fly, R2 or owner-machine step is part of the buildable slices; those are a
  runbook (Story 5).
- **FR-035**: If the desktop's key is refused or cannot be read while operations are waiting, an admin MUST be able to
  re-pair from the offline desktop; the working copy and its waiting operations MUST be kept and sent with the new key.

### Key Entities

- **Paired device**: a shop's one backup desktop — name, key hash, short non-secret key id, paired by, paired on, last
  check-in, last reported state and waiting count, last goodbye, revoked on, last admin unlock (who, when), last web
  change, open period and its start.
- **Offline period**: from when the server last heard from the desktop (or the desktop reported working offline) until the
  desktop reports everything delivered; identified by the desktop and echoed in each operation.
- **Offline operation (desktop side)**: key, name, payload, user, instant, day, offset, period, status (waiting,
  booked, refused, held), attempts, last error, server reply.
- **Replay record (server side)**: shop, device, operation key, name, payload, user, instant, day, offset, period, outcome
  (booked / refused / held / dismissed), result (for example the new sale's number) or reason, resolved by / on.
- **Copy (mirror)**: a single-shop database file with its data version and creation time; and the **working copy** made
  from it when offline mode starts.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A replayed outage day of at least 3 sales, 1 expense and 1 repayment nets to exactly the same drawer,
  ledger, stock and profit totals per currency (USD and LBP) as the same actions done on the web — difference 0.
- **SC-002**: Sending the same batch 3 times books each operation once (row counts and drawer deltas unchanged after the
  first).
- **SC-003**: An operation recorded at 23:50 shop time is counted in that day's sales, transactions and profit summary, never
   the next day's (drawer movement lines, and Profits by payment method which reads them, follow O26).
- **SC-004**: Within 2 minutes of the desktop going silent, 100% of that shop's write attempts from web and phone are
  refused, and 100% of its reads still succeed; a shop with no paired desktop sees 0 refusals.
- **SC-005**: 0 operations are lost: every operation sent is either booked, held or refused-with-reason on the server.
- **SC-006**: A copy requested by shop A contains 0 rows of any other shop and 0 secret rows.
- **SC-007**: A never-paired desktop shows no difference: its existing test suites pass unchanged.
- **SC-008**: The cashier can go from "internet down" to ringing the first offline sale in under 3 minutes (owner drill,
  Story 5).

## Decisions taken on the owner's behalf (overnight, delegated)

Full text (question, choice, why, how to undo) in `docs/plans/OVERNIGHT_DECISIONS_2026-10-11.md` §4.

- **O1** Offline list = POS checkout, add expense, debt repayment; everything else refused offline.
- **O2** No offline-created customers or products, no refund/void of an offline row while offline → no ID map needed now.
- **O3** Copy source = a server-made single-shop copy every 5 minutes; incremental Litestream (S1) and R2 presigned URLs
  (S3) are a later, owner-run upgrade.
- **O4** Device credential = a new per-device key from a pairing step, stored hashed; not the licence key.
- **O5** One paired desktop per shop.
- **O6** Lock = 15 s check-ins, lock after 90 s silent without goodbye (not when the PC last said it is not ready) or
  while working offline/sending; goodbye on quit
  and sleep; audited admin Unlock; covers web and phone; reads and sign-in never blocked.
- **O7** Lock lookup failure → allow the write and log it.
- **O8** Any web/phone change saved after an offline period began (after an Unlock, or while the web was not locked
  because the desktop had said goodbye) → that period's work is held for owner review; a forced device replacement
  counts as such a change. Saves made shortly before the cut — from the last check-in until the web pauses (up to
  about 90 s) — also send that outage to review; expected and safe; use Apply all.
- **O9** A new permanent replay record, not `idempotency_keys` (24 h, success-only) and not `sync_queue`/`sync_errors`.
- **O10** Offline writes go to a working copy with the outgoing operations in the same file; the copy itself is never
  written; finished working copies kept (last 3).
- **O11** Offline mode only when the desktop's data version equals the copy's.
- **O12** "Work offline" after the server's lock delay + 30 s unreachable (120 s by default), so the web is already
  paused when the desktop starts; new offline work refused 60 s after the server is back.
- **O13** Refused operations never block the batch; the owner resolves them on the web (Apply / Dismiss).
- **O14** Each operation carries its own instant, day and offset; up to 5 minutes in the server's future → booked at
  server time and noted; further → refused to review.
- **O15** Offline receipts print `RCP-OFFLINE-xxxxxxxx`; the review/history list maps it to the web sale number.
- **O16** Copy = the shop's rows only, secrets removed, password hashes kept; stored as plain SQLite like today's desktop
  database (encryption is a follow-up).
- **O17** Device routes get their own rate-limit bucket per verified device; batches of at most 50.
- **O18** Never-paired desktops unchanged; paired mode never opens the standalone database file.
- **O19** The lock only exists for shops with a paired desktop.
- **O20** The `id DESC` / `MAX(id)` audit (24 queries) and reprint numbering are a follow-up, not this release.
- **O21** Any active user of the shop may start offline mode by signing in; the server re-checks the user on replay.
- **O22** The 90 s threshold is a server setting (default 90 s) so tests can shorten it.
- **O23** On replay, the actor is the user recorded with the operation (not a signed-in session) — a narrow exception
  to "actor comes from the sign-in"; the user must belong to the device's shop, be active and hold an allowed role.
  Taken on the owner's behalf; **flagged for the owner to confirm**.
- **O24** Re-pairing from an offline desktop keeps the waiting work (FR-035).
- **O25** The PC's own calls are authenticated by its device key, and the standby-screen actions (pair, unpair, work
  offline, restart to update) run before anyone signs in on the PC; on standby, updates download automatically — a narrow exception to "every write route needs a signed-in user";
  **flagged for the owner to confirm** with O23 (plan Complexity Tracking E3).
- **O26** Cash-drawer movement lines (payments) of replayed work are dated when the work is sent, as every backdated
  entry is today; the sale, its transaction row and its profit keep the original day. Moving the lines too would change
  closing and dashboard figures for all existing backdated entries — a separate money change, listed as a follow-up on
  the LIRA-306 ticket.

## Assumptions

- Assumption (unverified): building a single-shop copy every 5 minutes is cheap at today's database size (~1.3 MB per the
  2026-09-27 plan); measured in the plan's research task before relying on it at larger sizes.
- Assumption (unverified): a shop's PC has a working clock within a few minutes; operations far in the server's future are
  refused to review rather than corrected.
- Assumption: the three offline operations are the ones that matter during an outage (selling, paying out an expense,
  taking a repayment); the owner can widen the list later operation by operation.
- Dependency: hosting Phase D is not required for Stories 1–4 (the copy works on a shared file); it is required before
  the incremental Litestream upgrade (Story 5).
- Dependency: desktop releases must ship alongside any migration so paired desktops stay "ready" (O11); this is a release
  discipline, recorded in the runbook.
