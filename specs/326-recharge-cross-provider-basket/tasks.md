# Tasks: One Mobile Recharge basket across providers (LIRA-326)

Rule 17: every test task runs and FAILS before its implementation task.

## Phase 1 — Contract (blocks everything)
- [X] T001 `packages/core/src/validators/rechargeBasket.ts`: `rechargeBasketCheckoutSchema` (session checkout envelope minus `sessionId`, plus `clientPhone?`), `RechargeBasketCheckoutPayload = z.input<…>`, `RECHARGE_BASKET_MODULES`; export from `validators/index.ts`, `index.ts` and `browser.ts`
- [X] T002 Adapter: `rechargeBasketCheckout(payload)` in `frontend/src/api/backendApi.ts` (ipcOrHttp), `ElectronApiAdapter.ts`, `packages/ui/src/api/types.ts`; preload binding `rechargeBasket.checkout` + `electron.d.ts`

## Phase 2 — Server (US1, US2, US4)
- [X] T003 [P] Test FIRST `packages/core/src/services/__tests__/RechargeBasketService.test.ts`: Katsh + Whish App basket paid cash → one sale per provider, each provider drawer −own cost, General +total once; refusals (bad module/channel, provider mismatch, empty) write nothing; checkout failure deletes the session; refundSessionBasket nets every ledger to 0 per currency; mixed LBP + USD legs
- [X] T004 `packages/core/src/services/RechargeBasketService.ts` (+ services/index exports)
- [X] T005 [P] IPC `electron-app/handlers/rechargeBasketHandlers.ts` + `main.ts` registration + `schemas/index.ts` re-export + role-gate test; `channelPolicy.ts` online_only
- [X] T006 [P] REST `backend/src/api/rechargeBasket.ts` + `server.ts` mount + api test

## Phase 3 — Frontend basket (US1, US3, US5)
- [X] T007 Test FIRST: `RechargeBasketContext` keeps each group's cart across unmount/remount; `basketCheckout` util builds one `_batch` entry per provider and spreads a discount by commission (capped)
- [X] T008 `frontend/src/features/recharge/context/RechargeBasketContext.tsx` (mounted in the app shell) + `utils/basketCheckout.ts`
- [X] T009 KatshForm + FinancialForm: cart from the context; publish PricedLines; single-provider pay books under the lines' provider; 2+ providers → combined PaymentSheet (all lines, per-currency totals) → `rechargeBasketCheckout`; session mode adds one cart entry per provider; mixed basket with pending bills asks to pay bills first
- [X] T010 PaymentSheet: `totals?` (several currencies) passed to MultiPaymentInput
- [X] T011 Tests: switching tabs keeps picks; combined payload shape (schema-parsed, rule 24); session mode splits per provider

## Phase 4 — Polish
- [ ] T012 Web e2e `frontend/tests/e2e-web/lira-web-068-recharge-basket.spec.ts` (written; run on request)
- [X] T013 Release note + `current_sprint.md` LIRA-326 ticket
- [X] T014 Gates: lint, typecheck, check:* scripts, core + backend + frontend suites
