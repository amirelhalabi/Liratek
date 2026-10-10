# Quickstart: validate the phone bottom tabs (LIRA-300)

## Prerequisites

- Local backend on port 4310 with the `mobiletest` tenant (LIRA-289 quickstart, steps 1–3);
  `mobile/.env.development.local` points at `http://localhost:4310`.
- iOS simulator "iPhone 17" with the existing dev build; the owner's Android phone for the release APK.
- No EAS, no online Expo account (owner rule).

## Automated checks

```bash
yarn workspace @liratek/mobile start   # once, so typed routes regenerate after the file moves; then stop it
yarn typecheck                          # includes mobile
yarn lint
yarn workspace @liratek/mobile test     # query keys + invalidation map; must report > 0 tests
yarn test                               # whole repo; LIRA-289 money tests unchanged (SC-006)
```

Confirm each run actually executed: test counts in the summary, real elapsed time (rule 28).

## Duplicate React check (research R4)

After `@tanstack/react-query` is installed:

```bash
ls -d mobile/node_modules/@tanstack/react-query node_modules/@tanstack/react-query
```

Then open the app on the simulator. It must render Home with balances; "Invalid hook call" or "No QueryClient set"
means the Metro React pin is missing or wrong.

## Manual scenarios (simulator, then Android APK)

1. **Tabs (US1):** sign in → Home is highlighted; tap Sell, Debts, Activity, Settings → each opens, highlight moves.
2. **Pop to top (US1 #3):** Debts → open a customer → tap Debts again → back at the list.
3. **Per-page loading (US2, SC-002):** with the backend log open, sign in fresh → only the balances and
   since-last-count requests appear; open Activity → the recent-transactions request appears then.
4. **Instant return (US3, SC-003):** open Home, then Activity, then Home → balances show with no spinner. Timed by
   eye on the Android phone; target under 0.3 s.
5. **Failed refresh (FR-010):** stop the backend, wait 30 s, switch tabs → old data stays, "Could not refresh"
   notice shows; restart backend, pull down → data reloads.
6. **After a sale (US4, SC-004):** note Whish App balance → Sell → Whish App transfer on a customer's account →
   Home: balance moved, since-last-count +1 → Activity: transfer listed → Debts: customer's debt includes it.
7. **Form kept (FR-014):** half-fill a transfer → tap Home → tap Sell → form unchanged.
8. **Keyboard (edge case):** focus the amount field → tab bar hides; Save button visible.
9. **Sign-out (US5, SC-005):** open every tab on shop A → Settings → sign out → sign in to a second test shop →
   no page shows shop A's numbers, even briefly. Repeat with an expired session (revoke the session from web
   Settings) instead of sign-out.
10. **Theme (FR-015):** Settings → Light, Dark, System → tab bar follows.
