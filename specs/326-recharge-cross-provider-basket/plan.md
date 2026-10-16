# Implementation Plan: One Mobile Recharge basket across providers

**Ticket**: LIRA-326 | **Date**: 2026-10-16 | **Spec**: [spec.md](./spec.md)

## Summary

Lift the iPick/Katsh and Whish App grid baskets out of their screens into one app-level basket, so picks survive tab switches and page changes. When the basket spans more than one provider, Proceed to Pay opens one payment window (the grouped item list already exists) and confirms through a new endpoint, `recharge-basket:checkout` / `POST /api/recharge-basket/checkout`. Server-side, that endpoint creates a closed-on-checkout customer session and runs the existing `SessionCheckoutService.checkout` on per-provider `_batch` cart entries. That service already:
- books one sale per provider through `FinancialService.addTransaction` in deferred mode;
- posts the one payment through `recordBasketPayment`;
- handles kept change, waive and extra;
- links everything to the session.

Whole-basket void/refund (`voidSessionBasket` / `refundSessionBasket`) and the refusal to reverse one item on its own come with it. A basket of one provider keeps today's single-sale path, now always booked under the lines' own provider, never the tab's.

## Technical Context

**Language/Version**: TypeScript (strict), React 19, Node/Electron 31
**Primary Dependencies**: `@liratek/core` services (SessionCheckoutService, CustomerSessionRepository, FinancialService), Zod, TanStack-free React context
**Storage**: SQLite — **no schema change**: the basket rides on `customer_sessions` + `session_transactions`
**Testing**: core jest (in-memory DB), frontend jest (RTL), web e2e (written, run on request)
**Target Platform**: Electron desktop + web (Vercel + Fly)
**Constraints**: money integrity (constitution IV), dual transport (I), one contract (III)

## Constitution Check

- I. One core, two transports: one core service, IPC handler + REST route both call it — ✅
- II. Layer boundaries: SQL stays in repositories; the new service orchestrates only — ✅
- III. Contracts once: `rechargeBasketCheckoutSchema` in `packages/core/src/validators/`, adapter types derived (`z.input`) — ✅
- IV. Money integrity: reuses the session checkout money path (no new posting code); reversal owner = existing session-basket void/refund (rule 20); all-or-nothing via the checkout transaction + session delete on failure — ✅
- V. Data/security: `requireRole(admin, staff)` on both transports; operator from auth, never the wire — ✅
- VI. Testing: failing-first core + frontend tests; web e2e — ✅

## Design

### Server
- `packages/core/src/validators/rechargeBasket.ts`: `rechargeBasketCheckoutSchema` = the session checkout envelope **without** `sessionId`, plus `clientPhone?`. Every cart item must be `ipcChannel: "financial:create"` with `module ∈ {ipick, katsh, whish_app}` and `formData._batch === true`. Each sub-item's `provider` must match its entry's module. These checks live in the service, so both transports get them.
- `packages/core/src/services/RechargeBasketService.ts`: `checkout(req, ctx)`:
  1. Validate the items (above).
  2. `CustomerSessionRepository.createSession({customer_name: clientName || "Walk-in", customer_phone, customer_notes: "Mobile Recharge basket", started_by, user_id})`.
  3. `await getSessionCheckoutService().checkout({...req, sessionId}, ctx)`.
  4. On failure, `deleteSession(sessionId)` (nothing else was written: checkout's own transaction rolled back) and return the error.
- IPC `recharge-basket:checkout` in `electron-app/handlers/rechargeBasketHandlers.ts`, registered in `main.ts`; preload binding; offline `channelPolicy` = `online_only` (a money write, rare).
- REST `backend/src/api/rechargeBasket.ts` mounted at `/api/recharge-basket`, `authenticateJWT` → `requireRole(["admin","staff"])`; injects `userId` and `username` from the JWT.

### Frontend
- `frontend/src/features/recharge/context/RechargeBasketContext.tsx`, mounted in the app shell (above the router), holds two groups:
  - `"catalog"`: the iPick + Katsh cart Map, owned by KatshForm;
  - `"whish"`: the Whish App cart Map, owned by FinancialForm.

  Each group holds `{ cart, priced: PricedLine[] }`. The owning form keeps `priced` up to date (an effect on its cart and pricing). A `PricedLine` carries:
  - the `PaymentSheetItem` shown in the window;
  - `currency`, `amount`, `commission`, `cost`;
  - `subItem`: the session `_batch` sub-item formData the form already builds for session mode (extracted to a shared builder, rule 14).

  This lets a form price the other screen's lines without knowing its pricing rules.
- KatshForm / FinancialForm: `cart`/`setCart` come from the context group instead of `useState`; tab counts are derived from the basket.
- Proceed to Pay:
  - lines of one provider → today's single-sale path, `provider` taken from the lines;
  - lines of 2+ providers → combined mode:
    - the PaymentSheet lists all priced lines;
    - totals per currency (PaymentSheet gains `totals?: {amount, currency}[]`);
    - discount shown only when the basket is single-currency;
    - confirm → `api.rechargeBasketCheckout(payload)` with one `_batch` entry per provider, the discount spread over sub-items by commission (capped at each sub-item's commission, the session modal's rule, moved to a shared util), plus payments, kept, waived, extra and client.
  - success → clear both groups and refresh both screens' data.
- Session mode (an open customer session): unchanged, except that a mixed iPick + Katsh cart is now added as one session cart entry **per provider** (fixes the same mis-booking on the session path).

### Out of scope (v1)
- The MTC/Alfa card grid (single-card Alfa Gift flow, a different payment path) stays separate and is noted as a follow-up.
- For Partner stays per tab.
- No discount on a mixed-currency basket.

## Project Structure

```
packages/core/src/validators/rechargeBasket.ts            (new)
packages/core/src/services/RechargeBasketService.ts       (new) + __tests__
packages/core/src/offline/channelPolicy.ts                (+1 online_only)
electron-app/handlers/rechargeBasketHandlers.ts           (new) + main.ts, preload.ts, schemas/index.ts
backend/src/api/rechargeBasket.ts                         (new) + server.ts
frontend/src/api/backendApi.ts, ElectronApiAdapter.ts, packages/ui/src/api/types.ts, frontend/src/types/electron.d.ts
frontend/src/features/recharge/context/RechargeBasketContext.tsx (new)
frontend/src/features/recharge/utils/basketCheckout.ts    (new: buildBasketCheckoutPayload, spreadDiscount)
frontend/src/features/recharge/components/{KatshForm,FinancialForm,PaymentSheet}.tsx
frontend/tests/e2e-web/lira-web-068-recharge-basket.spec.ts (new)
```
