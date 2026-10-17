# Feature Specification: Arabic app UI

**Feature Branch**: `main` (owner works on main)
**Ticket**: LIRA-331
**Created**: 2026-10-17
**Status**: Draft
**Input**: User description: "Arabic app UI. The LiraTek app (desktop Electron app, web app, and the owner phone app in mobile/) is English-only today; only the landing page (landing/ar.html) has Arabic. Add a full Arabic translation of the app with right-to-left layout, switchable per user, alongside English. Competitors Table, Sandooq, MAPOS and Managely all offer Arabic. Must work on desktop and web (dual transport). Receipts/printouts: decide whether they follow the UI language. Reuse the landing page's Arabic wording/terms (landing/ar.html) for consistency (e.g. محل خليوي, الصناديق, الفكّة)."

## Background

Every screen of the desktop app, the web app and the owner phone app is in English. The only Arabic LiraTek has is the public Arabic landing page, so a shop owner can be invited to LiraTek in Arabic and then land in an English-only app. The four competitors named above all offer Arabic. Many cashiers in Lebanese mobile shops are more comfortable reading Arabic, especially for money words (change, drawers, debts, closing).

Today nothing in the apps can show a second language. The one display choice a user can make, light or dark theme, is kept on the device only and does not follow the user to another device. Messages that come back from the shop's server (for example "insufficient balance" or a sign-in refusal) arrive as English sentences. Receipts are built in English for 58 mm and 80 mm thermal printers.

## Clarifications

### Session 2026-10-17

- Q: Digits (FR-016) — Western digits (0-9) everywhere, or Arabic-Indic digits (٠-٩) in Arabic? → A: Western digits (0-9) everywhere, also in the Arabic UI. Typing Arabic-Indic digits in amount fields is still accepted (FR-017).
- Q: "What's new" and release notes (FR-012) — translated into Arabic every release, or English-only? → A: English-only for now; revisit if Arabic users ask.
- Q: Receipt language (FR-021, User Story 3) — accept the spec's decision of one shop "receipt language" setting, default English? → A: Accepted as written.
- Q: Does a user's language choice sync between the desktop app and the web app? → A: No; accepted as written in Assumptions (separate accounts, per-user within each app).

## User Scenarios & Testing _(mandatory)_

### User Story 1 - A cashier works the whole day in Arabic on desktop or web (Priority: P1)

A cashier opens Settings, chooses العربية, and the whole app switches to Arabic, laid out right to left: the side menu moves to the right, tables read from the right, forms and buttons are mirrored. They sell at the POS, record an OMT send, top up an MTC line, take a debt payment, count the drawers and close the day without meeting an English label, button, hint, empty-state text, confirmation or error message.

**Why this priority**: this is the feature. Without it nothing else in this spec has value.

**Independent Test**: as a user set to Arabic, walk the day's main flows (sale with change, OMT/Whish send and receive, recharge, debt sale and repayment, expense, drawer count, closing) on the web app and on the desktop app. Every visible text is Arabic and the layout is right to left; the saved transactions are identical to the same flows done in English.

**Acceptance Scenarios**:

1. **Given** a user set to English, **When** they choose Arabic in their settings, **Then** the app switches to Arabic and right-to-left at once, without signing out and without losing what is typed on the current screen.
2. **Given** a user set to Arabic, **When** they make a sale paid in USD with change in LBP, **Then** the amounts, currencies, change and drawer movements saved are exactly the same as for the same sale made in English.
3. **Given** a user set to Arabic, **When** the server refuses an action (for example not enough balance, wrong password, closed session), **Then** the message shown is in Arabic.
4. **Given** a user set to Arabic, **When** a word has an Arabic term on the landing page (محل خليوي, الصناديق, الفكّة, الديون, الإقفال, تشريج, الكفالة …), **Then** the app uses that same term.
5. **Given** a user set to Arabic, **When** they open any page from the side menu, **Then** no English text remains except brand and product names (LiraTek, OMT, Whish, MTC, Alfa, Binance, IMEI) and data typed by people.

---

### User Story 2 - Each person keeps their own language (Priority: P1)

The owner reads the app in English; the cashier prefers Arabic. Each one's choice belongs to their own user account: whenever the cashier signs in, the app opens in Arabic; when the owner signs in on the same computer, it opens in English. On the web app, the choice follows the user to every browser and to the phone app, because they all use the same shop account online.

**Why this priority**: the request says "switchable per user". A shop-wide or device-wide switch would force one person's choice on the other.

**Independent Test**: on the desktop app, set user A to Arabic and user B to English and sign in as each in turn: each gets their own language. Repeat on the web app, then sign in as A from a second browser: A still gets Arabic.

**Acceptance Scenarios**:

1. **Given** user A chose Arabic on the web app, **When** A signs in to the web app from another device or browser, **Then** it opens in Arabic.
2. **Given** user A (Arabic) signs out on a shared shop computer, **When** user B (English) signs in, **Then** the app is in English for B.
3. **Given** nobody is signed in yet, **When** the sign-in screen is shown, **Then** it uses the language last used on that device, or, on a device never used before, the device's own language if it is Arabic and English otherwise; the user can switch it there before signing in.
4. **Given** a shop owner signed up from the Arabic landing page, **When** their account is created, **Then** their language starts as Arabic.
5. **Given** a new staff user is created, **When** they sign in the first time, **Then** their language is the shop's default language, which the admin can set.

---

### User Story 3 - Customer receipts in the language the shop chose (Priority: P2)

The shop prints a receipt for a sale, a repair or a session, or sends it to the customer. The receipt's language is a single shop setting chosen by the admin — English (the default) or Arabic — and does not depend on which cashier prints it, so every customer of the shop gets the same receipt. (Accepted by the owner on 2026-10-17.) An Arabic receipt reads right to left and prints correctly on both 58 mm and 80 mm thermal printers.

**Why this priority**: the request asks for this decision explicitly. Receipts go to customers, so a wrong choice is visible outside the shop, but the shop can work in Arabic without it.

**Independent Test**: print the same sale's receipt on 58 mm and 80 mm with the receipt language set to Arabic; every line is Arabic, readable, correctly ordered, nothing cut off, and all amounts equal those of the English receipt.

**Acceptance Scenarios**:

1. **Given** receipts are set to Arabic, **When** a sale is printed on a 58 mm printer, **Then** labels are Arabic, right to left, and item names, amounts, currencies, change and totals are all present and match the sale.
2. **Given** receipts are set to Arabic, **When** a receipt is reprinted from Transactions, **Then** it is in Arabic, whatever language the person reprinting uses.
3. **Given** a shop has not changed anything, **When** receipts are printed after this feature ships, **Then** they look exactly as they do today (English).

---

### User Story 4 - The owner phone app in Arabic (Priority: P3)

The shop owner switches the phone app to Arabic. Sign-in, the home screen, wallet and drawer balances, Whish App / OMT App transfers, client debts and the activity list are all in Arabic and right to left, using the same terms as the desktop and web apps.

**Why this priority**: the phone app is owner-only and smaller; it can follow once the desktop and web wording is settled, and reuses that wording.

**Independent Test**: on an Android phone, set the owner to Arabic; every screen of the phone app is Arabic and right to left; a transfer recorded in Arabic saves the same amounts as in English.

**Acceptance Scenarios**:

1. **Given** the owner chose Arabic on the web app, **When** they open the phone app signed in, **Then** it is in Arabic.
2. **Given** the phone app is in Arabic, **When** the server refuses a sign-in (wrong shop address, not an admin, Google account not connected), **Then** the refusal is shown in Arabic.

---

### Edge Cases

- **Mixed text**: a line holding Arabic labels with English data (a product name "iPhone 15 Pro", an IMEI, a phone number +961 3 123 456, an OMT reference) shows each part in its natural direction, without reversing digits or moving signs and currency symbols to the wrong side.
- **Amounts and signs**: negative amounts, "IN"/"OUT" direction, "$" and "LBP" markers and the minus sign stay attached to the correct number in right-to-left layout; an amount is never shown in a way that could be read as a different amount.
- **Typing numbers**: amount, phone and quantity fields accept the digits the user types, including Arabic-Indic digits from an Arabic keyboard, and save them as the same number.
- **Same figure, same digits**: amounts always show Western digits (0-9), in Arabic too, so a figure has one form across screen, receipt, export and phone app.
- **Long Arabic labels** in narrow places (table headers, buttons, the 58 mm receipt) do not overflow or hide amounts.
- **Data typed by people** (product names, client names, custom service names, categories, notes) is shown as typed and never translated.
- **Untranslated text**: if any text has no Arabic yet, it appears in English rather than as blank or as an internal key.
- **Switching mid-task**: switching language while a form, a cart, a session or an open modal holds unsaved input keeps that input.
- **Charts and timelines** (profits, dashboard, drawer timeline) read right to left in Arabic where order means time, and their labels and dates are Arabic.
- **Dates and times**: in Arabic, dates and times show Arabic month/day names; the calendar day itself is the same as in English (no shift caused by the language change).
- **Exports** (Excel/PDF reports) made by an Arabic user: column headings in the user's language; the numbers inside stay usable as numbers in a spreadsheet.
- **Offline desktop**: a desktop with no internet keeps the signed-in user's language.
- **Desktop after an update**: users who existed before the update have no language set and get the shop default (English unless changed).

## Requirements _(mandatory)_

### Functional Requirements

**Languages and switching**

- **FR-001**: The desktop app, the web app and the owner phone app MUST each offer two interface languages: English and Arabic.
- **FR-002**: Every signed-in user MUST be able to choose their own language from their settings, at any time, and the change MUST take effect immediately without signing out or losing unsaved input.
- **FR-003**: A user's language MUST belong to their user account, wherever that account is kept: on the desktop app it applies to every sign-in by that user on that shop's desktop data; on the web app it applies on every browser and device signed in to that shop, including the owner phone app. Choosing, saving and reading the language MUST work the same way on desktop and web.
- **FR-004**: The sign-in and sign-up screens MUST offer a language choice before sign-in, starting from the device's last used language (else the device's own language if Arabic, else English).
- **FR-005**: An admin MUST be able to set the shop's default language, used for staff users who never chose one. Shops that change nothing MUST keep English for everyone.
- **FR-006**: An owner who signs up from the Arabic landing page MUST start with Arabic as their language and as the shop default.

**Translation coverage**

- **FR-007**: In Arabic, every text the app itself shows MUST be Arabic: menus, page titles, labels, buttons, placeholders, hints, tooltips, table headers, filters, empty states, confirmations, toasts, validation messages, modals, settings, the setup wizard, sign-in and sign-up, and the phone app.
- **FR-008**: Messages that come from the shop's server and are shown to the user (refusals, validation errors, sign-in errors) MUST appear in the user's language on both desktop and web and in the phone app.
- **FR-009**: Names that are brands or official product names (LiraTek, OMT, Whish, MTC, Alfa, Binance, iPick, Katsh, IMEI and similar) MUST stay as they are. Text typed by users MUST never be translated.
- **FR-010**: The Arabic wording MUST reuse the terms of the Arabic landing page for the same ideas, and keep one term per idea across all three apps. The agreed glossary (at least: محل خليوي, الصناديق / الصندوق, الفكّة, الدولار والليرة, الديون / دفتر ديون الزبائن, الإقفال, الأرباح, تشريج رصيد وأيام, التصليحات, الكفالة, المخزون, المبيعات, الزبون, المورّد, المحفظة, العمولة, عدّ الصندوق) MUST be written down and used as the reference for all translated text.
- **FR-011**: Any text without an Arabic version MUST fall back to its English text, never to a blank or an internal key, and the missing Arabic MUST be detectable before release.
- **FR-012**: The "What's new" panel and release notes MUST stay English-only, in Arabic too; they are not translated for now (to be revisited if Arabic users ask).

**Right-to-left layout**

- **FR-013**: In Arabic, the whole layout MUST be right to left: navigation, page structure, tables (first column on the right), forms, modals, drawers/panels, tabs, steppers, pagination and direction icons (back/next arrows) mirrored.
- **FR-014**: Icons whose meaning does not depend on direction (cash, phone, printer, search, currency signs) MUST NOT be mirrored.
- **FR-015**: Numbers, amounts, phone numbers, IMEIs, serials and references MUST keep their digit order and sign in right-to-left text.

**Numbers, money and dates**

- **FR-016**: Numbers and amounts MUST be displayed with Western digits (0-9) everywhere, including when the language is Arabic, so the same figure looks the same on screen, receipts, exports and the phone app in both languages. Arabic-Indic digits (٠-٩) are never shown; they are only accepted as typed input (FR-017).
- **FR-017**: Number and amount fields MUST accept both Western and Arabic-Indic digits typed by the user and save the same value.
- **FR-018**: The language MUST change only how things are shown. Saved amounts, currencies, rounding, change, drawer movements, profits, ledgers, dates and calendar days MUST be identical whichever language the user uses.
- **FR-019**: How numbers and dates are formatted MUST be decided by the user's chosen language, never by the language or region settings of the computer, browser or server that happens to run the app, so the desktop app and the web app show the same thing for the same user.
- **FR-020**: Dates and times in Arabic MUST use Arabic month and day names; the date shown for a record MUST be the same calendar day as in English.

**Receipts, printouts and customer-facing text**

- **FR-021**: The language of printed receipts (sale, session, repair, loto, custom service, reprints from Transactions) and of text sent to customers (receipts or messages shared by WhatsApp) MUST follow one shop-level "receipt language" setting (English or Arabic), set by an admin, independent of the cashier's screen language.
- **FR-022**: An Arabic receipt MUST print right to left and remain complete and readable on both 58 mm and 80 mm thermal printers, from the desktop app and from the web app.
- **FR-023**: Shops that change nothing MUST get exactly today's English receipts.

**Reports and exports**

- **FR-024**: Report and export headings (Excel/PDF exports, closing report, profits) MUST be in the language of the user who produces them; numeric cells MUST remain numbers in a spreadsheet.

### Key Entities _(include if feature involves data)_

- **User language**: the interface language chosen by one user (English or Arabic). Belongs to the user's account; unset means "use the shop default".
- **Shop default language**: the language used for users who never chose one, and starting language for new staff. Set by an admin.
- **Receipt language**: a shop setting (English or Arabic, default English) used for receipts and customer-facing messages.
- **Arabic glossary**: the agreed list of Arabic terms for LiraTek's ideas, seeded from the Arabic landing page, used as the single reference for all translated text in the three apps.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: With a user set to Arabic, a walk through every page reachable from the side menu, every modal those pages open, sign-in and sign-up shows zero untranslated app texts (brand names and user data excepted), on both desktop and web.
- **SC-002**: The same scripted shop day (sale with change, OMT/Whish send and receive, recharge, debt sale and repayment, expense, drawer count, closing) run once in English and once in Arabic produces identical saved amounts, drawer balances, debts, profits and ledger totals per currency.
- **SC-003**: A user can switch language in under 10 seconds from any page, and the switch shows in under 1 second without losing unsaved input.
- **SC-004**: A user's language is in effect on 100% of their later sign-ins: on the same desktop for desktop users, and on any browser or the phone app for web users.
- **SC-005**: Every term in the glossary is used identically across the three apps and the landing page (zero conflicting translations of a glossary term).
- **SC-006**: An Arabic receipt prints with no missing, cut or reversed amount on both 58 mm and 80 mm printers.
- **SC-007**: At least one Arabic-preferring cashier completes a full day in Arabic without asking what a screen or button means.

## Assumptions

- The Arabic is plain Modern Standard Arabic with the everyday Lebanese shop words the landing page already uses (خليوي, تشريج, الفكّة); no separate Lebanese-dialect version.
- Only English and Arabic are in scope; French or other languages are not, but adding one later should not require redoing this work.
- The language is a display choice only. It grants no permission and changes no money behaviour; any user, staff or admin, may choose their own language.
- Brand and product names stay in Latin letters, as on the landing page ("OMT وWhish", "MTC وAlfa").
- Data typed by users (catalogue, clients, custom services, notes) is not translated and no Arabic copy of it is created.
- The desktop app and the web app keep separate user accounts (desktop data is local to the shop computer). A language chosen on the desktop app therefore does not reach the web app, or the reverse; the per-user promise applies within each. (Accepted by the owner on 2026-10-17.)
- The light/dark theme choice stays as it is today (per device); only the language is per user.
- Desktop and web ship together (dual transport is required); the phone app may follow in a later release using the same wording.
- The public landing pages (landing/index.html, landing/ar.html) are not changed by this feature beyond being the source of terms.
- Internal logs, audit trail entries and data stored in the database stay in English; only what is shown to people is translated.
- Arabic translation quality is reviewed by the owner (a native speaker) before release.

## Open Questions

None. All open questions were answered by the owner on 2026-10-17 (see Clarifications).
