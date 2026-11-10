# Feature Specification: Restore a shop (to an earlier time, or from a backup file)

**Feature Branch**: `377-shop-restore` (work happens on `main`; ticket LIRA-377)

**Created**: 2026-11-10

**Status**: Draft

**Input**: Owner, 2026-11-10: "How can we expand on the backup feature, like extending to backup and restore?" — after the web "Download backup" (Settings › Backup) shipped the same night.

## Clarifications

### Session 2026-11-10 (owner decisions)

- Q: Which restore? → A: Both in one feature: restore the shop to an earlier moment, and restore it from a backup file downloaded earlier from Settings › Backup.
- Q: Who can restore? → A: The shop's admin (not only the platform super admin).
- Q: The shop is paused while its data is swapped. → A: A few seconds of downtime for that shop is fine.
- Q: The owner restores from the web app while a till PC is offline with unsent sales. When the till comes back and sends them, what happens? → A: Keep them. They are applied on top of the restored shop. Any sale that points at something the restore removed (for example a client created after the restore point) goes to the review list instead of being applied.
- Q: How far back can "restore to a time" go? → A: 7 days. Older states are restored from a downloaded file.
- Q: On a restore, what is kept from the shop as it is just before the restore? → A: Integration keys and Google sign-in links (and till-PC pairings, which are always kept). Everything else comes from the restored copy.
- Q: A held offline sale that points at something the restore removed — what can the owner do? → A: If it is a client, pick another client or walk-in and book it; otherwise Dismiss and re-enter by hand.
- Proposed by the assistant and not objected to (2026-11-10): a preview of what will be lost, in money, before confirming; typing the shop name to confirm; an automatic "before restore" copy so a restore can be undone; an email to the shop owner after every restore; a file from another shop or from a newer app version is refused.

### What exists today (read from the code and production, 2026-11-10)

| Piece | State |
|---|---|
| One data file per shop on the web | Live since 2026-11-10 01:41 UTC. A restore can replace one shop's data without touching any other shop. |
| Continuous copy of each shop | Every shop's data is copied off the server within seconds of each change (`yarn api:backup-check` restores all of them and compares). |
| Download backup | Settings › Backup (web, admins): a file with only that shop's data; sessions and one-time links left out; staff password hashes kept. |
| Paired till PCs (offline mode) | Each PC keeps its own copy of the shop, refreshed about every 5 minutes, sells on it when the internet is down, and sends those sales later. The server books them through the normal paths and keeps a list of the PC's own numbers → server numbers. Problems go to the owner's review list (14 kinds today, e.g. "Could not be booked", "Customer already existed — linked"). |
| Restore anywhere | None. Not on the web, not on the desktop. |

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Undo a mistake by going back to an earlier time (Priority: P1)

At 15:20 the owner sees that at 15:02 a cashier set every product's stock to zero by mistake. On the web app, in Settings › Backup › Restore, the owner picks "today 15:00", sees a preview of what the shop looked like at 15:00 and what will be lost (the 3 sales made after 15:00, $41.00 in total), types the shop name, and confirms. A few seconds later the shop is back as it was at 15:00. The owner gets an email saying the shop was restored, when, and by whom.

**Why this priority**: The commonest reason to restore is a mistake made minutes or hours ago. No file is needed: the shop is already copied continuously.

**Independent Test**: On the test shop, record a sale, wait, record a second sale, restore to a moment between them, and check that the first sale is there, the second is gone, and every other shop is untouched.

**Acceptance Scenarios**:

1. **Given** sales at 14:50 and 15:10, **When** the admin restores to 15:00, **Then** the 14:50 sale is present, the 15:10 sale is gone, drawer balances and stock are those of 15:00, and other shops' data is unchanged.
2. **Given** the admin picked a time, **When** the preview opens, **Then** it shows the restored copy's last sale (time, amount, client) and what is lost: how many sales/payments were recorded after that time and their totals per currency.
3. **Given** the preview is open, **When** the typed shop name does not match, **Then** Restore stays disabled.
4. **Given** a restore finished, **Then** an entry "Shop restored to <time>" appears in the audit log with who did it, and the shop owner receives an email.
5. **Given** a staff (non-admin) user, **Then** they cannot open Restore and the server refuses a restore request from them.

---

### User Story 2 — Restore from a backup file (Priority: P1)

An owner kept a backup file downloaded last month. They upload it in Settings › Backup › Restore from file. The server checks the file, shows the same preview (the file's date, its last sale, and what will be lost compared with now), and after the typed confirmation replaces the shop's data with the file's.

**Why this priority**: Owner decision: both kinds ship together. A file covers restore points older than the continuous copy keeps, and any copy the owner kept themselves.

**Independent Test**: Download a backup of the test shop, make a sale, upload the file, confirm, and check that the sale made after the download is gone and the shop works normally.

**Acceptance Scenarios**:

1. **Given** a file downloaded from this shop, **When** it is uploaded, **Then** the preview shows the file's date and contents summary and the restore can be confirmed.
2. **Given** a file downloaded from a different shop, **Then** it is refused with "This file is from another shop (<name>)" and nothing changes.
3. **Given** a damaged or non-LiraTek file, **Then** it is refused with a plain message and nothing changes.
4. **Given** a file that contains rows of more than one shop, **Then** it is refused and nothing changes.
5. **Given** a file made by an older app version, **Then** it is brought up to the current version before the preview and the restore works.
6. **Given** a file made by a newer app version than the server runs, **Then** it is refused with "This file was made by a newer version".
7. **Given** a restored file, **Then** nobody is signed in from it: every user signs in again with their own password, and invitation/reset links from the file do not work.

---

### User Story 3 — Undo a restore (Priority: P2)

Right after restoring, the owner realises they picked the wrong time. Restore shows "Before restore — 10 Nov 15:20" at the top of the list. Restoring to it puts the shop back exactly as it was just before the restore.

**Why this priority**: A restore throws data away by design; one wrong click must be reversible.

**Independent Test**: Restore the test shop, then restore its "before restore" copy, and compare row counts and the last sale with the state before the first restore.

**Acceptance Scenarios**:

1. **Given** any restore finished, **Then** a "before restore" copy of the shop as it was a moment earlier exists and is listed first.
2. **Given** the owner restores the "before restore" copy, **Then** the shop matches its state before the first restore (same sales, balances, stock).

---

### User Story 4 — Till PCs follow the restore without booking anything wrongly (Priority: P1)

The shop has a paired till PC. Case A: the till is online during the restore. Within a minute it drops its old copy, downloads the restored one, and shows "Shop restored to 15:00 by <owner>". Case B: the till's internet is down from 15:05 to 15:40 and it records 6 sales offline; one is on the account of client Rami, created at 15:00. At 15:20 the owner restores to 14:55, which removes Rami; at 15:25 someone adds client Hadi on the web. At 15:40 the till sends its 6 sales: 5 are booked normally, Rami's sale goes to the review list ("Points at something the restore removed — pick a client or book as walk-in"), and nothing is booked to Hadi.

**Why this priority**: Offline sales are real money in the drawer (owner: keep them). Booking a sale to the wrong client is the most dangerous failure, and it would be silent.

**Independent Test**: With the offline test harness, queue offline events that reference a record created after the restore point, restore, create a new record that would reuse its number, replay, and check the event is held for review and the new record is untouched.

**Acceptance Scenarios**:

1. **Given** a paired PC online during a restore, **Then** it replaces its copy with the restored shop's within 1 minute and shows the restore banner.
2. **Given** offline sales queued before a restore and sent after it, **Then** each one that only references records still present is booked as usual, through the normal checks (stock, drawer, ledgers, profit).
3. **Given** an offline sale referencing a record the restore removed, **Then** it is held on the review list with the new kind "Points at something the restore removed", and is not booked to any record — even if that record's number has since been given to something else.
4. **Given** an offline sale that referenced a record the PC knew only by the server number it received from a replay after the restore point, **Then** it is treated as referencing a removed record (case 3), never mapped to that number.

---

### Edge Cases

- The admin starts a restore while another restore of the same shop is running → refused: "A restore is already running". Other shops can restore at the same time.
- A restore fails part-way (copy unreadable, disk full, server restart) → the shop keeps its current data, unchanged; the admin sees the error; nothing is half-replaced.
- The chosen time is before the oldest moment that can be restored, or in the future → the picker does not offer it and the server refuses it.
- The chosen time is before the shop existed → refused.
- Users signed in to the shop during a restore → their sessions end; they sign in again (sessions are not carried across a restore).
- The admin who restores is not present in the restored data (e.g. created after the restore point) → the restore is still allowed after an explicit warning in the preview; afterwards they sign in with an account that exists in the restored data. [Assumed; see Assumptions.]
- A restored file older than the shop's subscription changes → the subscription and plan are platform data and are NOT changed by a restore.
- A large shop's restore takes longer than a few seconds → other shops keep working; only the restoring shop is paused.
- Day closings, checkpoints and settlements recorded after the restore point disappear with everything else; the preview counts them in "what will be lost".
- A paired PC that is switched off for days → on its next start it notices the restore before sending anything and follows Story 4.

## Requirements *(mandatory)*

### Functional Requirements

**Who and where**

- **FR-001**: Restore MUST be available in the web app, in Settings › Backup, to shop admins only; the server MUST refuse it for any other role.
- **FR-002**: A restore MUST replace only the requesting shop's data. No other shop's data, availability or backups may change.
- **FR-003**: Platform data about the shop (its name and address on the platform, subscription, plan, trial) MUST NOT be changed by a restore.
- **FR-003a**: Integration keys, Google sign-in links and till-PC pairings MUST be kept as they were just before the restore.

**Choosing what to restore**

- **FR-004**: The admin MUST be able to pick a moment (date and time, in the shop's local time) within the available window to restore to.
- **FR-005**: The admin MUST be able to upload a backup file produced by Settings › Backup › Download backup.
- **FR-006**: An uploaded file MUST be refused, with a plain message and no change, when: it is not a valid LiraTek shop file; it fails an integrity check; it belongs to another shop; it contains rows of more than one shop; or it was made by a newer app version than the server runs.
- **FR-007**: A file from an older app version MUST be brought up to the current version before the preview.

**Preview and confirmation**

- **FR-008**: Before anything changes, the system MUST show a preview: the moment or file date being restored; the restored copy's last sale (time, amount, client); and what will be lost compared with now — number of sales, payments, expenses and day closings after that point and their totals per currency.
- **FR-009**: The restore MUST only proceed after the admin types the shop's name exactly; the server MUST check the same confirmation.
- **FR-010**: If the restoring admin's own account does not exist in the restored copy, the preview MUST say so before confirmation.

**Doing the restore**

- **FR-011**: Only one restore per shop MAY run at a time.
- **FR-012**: The restore MUST be all-or-nothing: on any failure the shop keeps its current data unchanged.
- **FR-013**: Just before replacing the data, the system MUST keep a "before restore" copy of the shop, restorable like any other restore point (FR-004), so a restore can be undone.
- **FR-014**: The shop MAY be unavailable for a few seconds during the swap; other shops MUST stay available.
- **FR-015**: After the swap, every signed-in session of that shop MUST end, and no session, invitation, password-reset or verification token from the restored copy may work.
- **FR-016**: The restored data MUST keep being copied off the server continuously like before, and the restore MUST be visible to the backup check (`yarn api:backup-check` keeps passing).

**Record and notify**

- **FR-017**: Each restore MUST write an audit entry "Shop restored to <moment or file date>" with who did it, when, and the kind (time or file).
- **FR-018**: Each restore MUST send an email to the shop owner's contact email (and the admin who did it, if different) with the same facts.

**Paired till PCs**

- **FR-019**: Each paired PC MUST learn of a restore within 1 minute while online, or before sending anything on its next start; it MUST then discard its local copy, download a fresh copy, and show "Shop restored to <time> by <name>". The PC's own counters are never reset; the list of PC numbers → server numbers lives on the server and is carried across the restore and checked there (FR-021).
- **FR-020**: Offline sales and other offline actions queued on a PC before a restore and sent after it MUST be kept and booked onto the restored shop through the usual checks.
- **FR-021**: An offline action that references a record the restore removed — including a record known to the PC only by a server number handed out after the restore point — MUST NOT be booked; it MUST be held on the review list under a new kind "Points at something the restore removed", with Apply (after choosing a replacement client or walk-in, only when the removed record is a client) and Dismiss like other held items.
- **FR-022**: Offline actions that do not reference removed records MUST be booked as if no restore had happened, except that money, stock and balances are those of the restored shop.

**Scope**

- **FR-023**: The desktop app is out of scope (its local backups and a restore button for them are a separate gap). The constitution's dual-transport rule is waived for this feature because restore replaces a web shop's server data, which has no desktop counterpart.

### Key Entities

- **Restore point**: a moment the shop can be restored to — any time within the available window, or a "before restore" copy. Attributes: moment, kind (continuous, before-restore), who created it (for before-restore).
- **Backup file**: a file downloaded from Settings › Backup. Attributes: shop it belongs to, date made, app version that made it.
- **Restore**: one completed or failed restore of a shop. Attributes: shop, who, when started/finished, kind (time / file / undo), target moment or file date, outcome, the "before restore" copy it left, and the totals shown in its preview.
- **Restore notice for PCs**: what a paired PC needs to know to follow a restore: that a restore happened, when, to what moment, and by whom.
- **Review item "Points at something the restore removed"**: a held offline action, naming the removed record and the restore that removed it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An admin can go from opening Restore to a confirmed restore in under 2 minutes, including reading the preview.
- **SC-002**: The restoring shop is unavailable for under 15 seconds for a shop the size of the largest live shop (about 11 MB of data); other shops see no interruption.
- **SC-003**: 0 offline actions are booked to a record other than the one the cashier chose, across every replay test that crosses a restore.
- **SC-004**: After any restore, restoring its "before restore" copy reproduces the earlier state exactly (same row counts and same last sale) in 100% of test runs.
- **SC-005**: A file from another shop, a damaged file, a multi-shop file and a newer-version file are each refused in 100% of tests, with the shop's data unchanged.
- **SC-006**: Every restore produces exactly one audit entry and one email to the owner.
- **SC-007**: After a restore the shop's continuous copy is current again within 5 minutes, as shown by the backup check.

## Assumptions

- The restore window for "restore to a moment" is the **last 7 days** (owner, 2026-11-10). Older states are restored from a downloaded file. This needs the continuous copy to keep 7 days of history; the plan confirms the cost and changes the retention setting if needed.
- Times are shown and picked in the shop's local time, sent by the browser (rule 27), never the server's clock.
- "Before restore" copies are kept for 7 days, then deleted automatically; the newest one is always kept.
- The restoring admin may lose their own account if it was created after the restore point; we warn (FR-010) rather than block, so a shop is never locked out of fixing a mistake. Another admin present in the restored data, or the platform super admin, can then sign in.
- Staff password hashes in a backup file are trusted as they are (owner kept them in Download backup, 2026-11-10); every user signs in again after a restore.
- The restored shop's address (subdomain) does not change; if the shop's slug was renamed after the file was made, the platform's current name wins (FR-003).
- The owner email uses the existing outgoing-email path; if email sending is down, the restore still happens and the audit entry still records it.
- Restore is a web feature only. Desktop restore is a separate gap, noted in `current_sprint.md`.
- Money rules: a restore does not create, reverse or adjust any transaction; it replaces the shop's whole data with an earlier consistent state. The FEATURE_GUIDE §13 money checklist applies to the offline replay part (FR-020–FR-022), which books through the existing paths.
