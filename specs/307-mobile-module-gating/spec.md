# Feature Specification: Phone app follows the shop's module switches

**Feature Branch**: `307-mobile-module-gating` (work happens on `main`; ticket LIRA-307)

**Created**: 2026-10-11

**Status**: Draft

**Input**: User description: "Gate the mobile app modules the same way the web app gates them (Settings → Modules)."

## Context

The web and desktop apps hide a module everywhere it has an entry point when the shop switches it off in
Settings → Modules: the home grid, the sidebar, and the drawer cards on the Dashboard. The phone app (LIRA-289/300/302)
ignores those switches: its Sell and Debts tabs and every drawer line on Home always show. A shop that never turned on
iPick/Katsh still sees four sales on the phone.

On the web, all four phone sales (Whish App transfer, OMT App transfer, Katsh voucher, iPick voucher) sit under ONE
module switch, `ipec_katch` ("iPick/Katsh"): `frontend/src/features/recharge/types/index.ts` gives each of those
providers `module: "ipec_katch"`. The Debts tab corresponds to `debts` ("Accounts"). Activity, Home and Settings are
system modules and are always on.

**Owner decisions (2026-10-11):**

- **D1 — Copy the web exactly.** All four phone sales follow `ipec_katch`, the same as the web Recharge tabs. (Whether
  the Whish App / OMT App sales should follow `omt_whish` instead is a separate question for both apps, not this
  ticket.)
- **D2 — Hide the Sell tab when no sale is on.** A switched-off module has no entry point, as on the web.
- **D3 (revised 2026-10-11, replaces "fail closed"):** a missing connection hides nothing. Only a switch turned off
  on the web hides a tab, and to know that the phone must be connected. Before the first successful check every tab
  shows; once checked, switched-off tabs stay hidden even if the connection drops. Tab content needs a connection:
  while the phone cannot reach the server, Home, Sell, Debts and Activity show "No internet connection — Please
  connect to the internet to see this page" with a Try again button (and retry every 5 s). Settings always works.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Switched-off sales disappear from the phone (Priority: P1)

The owner's shop has iPick/Katsh switched off. On the phone the Sell tab is not in the tab bar; the owner cannot reach
any of the four sales.

**Why this priority**: it is the point of the feature; today the phone offers sales the shop has turned off.

**Independent Test**: switch iPick/Katsh off on the web, open the phone app: tab bar shows Home, Debts, Activity,
Settings only.

**Acceptance Scenarios**:

1. **Given** `ipec_katch` is off, **When** the owner opens the phone app online, **Then** the Sell tab is not shown.
2. **Given** `ipec_katch` is on, **When** the owner opens the phone app online, **Then** the Sell tab shows all four
   sales, as today.

---

### User Story 2 - Switched-off Accounts disappears from the phone (Priority: P1)

**Why this priority**: same rule as Story 1 for the other gated tab.

**Independent Test**: switch Accounts off on the web, open the phone app: no Debts tab.

**Acceptance Scenarios**:

1. **Given** `debts` is off, **When** the owner opens the phone app online, **Then** the Debts tab is not shown.
2. **Given** `debts` is on, **Then** the Debts tab shows, as today.

---

### User Story 3 - Home shows only the drawers of switched-on modules (Priority: P2)

**Why this priority**: matches the web Dashboard, which hides drawer cards of switched-off modules.

**Independent Test**: switch Binance off on the web; the Binance line disappears from Home → Drawer balances on both
the web Dashboard and the phone.

**Acceptance Scenarios**:

1. **Given** a module that owns a drawer is off, **When** Home loads, **Then** that drawer's line is hidden in Drawer
   balances and in Since last count.
2. **Given** a drawer no module owns (till cash, unknown drawers), **Then** it always shows.

---

### User Story 4 - No connection means no gated parts (Priority: P1)

**Why this priority**: owner decision D3; offline must never open a switched-off module.

**Independent Test**: cold-start the phone app in airplane mode: only Home, Activity and Settings in the tab bar, and
no gated drawer lines.

**Acceptance Scenarios**:

1. **Given** the app starts with no connection, **Then** Sell and Debts are hidden and gated drawer lines are hidden,
   whatever the switches are.
2. **Given** the app started offline, **When** the connection returns and the app next comes to the foreground (or
   the owner pulls to refresh on Home), **Then** the switched-on parts appear without restarting the app. The phone
   does not watch the network itself (no NetInfo / `onlineManager`); it re-checks on foreground, like every other read.
3. **Given** the list loaded earlier in this run, **When** the connection drops, **Then** the phone keeps the list it
   verified in this run.

---

### Edge Cases

- A switch flips on the web while the phone is open on that tab: when the phone next refreshes the list (app back to
  the foreground), the tab disappears and the phone moves to Home. No half-filled sale is kept.
- A module is switched on but not in the shop's plan (entitlement): the server already leaves it out of the enabled
  list, so the phone hides it.
- Sign-out / switching shop: the list is cleared with the rest of the phone's cache; the next shop starts unverified.
- The server returns an error or an unexpected shape: treated as "not verified" (fail closed), the same as no connection.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The phone MUST read the shop's enabled modules from the same source the web uses
  (`GET /api/modules/enabled`), so one switch controls both apps.
- **FR-002**: The Sell tab MUST show only when `ipec_katch` is in the verified list (D1, D2).
- **FR-003**: The Debts tab MUST show only when `debts` is in the verified list.
- **FR-004**: Home's drawer lines MUST be filtered by the same drawer-to-module rule the web Dashboard uses
  (`isDrawerVisible` in `packages/core/src/constants/drawerModules.ts`), applied to the verified list.
- **FR-005**: Until the list is verified in the current run of the app, every gated part MUST be hidden (D3). The list
  MUST NOT be stored on the device between runs.
- **FR-006**: The list MUST be refreshed when the app comes back to the foreground, so a switch flipped on the web
  reaches the phone without a restart.
- **FR-007**: If the tab on screen becomes hidden, the phone MUST move to Home.
- **FR-008**: Home, Activity and Settings MUST always show.

### Key Entities

- **Enabled module list**: the shop's switched-on, plan-entitled modules, as the server returns them; only the `key`
  of each entry matters to the phone.
- **Gate state**: `unverified` (nothing gated shows) or `verified` with the set of enabled keys.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: For every combination of `ipec_katch` and `debts` on/off, the phone's tab bar matches the web's home
  grid (4 of 4 combinations checked).
- **SC-002**: Cold start with no connection shows zero gated parts.
- **SC-003**: The drawer lines on the phone's Home match the drawer cards on the web Dashboard for the same shop.

## Assumptions

- Hiding is the whole gate, as on the web: the server does not refuse a sale for a switched-off module. A request made
  outside the app still goes through. Server-side refusal would be a separate ticket for both apps.
- Paying "on account" stays available when Accounts is off, as on the web.
- The phone is owner-only (LIRA-289), so `admin_only` modules need no extra rule.
