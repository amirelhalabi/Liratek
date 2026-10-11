# IPC + adapter contract — desktop paired mode

## New IPC channels (`electron-app/handlers/offlineHandlers.ts`, registered in `main.ts` `registerHandlers`)

All return `{ success, data?, error? }`. Schemas in `packages/core/src/validators/offline.ts`, re-exported in
`electron-app/schemas/index.ts` with the zod-major cast.

| Channel | Role | Payload | `data` |
| --- | --- | --- | --- |
| `offline:status` | none (pre-login screen) | — | `{ mode: "standalone"\|"standby"\|"offline"\|"blocked", shopName?, copyAgeSeconds?, ready: boolean, notReadyReason?: "no_copy"\|"version_mismatch"\|"unsent_work", serverReachable: boolean, unreachableForSeconds: number, pendingCount: number /* from offline-work.db on disk when it exists, whatever DB is open */, canStartOffline: boolean, canRecord: boolean, keyUsable: boolean, updateReady: boolean }` (`updateReady` set by the main process's `update-downloaded` listener) — `canStartOffline` = standby, ready, and unreachable for longer than `lockAfterSeconds + 30` (from the last check-in reply; 120 s default) |
| `offline:pair` | none in standalone/blocked; in `offline` mode only when `keyUsable` is false (FR-035) | `offlinePairSchema` (+ `serverUrl?`, `replaceBusy?`) | `{ shopName }`; standalone/blocked → relaunch into standby; offline → keeps `offline-work.db` and its waiting ops, stores the new key, stays offline |
| `offline:unpair` | admin credentials in the payload (`{ username, password }`), checked read-only against the open copy's users (no session written); none needed in `blocked` (no shop data on the PC); refused while `pendingCount > 0` | `{ username, password }` | relaunch standalone |
| `offline:go-offline` | none (standby only; refused unless `canStartOffline`, and while a leftover `offline-work.db` holds waiting rows) | — | relaunch into offline |
| `offline:install-update` | none (standby/blocked only; refused in offline) — extends E3 | — | calls `autoUpdater.quitAndInstall()` only when `updateReady`. This is the ONLY way a paired desktop installs: `autoInstallOnAppQuit` stays `false` in every paired mode, so no quit or mode-switch relaunch (e.g. "Work offline") can install silently |
| `offline:send-now` | admin, staff (offline only) | — | `{ delivered, booked, refused, held, remaining }`; when `remaining = 0` → period/complete → relaunch standby |

`preload.ts`: `window.api.offline = { status, pair, unpair, goOffline, sendNow, installUpdate }` with `data` types derived from the core
schemas (rule 12/21); `frontend/src/types/electron.d.ts` declares them.

## Recorded channels (unchanged contracts, new behaviour only in paired `offline` mode)

| Channel | Handler file | Registry name | Core schema used for recording |
| --- | --- | --- | --- |
| `sales:process` | `electron-app/handlers/salesHandlers.ts` | `sales.process` | `saleProcessSchema` |
| `db:add-expense` | `electron-app/handlers/dbHandlers.ts` | `expenses.create` | `createExpenseSchema` (NOT the desktop literal mirror `AddExpenseSchema`) |
| `debt:add-repayment` | `electron-app/handlers/debtHandlers.ts` | `debts.addRepayment` | `addRepaymentSchema` |

In `offline` mode each calls `recordOffline({ operation, rawPayload, actorUserId, run })`:
1. refuse with `{ success:false, error:"Internet is back — send your offline work first" }` if `canRecord` is false (O12);
2. `registry[operation].schema.safeParse(rawPayload)` and `offlineRules(parsed)` — refuse on failure;
3. refuse if any `refFields` value exceeds the recorded base max id (FR-030);
4. inside `withWritable` (synchronous only): `db.transaction(() => { r = run(parsed); if !r.success throw; audit(...); outbox.append({...}) })`;
5. return `{ ...r, offline_ref: "OFFLINE-" + opKey.slice(0,8) }`.
`occurredAt = new Date().toISOString()`, `clientDay = localDay()`, `clientTzOffsetMinutes = -new Date().getTimezoneOffset()`
are taken on the desktop (the shop's own machine — correct by construction for rule 27) unless the payload carries a
`transaction_time`, in which case `occurredAt = transaction_time`.

In `standby` mode any write fails at the SQLite level (`query_only`) and the handler returns
`{ success:false, error:"This computer is your shop's backup till — use the web app" }`. In `standalone` mode nothing
changes.

## Adapter functions (`frontend/src/api/backendApi.ts` via `ipcOrHttp`; exposed on `ElectronApiAdapter.ts`; typed in `packages/ui/src/api/types.ts` as `z.input<…>` of the core schemas)

| Function | Desktop (IPC) | Web (REST) |
| --- | --- | --- |
| `getDesktopFallbackStatus()` | `offline:status` | returns `{ mode: "web" }` (no request) |
| `pairDesktop(input)` | `offline:pair` | `{ success:false, error:"Available on the desktop app" }` |
| `unpairDesktop(input)` | `offline:unpair` | same refusal |
| `installDesktopUpdate()` | `offline:install-update` | same refusal |
| `startOfflineMode()` | `offline:go-offline` | same refusal |
| `sendOfflineWork()` | `offline:send-now` | same refusal |
| `getShopLockStatus()` | returns `{ paired:false, lock:{locked:false} }` | GET `/api/offline/status` |
| `unlockShop()` | `{ success:false, error:"Available on the web app" }` | POST `/api/offline/unlock` |
| `listOfflineDevices()` / `revokeOfflineDevice(id)` | refusal | GET `/devices` / POST `/devices/:id/revoke` |
| `listOfflineReview(status?)` / `applyOfflineReview(id)` / `applyAllOfflineReview()` / `dismissOfflineReview(id, input)` | refusal | GET `/review` / POST `/review/:id/apply` / POST `/review/apply-all` / POST `/review/:id/dismiss` |

Components never branch on transport; they read `mode`/`paired` from these functions. Hooks reading `api` in effects use
the ref pattern (rule 25).
