# Feature Specification: Phone app bottom tabs

**Feature Branch**: `300-mobile-bottom-tabs` (work happens on `main`; ticket LIRA-300)

**Created**: 2026-10-10

**Status**: Draft

**Input**: User description: "Phone app bottom tab navigation: split the LiraTek phone app into one page per section behind a bottom tab bar (Home / Sell / Debts / Activity / Settings) instead of a burger menu; each tab loads only its own data; keep the last data so switching tabs shows it at once and refreshes it in the background. Follow-up of LIRA-289."

## Context

The first phone version (LIRA-289) has one home screen that loads three things at once when it opens: the wallet and
drawer balances, the latest transactions, and "since the last count". Selling, customer debts and settings are
separate screens, reached from buttons on home. Every time the owner comes back to home, all three loads run again
and the screen waits for the slowest one.

The owner asked for a menu that splits the app into pages, so each page opens faster. A bottom tab bar was chosen over
a burger menu: the app has five main sections, and a tab bar keeps every one of them one tap away and always visible.

What does NOT change: what the phone can do (record Whish App / OMT App transfers, see and collect customer debts,
see balances and recent activity, change the theme, sign out), who can use it (admins only), and how money is booked.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Move between sections with one tap (Priority: P1)

The owner opens the app and sees a bar at the bottom of the screen with five sections: Home, Sell, Debts, Activity
and Settings. One tap opens any section. The current section is highlighted.

**Why this priority**: it is the navigation itself; every other story depends on it.

**Independent Test**: sign in, tap each of the five tabs in turn, and confirm each opens its own page and the tapped
tab is highlighted.

**Acceptance Scenarios**:

1. **Given** the owner has signed in, **When** the app opens, **Then** the Home tab is shown and highlighted, and the
   bar shows Home, Sell, Debts, Activity and Settings with an icon and a label each.
2. **Given** the owner is on any tab, **When** they tap another tab, **Then** that tab's page opens and becomes the
   highlighted tab.
3. **Given** the owner is inside a detail page opened from a tab (a customer's debt, or a transfer form), **When**
   they tap that same tab again, **Then** they return to the top page of that tab.
4. **Given** the owner is signed out, **When** the sign-in page shows, **Then** no tab bar is shown.

---

### User Story 2 - Each page loads only what it shows (Priority: P1)

Each tab loads only its own information, and only when the owner opens it for the first time. Home shows balances
and "since the last count"; Activity shows the latest transactions; Debts shows the customers who owe; Sell needs no
data until a transfer is started.

**Why this priority**: this is the speed gain the owner asked for.

**Independent Test**: sign in and stay on Home; confirm that only Home's information was requested. Open Activity;
confirm the latest transactions are requested at that moment and not before.

**Acceptance Scenarios**:

1. **Given** the owner has just signed in, **When** Home opens, **Then** only balances and "since the last count" are
   loaded; the latest transactions and the debt list are not.
2. **Given** the owner has never opened Debts in this session, **When** they open it, **Then** the debt list loads
   then, with a loading indicator until it arrives.
3. **Given** one section fails to load (no connection, server error), **When** the owner opens another section,
   **Then** that other section loads and works normally.

---

### User Story 3 - Coming back to a page shows the last data at once (Priority: P2)

When the owner returns to a tab they have already opened, the page shows what it showed last time immediately, and
quietly refreshes it in the background. Once the fresh data arrives, the page updates in place.

**Why this priority**: it removes the wait on every return; without it, splitting pages only moves the wait around.

**Independent Test**: open Home, then Activity, then Home again; confirm Home's balances appear with no loading
indicator and then update if they changed.

**Acceptance Scenarios**:

1. **Given** the owner has opened Home before, **When** they come back to Home, **Then** the last balances show at
   once, without a full-page loading indicator, while fresh balances load.
2. **Given** a background refresh fails, **When** the owner is on that page, **Then** the last data stays visible and
   a short notice says it could not be refreshed.
3. **Given** the owner pulls down on a page, **When** they release, **Then** that page reloads its data and shows the
   usual refresh indicator.

---

### User Story 4 - After a sale or repayment, every page agrees (Priority: P2)

After the owner records a transfer or a repayment, the pages it affects show the new state the next time they are
seen: the wallet balances on Home, "since the last count", the latest transactions on Activity, and the customer's
debt on Debts.

**Why this priority**: showing a stale balance right after a sale would make the owner doubt the sale was booked,
and could lead to recording it twice.

**Independent Test**: note the Whish App balance on Home, record a Whish App transfer from Sell, then open Home and
Activity; confirm the balance moved and the transfer is listed.

**Acceptance Scenarios**:

1. **Given** the owner records a transfer, **When** they next open Home, **Then** the affected wallet balance and
   "since the last count" include the transfer.
2. **Given** the owner records a transfer, **When** they next open Activity, **Then** the transfer is listed.
3. **Given** the owner records a transfer on a customer's account, or a repayment, **When** they next open Debts or
   that customer's page, **Then** the customer's debt reflects it.

---

### User Story 5 - Signing out forgets the shop's data (Priority: P3)

When the owner signs out, nothing from the shop stays visible or kept on the phone's screens; signing in again
(possibly to another shop) starts with no leftover data.

**Why this priority**: keeping data between pages must not leak one shop's numbers into the next sign-in.

**Independent Test**: sign in to shop A, open every tab, sign out, sign in to shop B; confirm no page ever shows shop
A's balances, transactions or debtors, even briefly.

**Acceptance Scenarios**:

1. **Given** the owner signs out, **When** the sign-in page shows, **Then** all kept page data is discarded.
2. **Given** the session expires while the app is open, **When** the owner is sent back to sign-in, **Then** all kept
   page data is discarded the same way.

---

### Edge Cases

- No connection on first open of a tab: the page shows the same "no connection" message the app shows today, with a
  way to retry; other tabs are unaffected.
- The owner taps a tab several times quickly: it opens once; no duplicate loads pile up.
- A transfer form is half filled and the owner switches tabs: when they come back to Sell, the form is as they left
  it (switching tabs is not cancelling).
- A save is in progress (transfer or repayment) and the owner switches tabs: the save finishes; it is booked once
  (the existing double-submission guard still applies).
- The app returns from the background after a long time: data older than a short limit is refreshed when the page is
  next shown.
- Keyboard open on a form: the tab bar does not cover the input or the Save button.
- Small phones and large text settings: tab labels stay readable and do not overlap.
- Theme changes (dark / light / system) apply to the tab bar too.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The app MUST show a bottom tab bar with exactly five tabs, in this order: Home, Sell, Debts, Activity,
  Settings. Each tab has an icon and a text label.
- **FR-002**: The tab bar MUST be shown only after sign-in, and on every top page of a tab. Detail pages opened from a
  tab (customer page, transfer form) MAY keep the bar visible.
- **FR-003**: Home MUST show the wallet and drawer balances and "since the last count", and a short link to Activity
  for the latest transactions. Home MUST NOT load the latest transactions list or the debt list itself.
- **FR-004**: Sell MUST list the phone sales: Whish App transfer and OMT App transfer open the transfer form; the
  voucher entries keep their current "Coming next" notice.
- **FR-005**: Debts MUST show the customers who owe, and open a customer's page with their balance and the repayment
  form, as today.
- **FR-006**: Activity MUST show the latest transactions, as Home shows them today.
- **FR-007**: Settings MUST hold the appearance choice (dark / light / system), sign out, and the delete-account link,
  as today.
- **FR-008**: Each tab MUST load its data only when first opened, not when the app starts.
- **FR-009**: A page the owner has already opened MUST show its last data at once on return, and refresh it in the
  background when it is older than a short limit (default: 30 seconds).
- **FR-010**: A failed background refresh MUST keep the last data on screen and show a short notice; it MUST NOT
  replace the page with an error.
- **FR-011**: Pull-to-refresh MUST be available on Home, Debts, Activity and a customer's page, and MUST reload that
  page's data.
- **FR-012**: A recorded transfer MUST mark balances, "since the last count", latest transactions and (when the
  customer is involved) debts as out of date; a recorded repayment MUST mark balances, "since the last count", latest
  transactions, the debt list and that customer's balance as out of date. Out-of-date pages refresh when next shown.
- **FR-013**: Sign-out and session expiry MUST discard all kept page data before the sign-in page shows.
- **FR-014**: Switching tabs MUST NOT discard a half-filled transfer or repayment form.
- **FR-015**: The tab bar MUST follow the selected theme and the shop's colours used elsewhere in the app.
- **FR-016**: Behaviour of every money action MUST stay exactly as today: same data sent, same double-submission
  guard, same messages.

### Key Entities

- **Tab**: one of the five sections; has a name, an icon, a top page, and optionally detail pages under it.
- **Kept page data**: the last loaded result of one page's request (balances, since-last-count, latest transactions,
  debt list, one customer's balance), with the time it was loaded. Lives only in the running app and only while
  signed in.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every section is reachable in one tap from any top page.
- **SC-002**: On first sign-in, Home makes 2 data requests instead of 3.
- **SC-003**: Returning to an already opened tab shows its content in under 0.3 seconds with no full-page loading
  indicator, on the test Android phone.
- **SC-004**: After a transfer is recorded, the next visit to Home and Activity shows it in 100% of attempts.
- **SC-005**: After sign-out and sign-in to a different shop, no page shows the previous shop's data, in 100% of
  attempts.
- **SC-006**: All money tests from LIRA-289 still pass unchanged.

## Assumptions

- Settings is a full tab, not a gear icon in a corner (owner agreed to the five-tab list on 2026-10-10).
- Data is kept in memory only while the app runs; nothing new is stored on the phone's disk. Offline use stays out of
  scope.
- "Short limit" for freshness is 30 seconds; pull-to-refresh is always available to force a reload.
- No server, core, web or desktop change is needed: every page uses requests the phone already makes.
- Voucher sales stay "Coming next" (LIRA-289 owner decision).
- The phone's speed is checked on the owner's Android test phone and the iPhone simulator; no formal benchmark tool.
