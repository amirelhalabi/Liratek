# Feature Specification: Free trial on signup (web app)

**Feature Branch**: `332-free-trial` (work directly on local `main`, owner preference)

**Created**: 2026-10-17

**Status**: Draft

**Input**: User description: "Free trial on signup for the LiraTek web app. Today a new shop can be created from the landing page ('Create your shop', Google signup, signup_invitations exist) but there is no trial period, no expiry, and no activation/billing step. Add a no-card free trial: a new shop gets N days (competitor anchors: Table 14 days, Managely 7 days), sees how many days are left, and when it ends the shop is asked to contact LiraTek on WhatsApp (+961 81 077 357) to activate; the owner (LiraTek admin) can activate or extend a shop. Data must never be deleted when a trial ends. Payment collection is out of scope (activation is manual)."

**Ticket**: LIRA-332 (owner decision 2026-10-17). Web app, plus the surfaces that talk to the web shop (phone app, paired offline PCs). The standalone desktop app is not affected.

## Background

**This reverses an earlier owner decision.** The subscription plan (`docs/plans/ongoing_plans/SUBSCRIPTION_MANAGEMENT_PLAN.md` §3, decision D2, 2026-09-08) said **"No trial"**. Its reason was that signup was gated by an invite code, so every shop was vetted by the owner before it existed. That is no longer true: a visitor can now create a shop by asking for a sign-up link by email, or with "Continue with Google", without the owner seeing it first. A self-served shop today starts fully active with no end date, which makes it look the same as a paying shop. LIRA-332 supersedes D2 for those shops.

What already exists and is kept:

- Each shop has a **standing** that the owner manages. Today it can be active, in a 7-day grace period after a paid period ends, or "read-only". Paid shops keep that path unchanged.
- The owner's shop list already has a **Suspend / Activate** action. It is a different thing: it is for abuse, and it stops everyone in the shop from signing in. This feature does not use or change it, and its wording must not be confused with activating a trial (see FR-016).
- Two existing owner decisions still apply: a shop must always be able to sign in and see and export its own records, including what its customers owe it (D4); and if the system cannot tell a shop's standing, it lets the shop work (fail-open).

## Clarifications

### Session 2026-10-17

- Q: How long is the free trial (FR-002)? → A: 14 days.
- Q: What can a shop do after its trial ends, and does it get the 7-day grace period (FR-008)? → A: It can sign in, view and export everything, but create no new records of any kind. No 7-day grace period (grace is for paying shops). Nothing is ever deleted. Wording says "trial ended", never "payment overdue".
- Q: What happens to a paired offline desktop PC after the trial ends (FR-019)? → A: It keeps uploading the sales it recorded before the trial ended (no sale is ever lost), then follows FR-008 for new work.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A new shop starts on a free trial and sees the days left (Priority: P1)

A shop owner creates a shop from the landing page ("Create your shop" by email link, or "Continue with Google"). No card is asked for. The shop works fully from the first minute. Every page shows a small strip: "Free trial: 12 days left", with a "Contact us to activate" button that opens WhatsApp.

**Why this priority**: Without it there is no trial at all. It also gives social posts a clear call to action ("try it free for N days").

**Independent Test**: Create a shop through each public sign-up path and check that it is on a trial with the right end date, that every module works, and that the strip shows the right number of days.

**Acceptance Scenarios**:

1. **Given** a visitor with no shop, **When** they create a shop with an emailed sign-up link, **Then** the shop starts on a free trial that ends N days later, no payment details are asked for, and every feature works.
2. **Given** a visitor with no shop, **When** they create a shop with "Continue with Google", **Then** the result is the same as scenario 1.
3. **Given** a shop on day 3 of an N-day trial, **When** any user of that shop opens any page, **Then** they see the number of days left and a button to contact LiraTek on WhatsApp.
4. **Given** a shop whose trial ends in 3 days or fewer, **When** a user opens the app, **Then** the strip becomes more prominent and says the trial ends soon, with the end date.
5. **Given** a shop that existed before this feature, **When** this feature ships, **Then** that shop is not put on a trial and nothing changes for it.

---

### User Story 2 - When the trial ends, the shop is asked to activate and loses nothing (Priority: P1)

The trial ends. The shop can still sign in and see all of its records. A clear screen explains the trial has ended and offers one button: "Contact LiraTek on WhatsApp to activate". The WhatsApp message is already filled in with the shop's name and address, so the owner knows which shop to activate. Nothing is deleted.

**Why this priority**: This is the moment that turns a trial into a customer. Getting it wrong either loses the customer's data (unacceptable) or lets the trial run forever (no business).

**Independent Test**: Move a trial shop's end date into the past, sign in, and check what the shop can and cannot do, that every record is still there, and that the WhatsApp button opens with the right number and message.

**Acceptance Scenarios**:

1. **Given** a shop whose trial has ended, **When** its admin signs in, **Then** sign-in works and they see a "Your free trial has ended" message with a WhatsApp button to +961 81 077 357.
2. **Given** a shop whose trial has ended, **When** the WhatsApp button is pressed, **Then** WhatsApp opens on that number with a pre-filled message that names the shop and its web address.
3. **Given** a shop whose trial has ended, **When** a user tries to do something an ended trial does not allow (see FR-008), **Then** it is refused with a message that says the trial has ended and how to activate, never a generic error and never "payment overdue".
4. **Given** a shop whose trial has ended, **When** a user opens Transactions, Debts, Clients or any report, **Then** every record from the trial is shown, and the shop can still export its data.
5. **Given** a shop whose trial ended 90 days ago, **When** the owner activates it, **Then** every record from the trial is still there and the shop works fully again.

---

### User Story 3 - The owner activates or extends a shop (Priority: P1)

A shop owner messages LiraTek on WhatsApp. The LiraTek owner opens the shops list, finds the shop, sees it is on a trial (or that its trial ended, and when), and either activates it as a paying shop or gives it more trial days.

**Why this priority**: Activation is manual (no card payments in this feature), so without this action no trial shop could ever become a customer.

**Independent Test**: As the LiraTek owner, extend one trial shop and activate another; check that each shop's strip and abilities change, and that other shops are untouched.

**Acceptance Scenarios**:

1. **Given** the owner's shops list, **When** the owner looks at it, **Then** each shop shows whether it is on a trial (with its end date and days left), its trial has ended (with the date), or it is a paying shop.
2. **Given** a shop on a trial or with an ended trial, **When** the owner activates it as a paying shop (open-ended, or paid until a date), **Then** the trial strip and the ended-trial message disappear for that shop within 15 minutes without anyone signing out, and everything works.
3. **Given** a shop on a trial or with an ended trial, **When** the owner extends its trial to a new end date, **Then** the shop works fully again until that date and its strip shows the new days left.
4. **Given** two trial shops A and B, **When** the owner activates A, **Then** B's trial is unchanged.
5. **Given** a shop that is not LiraTek's owner, **When** any of its users (including its admin) tries to activate or extend itself, **Then** it is refused.

---

### User Story 4 - Days left are the same on every screen and around midnight (Priority: P2)

A shop in Beirut checks its trial at 00:30. The web app's server keeps a different clock (UTC). The shop must see the same days left and the same end date that the owner's list shows, and the trial must not end a few hours early or late because of that difference.

**Why this priority**: The same day-boundary mismatch has already shipped four times in this product (CLAUDE.md rule 27). Here it would decide whether a shop is cut off.

**Independent Test**: Put a shop's trial end on a given day, then check the strip, the owner's list and what the shop can do at 23:30, 00:30 and 02:59 Beirut time on the last day and the day after.

**Acceptance Scenarios**:

1. **Given** a trial whose last day is 2026-11-01 (Beirut), **When** a user checks at 00:30 Beirut on 2026-11-01, **Then** they see "last day of your trial", and everything still works.
2. **Given** the same trial, **When** a user checks at 02:59 Beirut on 2026-11-01, **Then** the trial has not ended, even though the server's own date may still say 2026-10-31.
3. **Given** the same trial, **When** a user checks at 00:30 Beirut on 2026-11-02, **Then** the trial has ended.
4. **Given** any shop, **When** its strip and the owner's shops list are compared at the same moment, **Then** they show the same end date and the same number of days left.

---

### User Story 5 - The phone app and offline PCs follow the shop's trial (Priority: P3)

A trial shop may also use the phone app (after-hours sales) or a paired offline PC (works when the internet is down). They belong to the same shop, so they show the same trial and follow the same rule when it ends. Sales recorded before the trial ended are never lost.

**Why this priority**: Fewer shops use these during a trial, but a gap here would let a shop with an ended trial keep working through a side door, or lose sales it already rang up.

**Independent Test**: With a trial shop that has the phone app and a paired offline PC, end the trial and check what each can do and that offline sales recorded before the end still reach the shop.

**Acceptance Scenarios**:

1. **Given** a trial shop using the phone app, **When** the trial ends, **Then** the phone app shows the same "trial ended" message and allows exactly what the web app allows (FR-008).
2. **Given** a paired offline PC that recorded sales while the trial was still running, **When** it reconnects after the trial ended, **Then** those sales are accepted and appear in the shop's records.
3. **Given** a paired offline PC, **When** the trial has ended and the PC next reaches the server, **Then** it behaves as decided in FR-019.

---

### Edge Cases

- **Standing cannot be read** (server error, missing record): the shop is not blocked and no trial or ended message is shown. A paying shop is never shown "trial ended" by mistake.
- **Owner extends a trial to a date already in the past**: refused, with a message asking for a future date.
- **Owner activates a shop that is suspended for abuse**: activation changes the trial/paid standing only; the shop stays suspended until the owner lifts the suspension separately.
- **Trial ends while a cashier is mid-sale**: a sale already sent before the end instant is completed; the next action follows the ended-trial rule. The cashier sees the ended message, never a silent failure.
- **Trial ends while the shop has unsaved form data**: no data already saved is touched; the refused action says why.
- **Same person signs up again with a different email to get a new trial**: allowed by the system (one shop per email already applies). Detecting it is out of scope; the owner can see sign-up dates and contact details in the shops list.
- **Owner-created shops** (created by the LiraTek owner from the shops list): start as paying shops with no trial, as today. The owner can put one on a trial by setting an end date if they want.
- **Shop deleted or archived by the owner**: unchanged; only an explicit owner action can archive or delete a shop. A trial ending never does.
- **The trial-ended shop's staff**: every user of the shop (admin and staff) sees the same message; only the shop admin's WhatsApp message matters, but the button is shown to all.

## Requirements *(mandatory)*

### Functional Requirements

**Starting a trial**

- **FR-001**: Every shop created through a public sign-up path (emailed sign-up link, "Continue with Google", and a sign-up invitation the owner sent) MUST start on a free trial, at the same moment the shop is created. A shop must never exist without its trial being recorded.
- **FR-002**: The trial length MUST be 14 days, defined in one place so that changing it later is a single change.
- **FR-003**: Signing up MUST NOT ask for any payment details.
- **FR-004**: Shops that exist before this feature ships, and shops the LiraTek owner creates from the shops list, MUST NOT be put on a trial automatically.
- **FR-005**: During the trial the shop MUST be able to use every feature and module that a paying shop can.

**Showing the trial**

- **FR-006**: While on a trial, every page of the web app and the phone app MUST show how many days are left and a button that opens WhatsApp to +961 81 077 357. In the last 3 days the message MUST say the trial ends soon and give the end date.
- **FR-007**: The WhatsApp button MUST open a message already filled in that names the shop and its web address (for example "Hi LiraTek, I'd like to activate my shop <name> (<slug>.liratek.shop)"), using the same link format as the landing page's WhatsApp button.

**When the trial ends**

- **FR-008**: When a trial ends without activation, the shop MUST still be able to sign in, view everything and export everything, but MUST NOT be able to create new records of any kind (no sales, transactions, payments, debts, clients, stock changes, expenses, settings changes or any other new entry) until the LiraTek owner activates or extends it. An ended trial MUST NOT get the 7-day grace period; that grace is only for paying shops. The trial ends straight into this state at the end moment defined in FR-013.
- **FR-009**: A shop with an ended trial MUST always be able to sign in, see the "trial ended" message with the WhatsApp button, and export its own data, including what its customers owe it.
- **FR-010**: A trial ending MUST NOT delete, archive, hide or change any of the shop's records, users or settings. Only an explicit action by the LiraTek owner may archive or delete a shop.
- **FR-011**: Every action refused because the trial ended MUST say so in plain words ("Your free trial has ended. Contact LiraTek on WhatsApp to activate.") and MUST NOT say "payment overdue" or "subscription lapsed", which are for paying shops.
- **FR-012**: The trial and ended-trial messages MUST be shown in the shop's standing only. A paying shop, a shop in its paid grace period, and a shop whose standing cannot be read MUST never see them.

**Day and time**

- **FR-013**: A trial MUST end at a single, defined moment: the end of its last day in the shop's local time (Beirut). Both the web app and the phone app MUST report the same end date and the same days left for the same shop at the same moment, whatever clock or time zone the server uses.
- **FR-014**: "Days left" MUST be counted in the shop's local calendar days. It MUST NOT show "ended" or "0 days" while the shop's own calendar is still on a trial day.

**Owner actions**

- **FR-015**: The LiraTek owner MUST be able to see, for every shop, whether it is on a trial (end date, days left), has an ended trial (since when), or is a paying shop, and the date the shop was created.
- **FR-016**: The LiraTek owner MUST be able to (a) **activate** a trial or ended-trial shop as a paying shop, open-ended or paid until a date, and (b) **extend** a trial to a new future end date. The wording of these actions MUST differ from the existing Suspend / Activate action for abuse suspension (for example "Activate subscription" and "Extend trial"), and neither action may change a shop's suspension.
- **FR-017**: Only the LiraTek owner MAY activate or extend a shop. No user of the shop itself, including its admin, may change its trial.
- **FR-018**: After the owner activates or extends a shop, that shop's users MUST see the change within 15 minutes, without signing out.

**Connected surfaces**

- **FR-019**: A paired offline PC of a shop whose trial has ended keep uploading the sales and other records it recorded before the trial ended, and the server MUST accept them, so that no sale is ever lost. For new work after the trial ended, the PC MUST follow FR-008: it can view and export, but cannot create new records until the shop is activated or extended.
- **FR-020**: The phone app MUST show the same trial strip and ended-trial message and allow exactly what FR-008 allows for the web app.
- **FR-021**: The standalone desktop app MUST NOT be affected: it has no sign-up, and no desktop install may start a trial, lose access, or show trial messages because of this feature.

**Records and notes**

- **FR-022**: Every owner activation and extension MUST be recorded with who did it, when, and the before and after end dates, so the owner can see a shop's trial history.
- **FR-023**: The change MUST add a line to the release notes (`docs/release-notes/UNRELEASED.md`, "Web app" section) in shop-owner language, for example: "New shops now start with a free 14-day trial. You can see how many days are left at the top of every page, and contact us on WhatsApp to activate."

### Key Entities

- **Shop standing**: what a shop may do. Existing values: paying (active), paid grace period, read-only. This feature adds two: **on trial** (with a trial end moment) and **trial ended**. Each shop has exactly one standing at a time. It is separate from the shop's abuse suspension.
- **Trial**: belongs to one shop. Start moment (the sign-up), end moment, how the shop was created (which sign-up path), and its history of owner extensions and activation.
- **Owner trial action**: an activation or extension of one shop: who (the LiraTek owner), when, previous end date, new end date or "activated".

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of shops created through the three public sign-up paths start on a trial with the correct end date; 0 shops created before the release are put on a trial.
- **SC-002**: A new shop owner can see their days left on every page with no clicks, and can reach a pre-filled WhatsApp message to LiraTek in 1 tap.
- **SC-003**: For a shop with an ended trial, 100% of its records from the trial are still present and exportable, checked after the trial has been ended for at least 30 days.
- **SC-004**: The LiraTek owner can find a shop and activate or extend it in under 1 minute, and the shop sees the change within 15 minutes.
- **SC-005**: At 00:30, 02:59 and 23:30 Beirut time on a trial's last day and the day after, the web app, the phone app and the owner's list agree on the end date and days left in 100% of checks, and the trial ends on the correct Beirut day.
- **SC-006**: 0 paying shops see a trial or trial-ended message, including when the shop's standing cannot be read.

## Assumptions

- **Desktop**: the standalone desktop app is a local install with no sign-up, so it never starts a trial and is out of scope (FR-021). Desktop licensing stays as it is.
- **Which sign-up paths get a trial**: all public sign-up paths, including a sign-up invitation the owner sent (the owner can activate that shop straight away if it is a known customer). Shops the owner creates directly from the shops list start as paying shops. This is a judgment call; the owner can change it at the clarify step.
- **No grace after a trial** (decided 2026-10-17, FR-008): the 7-day grace period is for paying shops that miss a payment.
- **Reminders**: the in-app strip is the only reminder. Emails or WhatsApp messages sent BY LiraTek before the trial ends are out of scope.
- **Payment** is out of scope: activation is a manual owner action after the shop pays by whatever means the owner uses today.
- **Price** is not decided and does not block this feature (D1 in the subscription plan).
- **Abuse** (one person making several shops to get several trials) is accepted for now; the existing one-shop-per-email rule and daily sign-up limits stay.
- **"Days left" refresh**: the strip updates at least every 15 minutes and on page load, the same rhythm the existing standing banner uses.
- **Shop local time** is Beirut for every shop today; a shop in another time zone is not a case the product has.
