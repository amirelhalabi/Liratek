# Research: Phone app follows the shop's module switches (LIRA-307)

## R1. What the web gates, exactly

- **Decision**: copy the web's three gates — nav entry points, drawer cards, nothing more.
- **Findings** (verified 2026-10-11):
  - `frontend/src/contexts/ModuleContext.tsx` loads `getEnabledModules()` once after sign-in and exposes
    `isModuleEnabled(key)`.
  - `HomeGrid.tsx:250` and `Sidebar.tsx:127` skip modules not in the list (and `admin_only` ones for staff).
  - `Dashboard.tsx:1007` filters drawer cards with `isDrawerVisible(name, isModuleEnabled)`.
  - There is no route guard (`App.tsx` has none) and no server check: nothing in `backend/src` reads `is_enabled`.
  - The Recharge page shows all its provider tabs unfiltered (`PROVIDER_CONFIGS`); the module switch only hides its
    home tile.
- **Alternatives considered**: server-side refusal of switched-off sales — rejected for this ticket (the web does not
  do it either; doing it for one app only would make the two disagree). Listed in spec Assumptions.

## R2. Which switch owns each phone sale

- **Decision**: all four phone sales follow `ipec_katch` (owner decision D1).
- **Findings**: `frontend/src/features/recharge/types/index.ts` sets `module: "ipec_katch"` on iPick, Katsh,
  WHISH_APP and OMT_APP.
- **Noted inconsistency, not fixed here**: `DRAWER_MODULE_OWNER` in `packages/core/src/constants/drawerModules.ts`
  gives the `Whish_App` / `OMT_App` drawers to `omt_whish`, not `ipec_katch`. So with `ipec_katch` on and `omt_whish`
  off, the Whish App sale shows but the Whish_App drawer line is hidden — on the web today, and on the phone after this
  ticket. Copying the web keeps the two apps in step; resolving it is a separate decision for both apps.

## R3. Source of the list

- **Decision**: `GET /api/modules/enabled` (`backend/src/api/modules.ts:25`).
- **Findings**: router-level `authenticateJWT`, no `requireRole`, so the owner's phone token works (the phone already
  calls other `authenticateJWT` routes). Response `{ success: true, modules: ModuleEntity[] }`. The service filters by
  `is_enabled = 1`, tenant, and plan entitlement (`ModuleService.getEnabledModules` → `filterByEntitlement`), so a
  switched-on but unentitled module is already absent.
- **Alternatives considered**: a new mobile-only endpoint — rejected: a second source could disagree with the web.

## R4. Fail-closed behaviour (owner decision D3)

- **Decision**: gate state is `unverified` until a fetch in this run succeeds with a well-formed list. The list lives
  only in the in-memory TanStack Query cache (`mobile/src/data/queryClient.ts` has no persister), so a cold start
  always begins unverified. Errors, `NO_CONNECTION`, and malformed responses all leave it unverified. Once verified, a
  later failed refetch keeps the verified list (TanStack keeps `data` on refetch error).
- **Rationale**: the owner's rule is "gated until verified, needs wifi". In-memory-only meets "not between runs"
  without extra code.
- **Alternatives considered**: persisting the list for offline starts — rejected by D3.

## R5. Refresh timing

- **Decision**: `staleTime: 0` for this query; refetch on app foreground (already wired: `focusManager` in the root
  layout, `refetchOnWindowFocus` default true). Retry policy unchanged (`queryClient.ts`).
- **Rationale**: a switch flipped on the web should reach the phone the next time the owner opens it; the call is tiny.

## R6. Hiding a tab in NativeTabs

- **Decision**: `NativeTabs.Trigger hidden={!enabled}`.
- **Findings**: `expo-router/build/native-tabs/types.d.ts:279-285`: "If true, the tab will be hidden from the tab bar
  … cannot be navigated to in any way."
- **Open (verify during build)**: what NativeTabs does when the tab on screen becomes hidden. FR-007 is met either
  way by an explicit `router.replace` to Home when the active tab's gate turns off; the simulator check in
  quickstart.md covers it.

## R7. Drawer filtering on Home

- **Decision**: reuse `isDrawerVisible` from `@liratek/core/constants/drawerModules` (the phone already imports core
  source through Metro's mapping, e.g. `@liratek/core/utils/formatMoney`).
- **Findings**: `drawerModules.ts` has no imports at all, so it is safe for the phone bundle (same reason it is safe
  for `browser.ts`, rule 29). Unknown drawers and till cash are ungated (`moduleOwningDrawer` returns null) — the
  "show, don't hide money" direction.
- **Unverified state**: `isModuleEnabled` returns false for every key, so `isDrawerVisible` hides every owned drawer
  and still shows till cash — what D3 asks.

## R8. Constitution scope

- Phone-only, read-only change: no money flow (§IV not triggered), no new schema/route/migration (§III, §V not
  triggered). Rule 19 (dual transport) concerns the web/desktop frontend; the phone already uses REST only and gains no
  desktop path. Testing rule 17 applies to the new pure gate functions.
