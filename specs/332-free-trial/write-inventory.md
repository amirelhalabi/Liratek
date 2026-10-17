# Write-route and automatic-write inventory (LIRA-332, T028 + T029)

**Date**: 2026-10-17, read from branch `lira-332-free-trial` (base `292e78a9`). Line numbers drift: search for the path.

This inventory was finished **before** `requireOpenTrial` was written. The allowlist in
`backend/src/middleware/requireOpenTrial.ts` (`TRIAL_ENDED_ALLOWED_WRITES`) is exactly the "ALLOWED" rows below that
carry a bearer token. Everything else that writes is refused once a trial has ended.

## How the gate sees a request

- The gate is mounted at app level, before every router. `req.user` is never set yet there, so the tenant comes from
  decoding the `Authorization: Bearer` JWT (`backend/src/middleware/requestTenant.ts`, extracted from
  `requireWritableSubscription.ts`). A bearer that is not a valid JWT resolves to "no tenant" (never throws).
- **No tenant → pass**: public routes (no bearer), platform super-admin tokens (`tenantId: null`, so all of
  `/api/admin/*`), and device-key requests (`/api/offline/checkin|events|manifest|snapshot` send
  `X-LiraTek-Device-Key`, no bearer).
- **Impersonation tokens** carry the shop's `tenantId`, so a super admin impersonating an ended shop is refused like the
  shop (owner decision).
- There is no token-refresh route: renewal arrives in the `X-Renewed-Token` header of any authenticated request,
  GETs included. There is no heartbeat, presence, telemetry, feature-flag POST or switch-shop endpoint.
- `/api/voice/*` is not mounted (`server.ts`), so it needs no entry.

## T028: every write route

Classes: **BLOCKED** = creates, changes or deletes a business record (refused after the end). **ALLOWED** = view,
export, sign-out, account safety (own password/email) or access-removing; or no tenant at all.

### Allowed (in `TRIAL_ENDED_ALLOWED_WRITES`)

| Method + path | file | Reason |
| --- | --- | --- |
| POST /api/auth/logout | auth.ts | Sign-out (also the phone, and the old-token logout the web fires at every login) |
| POST /api/auth/sessions/revoke-others | auth.ts | Sign-out elsewhere (removes access) |
| DELETE /api/auth/sessions/:id | auth.ts | Removes access |
| DELETE /api/auth/google/link | googleAuth.ts | Removes own Google sign-in (account safety) |
| POST /api/password-reset/change | passwordReset.ts | Own password (owner decision) |
| POST /api/password-reset/set-initial | passwordReset.ts | Own password (needed before a Google unlink) |
| POST /api/user-email/me/change | userEmail.ts | Own email (owner decision) |
| POST /api/user-email/verify | userEmail.ts | Completes the own-email change (public, may carry a bearer) |
| DELETE /api/user-email/:userId/google | userEmail.ts | Removes access (off-boarding) |
| POST /api/user-invitations/:id/revoke | userInvitations.ts | Removes access |
| POST /api/offline/devices/:id/revoke | offline.ts | Removes access |
| POST /api/profits/unlock, /lock | profits.ts | View gate; in-memory grant (`middleware/profitsUnlock.ts`), no DB write |
| POST /api/audit/search | audit.ts | View (`AuditService.search`, read). The Audit page loads through it on mount. |
| POST /api/reports/pdf | reports.ts | Export (placeholder on web, no write) |
| POST /api/reports/backup/verify | reports.ts | No write (placeholder) |
| POST /api/vouchers/validate | vouchers.ts | View: one SELECT (`VoucherRepository.getByCode`), status computed in code — confirmed |
| POST /api/exchange-lots/preview | exchangeLots.ts | View: FIFO dry run (`previewSettlement`) |
| POST /api/product-units/list, /summary, /for-sale-items | productUnits.ts | View (reads; Phone Units page and export load through `list` on mount) |
| Defensive, normally no bearer: POST /api/auth/login, /signup, /signup/request, /signup/invite/check, /api/auth/signin-code/(request\|verify), /api/auth/google/(start\|choose\|sso-exchange), /api/mobile/auth/login, /api/password-reset/(forgot\|check\|reset), /api/user-invitations/(check\|accept\|google/start), /api/offline/pair | various | Public. Listed so a stale bearer left in a header can never block signing in. `user-invitations/accept` still cannot add a user to an ended shop: `UserInvitationService` refuses it (`canWrite` false). |

Research R6 provisional entries: all confirmed except the `voice/*` routes (not mounted, so dropped).

### Blocked (every other write)

Grouped by router; every route in each file that is POST/PUT/PATCH/DELETE and not listed above.

| Router (mount) | Blocked writes |
| --- | --- |
| clients.ts (/api/clients) | POST /, POST /import-debts, PUT /:id, DELETE /:id |
| sales.ts (/api/sales) | DELETE /drafts/:id, POST /process (also the POS draft autosave), POST /:id/refund, /:id/refund-item, /undo-item-refund, /update-metadata |
| inventory.ts (/api/inventory) | product-suppliers POST/PUT/DELETE; products POST, /batch-delete, /batch-update, PUT/DELETE /:id, /:id/stock, /:id/receive-stock; categories POST/PUT/DELETE |
| debts.ts (/api/debts) | /repayments, /cash-out, /account-entry, /credit, /use-credit, /update-metadata, /write-off |
| exchange.ts | /transactions, /update-metadata |
| expenses.ts | POST /, /stock-use, DELETE /:id, /update-metadata |
| settings.ts | PUT /:key |
| recharge.ts | /process, /top-up-app, /top-up-from-supplier, /cashout-to-supplier, /top-up-from-partner, /top-up-from-client, /update-metadata |
| services.ts | /transactions, /self-charge, /update-metadata |
| maintenance.ts | POST /jobs, DELETE /jobs/:id, /update-metadata |
| currencies.ts | POST /, PUT /:id, DELETE /:id, PUT /drawers/:drawerName/currencies, PUT /:code/modules |
| closing.ts | PUT /daily-closing/:id, POST /checkpoint, POST /recalculate-drawer-balances |
| suppliers.ts | POST /, /:id/ledger, /:id/settle, /:id/settle-account, /:id/cashflow, PUT /:id/account-link, /:id/purchases, /:id/record-debt |
| rates.ts | POST /, DELETE /:fromCurrency/:toCurrency |
| users.ts | POST /, PUT /:id/active, PUT /:id/role, PUT /:id/password (admin sets another user's password) |
| transactions.ts | /:id/void, /:id/refund, checkout-group void, session-basket void/refund/items-refund |
| reports.ts | POST /backup (placeholder), POST /restore |
| sessions.ts | /start, /checkout, /link-transaction, cart POST/DELETE, PUT /:id, /:id/close, DELETE /:id |
| modules.ts | PATCH /:key/enabled, PUT /bulk-enabled |
| paymentMethods.ts, serviceProviders.ts, servicePresets.ts | every POST/PUT/DELETE |
| item-costs.ts, voucher-images.ts | every POST/DELETE |
| customServices.ts | /fulfillment, /work-status, /update-metadata, POST /, DELETE /:id |
| profits.ts | PUT /password |
| loto.ts | /update-metadata, PUT /settings/:key, /sell, /fees, /fees/:id/pay, /cash-prizes, /cash-prizes/:id/reimburse, /checkpoints (+ settle-batch, settle, PUT, DELETE), PUT /:id |
| holdMoney.ts | POST /, /:id/collect, /pickups/:pickupId/void |
| drawerTopUp.ts, drawerCashout.ts, walletExchange.ts | every POST |
| exchangeLots.ts | /adjust |
| productUnits.ts | /register, DELETE /:id |
| warranty.ts | /claims, /claims/:id/void, /defective/:id/resolve, /supplier-returns, /supplier-returns/:id/close |
| partners.ts | POST /, /transactions, /settle, /write-off, PUT /:id, /:id/deactivate, /:id/activate |
| vouchers.ts | POST /, /:id/cancel |
| carrierLines.ts | /owed-deliveries/:id/mark-sent, /record-usage, POST /, PUT set-primary/:id/balance/archive/toggle-active |
| resaleLines.ts | PUT /:productId, /:productId/write-off, /:productId/recharge |
| wrongNumbers.ts | POST /, /:id/credits |
| rechargeBasket.ts | /checkout, /partner-order |
| mobileServiceItems.ts | POST /, /seed, PUT /:id, /:id/toggle-active, DELETE /:id |
| databaseReset.ts | /reset |
| whatsapp.ts | /send-test, /send-message (no DB write, but sends a message on the shop's behalf) |
| userInvitations.ts | POST / (invite), /:id/resend |
| userEmail.ts | PUT /:userId, /:userId/send-verification |
| passwordReset.ts | /send/:userId (admin sends a reset to another user) |
| googleAuth.ts | /link/start (adds a sign-in method; only password and email changes were allowed) |
| offline.ts (JWT routes) | /devices/:id/renumber, /review/:id/apply, /dismiss, /reviewed, /book-anyway (work after activation) |

Not routes: `inventory.ts`/`paymentMethods.ts` `.delete()` grep hits are repository calls. The frontend's
`reorderModules` posts to `/api/modules/reorder`, which has no backend route (404 regardless; pre-existing).

### The paired-PC side door (not an HTTP route)

`POST /api/offline/events` and `/checkin` use the device key, so the gate never sees them, and
`OfflineMergeProcessor` books uploaded events straight through core. This is closed in core, not at HTTP (research
R8, owner decision D-332-A): the merge round holds every event stamped at or after the trial end until the owner
activates or extends, books pre-end events normally, and the PC recorder refuses new offline work once its checkin
says the trial ended (T057–T063).

### The older read-only gate

`requireWritableSubscription` (denylist, `canWrite`) would also refuse some allowlisted paths for an ended trial,
because `canWrite` is false in `trial_ended` (e.g. `/api/reports/backup/verify`, under its `/api/reports/backup`
prefix). It is only reached when `requireOpenTrial` passed a request; for `trial_ended` it now defers to the same
`TRIAL_ENDED_ALLOWED_WRITES` list and answers with the trial wording otherwise. Paying shops (`read_only`, `grace`)
keep their byte-identical behaviour.

## T029: writes the UI fires without a user action

| Where | Endpoint | Trigger | Decision |
| --- | --- | --- | --- |
| `frontend/src/api/httpClient.ts` `storeNewLoginToken` | POST /api/auth/logout (previous bearer) | every login that replaces a token | Allowlisted |
| `features/profits/components/ProfitsPasswordGate.tsx` | POST /api/profits/lock | unmount, unlock-TTL timer | Allowlisted |
| `features/audit/pages/AuditLogViewer.tsx` | POST /api/audit/search | mount, filters, paging | Allowlisted (else the Audit page cannot load) |
| `features/inventory/hooks/useProductUnits.ts`, `PhoneUnits/index.tsx` | POST /api/product-units/list | mount, export loop | Allowlisted (else the page and export cannot load) |
| `features/exchange/pages/Exchange/index.tsx` | POST /api/exchange-lots/preview | debounced while typing | Allowlisted |
| `features/sales/pages/POS/index.tsx` | POST /api/sales/process (`status:"draft"`) | 1 s autosave of a resumed draft | Stays blocked: it changes a record. The adapter returns the envelope, the error is logged quietly, and the banner switches to "trial ended" via `TRIAL_ENDED_EVENT`. No page error. |
| `contexts/MobileServiceItemsContext.tsx`, `Settings/MobileServicesManager.tsx` | POST /api/mobile-service-items/seed | after login / panel mount, only when the catalog is EMPTY | Stays blocked (it creates catalog rows). The adapter returns the refusal envelope without throwing, so the catalog reads that follow still run; only a shop that never seeded (impossible after a normal sign-up, which seeds on the first login during the trial) keeps an empty catalog. No code change. |
| `useSsoHandoff.ts`, `VerifyEmail.tsx`, `ResetPassword.tsx`, `Signup.tsx`, `JoinShop.tsx` | public POSTs with `auth:false` | mount | No bearer → never gated |

Checked and not automatic writes: every poll (SessionContext, Dashboard, TopBar, SubscriptionBanner, OfflineGate,
loto CheckpointScheduler) is a GET; cart, session and basket writes are click-driven. **Phone app** (`mobile/src`):
writes only on taps; sign-out uses POST /api/auth/logout (allowlisted) and its `request()` never throws, so a refused
call still clears the token.
