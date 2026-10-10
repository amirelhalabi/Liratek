# Feature Specification: Mobile app — owner records and tracks digital sales from the phone, including after closing

**Feature Branch**: `289-mobile-after-hours-sales`

**Created**: 2026-10-08

**Status**: In progress (planned and tasked 2026-10-08; build started 2026-10-10 — see plan.md "Progress")

**Input**: User description: "Mobile app for the shop owner. A web-app customer gets requests after the shop is closed (Whish App transfers, iPEC/Katch vouchers) and does them from his phone; he wants to record and track them in LiraTek from the phone, outside the shop. Only flows with no physical hand-over (no cash given out, no item handed over). Payment per transaction: customer account, or paid into the Whish app, OMT app or Binance wallet. Transactions recorded after closing belong to the next business day (revised 2026-10-08 to: the local calendar day they happened on — see Clarifications, third round). The phone sends its own local day. Owner only for now. Owner decisions 2026-10-08."

**Ticket**: LIRA-289 (`current_sprint.md`).

## Clarifications

### Session 2026-10-08 (owner decisions)

- Q: What can be done from the phone? → A: Only sales with **no physical hand-over** — the shop gives out no cash and no item. In: Whish App transfers, OMT App transfers, iPEC and Katch vouchers. Out: OMT and Whish counter services, currency exchange, POS sales, maintenance, and anything else that hands over cash or goods.
- Q: How does the customer pay when the shop is closed? → A: The owner picks per transaction: **on the customer's account** (the customer owes it), or **paid into the owner's Whish app, OMT app or Binance wallet**. No cash.
- Q: Does a sale made after closing belong to the closed day? → A: ~~No — it belongs to the next business day.~~ **Superseded in the third round below.** The phone can also be used during opening hours, where it behaves exactly like the web app.
- Q: Which date does a sale carry? → A: The **shop's local date and time, as the phone sees it**. A sale at 00:30 Beirut time is dated that Beirut day, never the server's date.
- Q: Who can use it? → A: **The owner (admin) only**, for now.

### Session 2026-10-08 (owner decisions, second round)

- Q: Installable web app or real phone app? → A: **A real app for both Android and iOS, built with Expo** (owner constraint). This replaces the earlier "installable web app first" direction.
- Q: How does the owner sign in? → A: **With Google, the same way as on the web today, or with shop + username + password.** No Sign in with Apple at this stage.
- Q: How does the app know which shop to open? → A: **Google:** from the Google account — it must be connected to the **owner** of exactly one shop; no shop list is ever shown. **Username and password:** usernames are unique only inside a shop, so the owner first enters the **shop address** (e.g. `cornertech`); the shop is found from that, then the username and password are checked inside that shop only. Usernames are never matched across shops. The phone remembers the shop address.
- Q: How does a new owner sign up from the app? → A: **The same flow as the web today.** The app takes the email and sends the existing "Create your shop" link; the link opens in the web browser, where the owner enters the shop details as today.

### Session 2026-10-08 (owner decision, third round — after planning research)

- Research finding: LiraTek has **no "day closed" state**. A closing is a count of each drawer; it resets that drawer's balance to the counted amount, and the "expected" amount is always the drawer's live running balance. The closing report is a PDF frozen when it is saved. So a late sale can never make a counted day show a shortage — the reason given for the "next business day" rule did not hold.
- Q: Which day does an after-hours sale count in? → A: **The shop's local calendar day it happened on.** A sale at 22:00 counts in today; a sale at 00:30 counts in tomorrow. No business-day concept is added. Next morning the shop sees the sales made since the last count.
- "Owner" in this spec means a user with the **admin** role (LiraTek has only admin and staff); a shop may have several admins.

### Session 2026-10-10 (owner decisions, during the build)

- Q: Binance as a way the customer pays for a Whish/OMT App transfer? → A: **Left out for now.** The server refuses a USDT leg for these transfers (web too), and a USD-coded leg would create a USD balance on the USDT Binance drawer. The phone offers on account, Whish wallet and OMT wallet only. FR-003's "Binance" is deferred.
- Q: Katch / iPick vouchers on the phone? → A: **Skipped for now.** The first phone version records Whish App and OMT App transfers only. FR-001's vouchers are deferred.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Owner signs in on the phone app and lands in the right shop (Priority: P1)

The owner of CornerTech installs LiraTek from the App Store or Google Play. He taps "Continue with Google" and picks his Gmail. The app recognises that this Google account belongs to the owner of CornerTech and opens CornerTech. Another owner has no Google connected. She types her shop address `rimaphones`, then her username and password, and the app opens her shop. The phone remembers `rimaphones` for next time. The next day the app opens without asking again.

**Why this priority**: Nothing else in the app works without it. It also has to be safe: the app must never open the wrong shop's data.

**Independent Test**: With two shops on the platform, install the app on Android and on iOS. Sign in with a Google account linked to the owner of shop A, and confirm the app shows shop A's data only. Sign out, sign in with shop B's address and its owner's username and password, and confirm it shows shop B's data only.

**Acceptance Scenarios**:

1. **Given** a Google account connected to the owner of exactly one shop, **When** the owner taps "Continue with Google", **Then** the app opens that shop without asking for a shop address.
2. **Given** a Google account connected to an admin in no shop, to admins in more than one shop, or only to staff users, **When** someone signs in with it, **Then** sign-in is refused with a message saying why, and no shop list is shown.
3. **Given** a Google account not connected to any LiraTek user, **When** someone signs in with it, **Then** sign-in is refused with a message explaining how to connect Google from Settings on the web app.
4. **Given** a shop address, username and password, **When** the owner signs in, **Then** the username and password are checked in that shop only, and the app opens that shop if they match.
5. **Given** the username "admin" exists in shops A and B, **When** the owner enters shop A's address with A's admin password, **Then** shop A opens; **When** they enter shop A's address with B's admin password, **Then** sign-in is refused.
6. **Given** the user who signs in is not an owner (admin), **When** sign-in succeeds, **Then** the app explains that the mobile app is for owners only and does not open the shop.
7. **Given** the owner signed in before, **When** the app is opened again, **Then** it opens the same shop without a new sign-in, until the session expires or the owner signs out.
8. **Given** the shop is suspended or its subscription has lapsed, **When** the owner signs in, **Then** the app shows the same state the web app shows for that shop.

---

### User Story 2 - Owner records a digital sale from the phone after closing (Priority: P1)

It is 22:00. The shop closed at 20:00 and the drawers were counted. A regular customer, Hassan, sends a WhatsApp: "Send $50 by Whish to my brother, I'll pay you tomorrow." The owner opens LiraTek on the phone, picks "Whish App transfer", chooses Hassan as the client, enters $50, picks "On customer account", and saves. Hassan now owes $50 plus the fee. The owner's Whish app balance in LiraTek goes down by $50.

The same evening another customer asks for a $10 Katch voucher and pays it into the owner's Whish wallet. The owner records it with "Paid into Whish app".

**Why this priority**: This is the request that started the feature. Without it, the owner does these sales on the phone and has to remember to enter them the next day, or forgets them.

**Independent Test**: Count the drawers. From a phone-sized screen, as the owner, record one Whish App transfer on a customer's account and one Katch voucher paid into the Whish app. Check the customer's debt, the Whish app balance and the voucher credit balance. They must match what the same sales would give if recorded at the counter.

**Acceptance Scenarios**:

1. **Given** the drawers were counted for the night, **When** the owner records a Whish App transfer of $50 on Hassan's account, **Then** Hassan's debt goes up by the amount the counter flow would charge, the Whish app balance goes down by $50, and the sale shows Hassan as its client.
2. **Given** the drawers were counted for the night, **When** the owner records a $10 Katch voucher paid into the Whish app, **Then** the Katch credit and the Whish app balance change exactly as they would for the same voucher sold at the counter and paid into the Whish app.
3. **Given** a sale is recorded, **When** the owner picks "On customer account", **Then** a client must be chosen before saving.
4. **Given** any of the in-scope sales, **When** the owner picks a payment, **Then** only "On customer account", "Whish app", "OMT app" and "Binance" are offered — never cash.

---

### User Story 3 - After-hours sales count on the day they happened, and the morning count already includes them (Priority: P1)

The owner records two sales at 22:00 and one at 00:30. In the reports, the 22:00 sales count in yesterday's local date and the 00:30 sale in today's, on every page (Transactions, Profits, Dashboard, daily stats). Yesterday's closing PDF is unchanged. Next morning the cashier counts the drawers: the expected Whish app, OMT app, Binance and voucher amounts already include all three sales, so the count matches. The count screen shows "3 sales since the last count" with the list.

**Why this priority**: The money must reconcile next morning, and an after-midnight sale must land on the same date everywhere. Today some pages group by the server's UTC date, so a 00:30 Beirut sale would show on different days on different pages.

**Independent Test**: Count the drawers. Record sales at 22:00 and 00:30 local time. Check every report page puts each on its local date, the saved closing is unchanged, and the next count's expected amounts include all of them with no difference.

**Acceptance Scenarios**:

1. **Given** a drawer was counted, **When** sales are recorded afterwards, **Then** the saved closing (its counted amounts, difference and PDF) does not change.
2. **Given** sales were recorded after the last count, **When** the drawers are counted again, **Then** the expected amounts include those sales and the count screen lists the sales made since the last count.
3. **Given** a sale at 00:30 local time, **When** it is saved, **Then** it carries that local date, and the Transactions page, Profits, Dashboard and daily stats all count it on that date.
4. **Given** a sale at 22:00 local time, **When** that day's reports are viewed later, **Then** the sale is included in that day.
5. **Given** the day is open, **When** the owner records a sale from the phone, **Then** it is treated exactly like a sale recorded on the web app.

---

### User Story 4 - Owner tracks after-hours sales and balances from the phone (Priority: P2)

Before saying yes to a customer at night, the owner checks on the phone: "Do I have enough Whish app balance? How much Katch credit is left?" Later the owner looks at "Tonight's sales" to see what was done, for whom and how it was paid.

**Why this priority**: The customer asked to *track* these sales, not only enter them. Seeing balances also prevents accepting a sale the owner cannot fulfil. It is useful only once Story 2 exists.

**Independent Test**: Record a few sales after closing, then open the tracking screen on a phone-sized screen and check the list and the balances against the records.

**Acceptance Scenarios**:

1. **Given** sales were recorded after closing, **When** the owner opens the tracking screen, **Then** each sale shows time, type, client, amount and how it was paid.
2. **Given** any time, **When** the owner opens the balances view, **Then** it shows the current Whish app, OMT app, Binance and voucher credit balances.
3. **Given** a sale was put on a customer's account, **When** the owner opens that client, **Then** the client's current total debt is shown.

---

### User Story 5 - Owner records a customer repayment received by wallet (Priority: P3)

The next evening Hassan pays his $50 into the owner's Whish wallet. The owner records the repayment from the phone, against Hassan's account, paid into the Whish app. Hassan's debt goes down and the Whish app balance goes up.

**Why this priority**: It closes the loop opened by "On customer account" without waiting for the shop to open. It can wait until Stories 2–4 are in use.

**Independent Test**: With a client who owes money, record a repayment paid into the Whish app from a phone-sized screen. Check the debt and the Whish app balance against a repayment recorded at the counter.

**Acceptance Scenarios**:

1. **Given** a client owes money, **When** the owner records a repayment paid into a wallet, **Then** the client's debt goes down and that wallet's balance goes up by the same amount.
2. **Given** a repayment is recorded at night, **When** reports are viewed, **Then** it counts on the local date it was recorded, like sales.

---

### Edge Cases

- **A drawer is counted while the owner is saving a sale on the phone.** The count uses the balance at the moment it is saved; the sale is either inside it or listed as "since the last count" — never lost and never counted twice.
- **Around midnight.** The date is decided when the sale is saved, from the phone's local time.
- **Not enough wallet or voucher balance.** The phone shows the same warning or refusal that the counter shows for the same sale.
- **No internet on the phone.** The sale is not saved and the owner is told clearly. Nothing is queued silently to be sent later.
- **The same sale is submitted twice** (double tap, weak signal and retry). Only one sale is recorded.
- **A staff (non-admin) user signs in.** They are refused.
- **A mistake recorded after closing.** The owner can void or refund it through the existing void/refund flow. The reversal counts on the day it is made and undoes every balance the sale moved — customer debt, wallet, voucher credit.
- **The phone's clock is wrong by hours or days.** A date far from the server's time is refused rather than accepted.
- **The same username exists in several shops.** Usernames are unique only inside one shop, so "admin" can exist in many. Resolved: the owner enters the shop address first, and the username is only looked up inside that shop.
- **Unknown shop address.** Refused with the same generic message as a wrong password, so the reply does not confirm which shop addresses exist.
- **Many wrong passwords.** Repeated failed sign-ins are slowed down or blocked the same way as on the web app, and the reply never reveals which shops have that username.
- **The phone is lost.** The owner can end the phone's session from the web app (or by changing the password), and the app then asks to sign in again.
- **Desktop-app shops.** Their data lives on the shop's PC, so the phone cannot see it. They are not offered the mobile app.

## Requirements *(mandatory)*

### Functional Requirements

**Recording sales from the phone**

- **FR-001**: The owner MUST be able to record, from a phone-sized screen, each in-scope sale: Whish App transfer, OMT App transfer, iPEC voucher and Katch voucher.
- **FR-002**: Each in-scope sale recorded from the phone MUST move exactly the same balances, charge the same fees and record the same profit as the same sale recorded on the web app at the counter.
- **FR-003**: The payment choice MUST be one of: on customer account, Whish app, OMT app, Binance. Cash MUST NOT be offered.
- **FR-004**: A client MUST be chosen when the payment is "on customer account". It MAY be chosen for the other payments. When a client is chosen, the sale MUST be linked to that client everywhere it appears.
- **FR-005**: Sales that need a physical hand-over MUST NOT be offered in the mobile screens: OMT/Whish counter services, exchange, POS sales and maintenance.
- **FR-006**: The owner MUST be able to record a customer repayment paid into a wallet (Story 5).

**Which day a transaction belongs to**

- **FR-007**: Every transaction MUST count on the shop's local calendar date on which it was recorded, whatever device recorded it.
- **FR-008**: Every report that groups by day (Transactions page, Profits, Dashboard, daily stats) MUST use the shop's local date, so the same transaction falls on the same date on every page.
- **FR-009**: A saved closing (counted amounts, difference, PDF) MUST NOT change because of transactions recorded after it.
- **FR-010**: When drawers are counted, the expected amounts MUST include every transaction since the last count, and the count screen MUST list the transactions recorded since the last count.
- **FR-011**: Each transaction MUST carry the shop's local date and time as sent by the device. The server's own clock is only a fallback. For writes from the phone app, a device date more than one day from the server's date MUST be refused; web and desktop behaviour is unchanged.
- **FR-012**: (Retired 2026-10-08 — there is no business day to show; the date is simply the local date.)

**Tracking**

- **FR-013**: The owner MUST be able to list, on the phone, the transactions recorded since the last count (and by date), with time, type, client, amount and payment.
- **FR-014**: The owner MUST be able to see, on the phone, the current balances of the Whish app, OMT app and Binance wallets and of the voucher credits.
- **FR-015**: The owner MUST be able to see a client's current total debt on the phone.

**Access and reliability**

- **FR-016**: Only users with the admin role MUST be able to use the mobile screens and the actions behind them.
- **FR-017**: A transaction MUST NOT be recorded twice when the same submission is sent more than once.
- **FR-018**: When the phone has no connection, the owner MUST be told that the transaction was not saved.
- **FR-019**: The app MUST be installable from Google Play (Android) and the App Store (iOS), from one shared app codebase.

**Signing in and choosing the shop**

- **FR-022**: The owner MUST be able to sign in with Google, using the same Google connection already set up for the web app — no separate setup.
- **FR-023**: The owner MUST be able to sign in with shop address, username and password. The shop is found from the address first; the username and password are then checked in that shop only, never across shops.
- **FR-024**: Google sign-in MUST open the shop where that Google account is connected to an admin, without asking for a shop address. The phone MUST remember the shop address used for password sign-in.
- **FR-025**: Google sign-in MUST be refused, with a reason, when the account is connected to no admin, to admins in more than one shop, or only to staff users. No shop list is shown.
- **FR-029**: The app MUST offer "Create your shop": it takes an email and sends the existing sign-up link; the rest of sign-up happens on the web, unchanged.
- **FR-026**: After sign-in, every read and write MUST go to that shop's data only, wherever the platform stores it (shared database or one database file per shop).
- **FR-027**: Sign-in MUST stay valid across app restarts until it expires, the owner signs out, or the session is ended from the web app.
- **FR-028**: Sign-in failures MUST NOT reveal whether a username or Google account exists in any shop.

**Scope**

- **FR-020**: The mobile app MUST work for web-app shops. Desktop-app shops are out of scope until their data is reachable from outside the shop.
- **FR-021**: The day rule (FR-007 to FR-011) MUST behave the same on the desktop app and the web app.

### Key Entities

- **Day**: the shop's local calendar date. Every transaction counts on the local date it was recorded.
- **Drawer count (checkpoint)**: a count of one drawer; it resets that drawer's balance to the counted amount and is frozen once saved. "Since the last count" means since the most recent count of the drawers involved.
- **Mobile sale**: one in-scope sale (Whish App, OMT App, iPEC, Katch) with a client (optional unless on account), an amount, a payment choice and a local date and time.
- **Payment choice**: on customer account, Whish app wallet, OMT app wallet or Binance wallet.
- **Wallet and voucher balances**: the amounts LiraTek tracks for the Whish app, OMT app, Binance and each voucher provider's credit.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The owner can record an after-hours Whish App transfer on a customer's account from the phone in under 1 minute.
- **SC-002**: For every in-scope sale type and every payment choice, a sale recorded from the phone and the same sale recorded at the counter give identical balances, debt, fees and profit (0 difference in each currency).
- **SC-003**: In every test where sales are recorded after a count, the saved count is identical before and after (0 changes).
- **SC-004**: The next morning's expected wallet and voucher balances match the recorded sales, so the opening count shows no difference caused by after-hours sales.
- **SC-005**: A sale recorded between 00:00 and 03:00 local time carries the local date, and appears on that date on every report page, in 100% of cases.
- **SC-006**: Staff (non-admin) users are refused in 100% of attempts.
- **SC-007**: The customer who asked for this records his after-hours requests in LiraTek instead of on paper or in memory, confirmed with him after two weeks of use.
- **SC-008**: The owner can install the app and sign in to the right shop in under 2 minutes, on both Android and iOS.
- **SC-009**: In 100% of sign-in tests across two or more shops, the app opens the correct shop and shows no other shop's data.

## Assumptions

- Closing is a per-drawer count against a live running balance (confirmed in planning research), so FR-009 and the "expected includes" half of FR-010 already hold; they need tests, not new rules. The new work is the "since the last count" list and making every day-grouped report use the local date (FR-008).
- The in-scope sales, their fees, profit and client handling already exist on the web app; the phone reuses them rather than defining new money rules.
- The Whish app, OMT app and Binance wallets, and the voucher credits, are already tracked as balances in LiraTek.
- The app is a separate phone app (Expo, owner constraint), so its screens are new. It reuses the existing server, money rules and sign-in accounts; it does not reuse the web app's screens. Push notifications are a later step.
- **Builds on LIRA-288 (shipped 2026-10-08, `aa685eae`).** The same Gmail may now be a user in several shops (one user per shop), so the phone must open only the shop where that account is the **owner** and refuse otherwise (FR-025). Creating a shop still allows one shop per email, so a second owned shop is rare but possible (being invited as admin elsewhere). The platform sign-in directory now finds a Google account's shops in both database modes, so FR-026 has no database-mode limit. Owners who joined with Google only have no password; they use Google on the phone.
- **Sessions per device.** Since LIRA-288, signing in again on the same browser ends that browser's previous session. The phone app must count as its own device: signing in on the phone must not end the owner's web sessions, and signing in again on the phone ends only the phone's previous session. The phone appears in Settings → Signed-in Devices like any other device.
- **No Sign in with Apple at this stage** (owner decision). Likely, based on Apple's review rule 4.8: an app that offers its own username/password sign-in alongside Google does not have to add Sign in with Apple, because the third-party sign-in is not the only option. To be confirmed at the first iOS review.
- An owner who signs up by email has no Google connected, so they sign in on the phone with shop address, username and password, or connect Google in web Settings first.
- Likely, based on Apple's account-deletion rule: because the app starts account creation, it must also offer a way to delete the account (a link to the web is expected to be enough). To be confirmed before submission.
- The phone app needs its own Google sign-in setup (separate app registrations for Android and iOS) and the server must accept a sign-in coming from the phone app, not only from a web page. This is new server work.
- Publishing needs Apple and Google developer accounts and store review; LiraTek's existing privacy policy page is used for the store listings.
- The phone needs an internet connection. Offline recording is out of scope.
- MTC/Alfa recharge from the phone is out of scope for this version. It can be added once the owner confirms it is done from a phone. Binance is in scope as a way of being paid, not as a sale type.
- Voiding or refunding a mistake uses the existing void/refund flow. No new reversal flow is added, and the reversal counts on the day it is made.
- Staff use of the mobile screens is out of scope for now.
- Exception to "every feature works on desktop and web": the phone app talks only to the online (web) system, because desktop shops' data is not reachable from a phone. The day rule (FR-021) still applies to both.
