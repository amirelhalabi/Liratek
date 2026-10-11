# Data model: Phone app follows the shop's module switches (LIRA-307)

No database change. Two client-side shapes on the phone.

## EnabledModuleKeys

What the phone keeps from `GET /api/modules/enabled` (see [contracts/enabled-modules.md](./contracts/enabled-modules.md)).

| Field | Type                  | Rule                                                            |
| ----- | --------------------- | --------------------------------------------------------------- |
| keys  | `ReadonlySet<string>` | the `key` of every entry in `modules`; other fields are ignored |

- Held only in the in-memory query cache under `queryKeys.modules(shop)`; never written to device storage (FR-005).
- Cleared by `resetCache()` on sign-out and on 401.

## GateState

| State        | Meaning                                                                           | `isEnabled(key)` |
| ------------ | --------------------------------------------------------------------------------- | ---------------- |
| `unverified` | no successful fetch in this run (start, pending, error, no connection, malformed) | always `false`   |
| `verified`   | a fetch in this run succeeded                                                     | `keys.has(key)`  |

Transitions:

```text
app start ─────────────► unverified
unverified ──fetch ok──► verified
verified ──refetch ok──► verified (new keys)
verified ──refetch fails► verified (keeps last keys — same run)
any ──sign-out / 401───► unverified (cache cleared)
```

## Gate rules (pure, `mobile/src/utils/moduleGates.ts`)

| Phone part                    | Visible when                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------- |
| Sell tab                      | `isEnabled("ipec_katch")` (owner decision D1, D2)                            |
| Debts tab                     | `isEnabled("debts")`                                                         |
| Home drawer line `d`          | `isDrawerVisible(d, isEnabled)` from `@liratek/core/constants/drawerModules` |
| Home, Activity, Settings tabs | always                                                                       |
