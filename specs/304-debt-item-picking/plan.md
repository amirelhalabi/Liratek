# Implementation Plan: Debt Repayment Item Picking and Primary-System Drawer Routing

**Branch**: `304-debt-item-picking` (work on `main`; no branch) | **Date**: 2026-10-10 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/304-debt-item-picking/spec.md`

## Summary

Make customer-debt repayment send money to the same drawers whether the debt came from one session basket or from
separate visits, route only the shop's primary system (OMT or Whish, never the wallet apps or the secondary system,
cash only, any currency), let the cashier tick the items a payment is for (including single items inside a basket),
release profit per item, show the per-drawer split on the repayment screen and in the Transactions page payment
details, and add an information-only USD total to the checkpoint.

Technical approach (details in [research.md](research.md)):
- Store each basket member's on-account share and coverage on `customer_session_transactions` (migration v209,
  backfilled); the basket's single `'Session Debt'` row stays the authority and always equals the sum (invariant I1).
- One pure allocation function (`core/utils/debtRepaymentAllocation.ts`, Node-free) decides coverage and routing for
  both the modal preview and the server posting.
- Routing: ticked items first (a ticked primary-system transfer's share → its cash drawer, any other ticked item → the payment method's drawer), then the remainder "OMT drawer first"; always capped per transfer at its amount minus what earlier repayments routed for it, stored in the transfer's own currency at each repayment's rate; independent of coverage order. The routed share keeps an internal, non-overridable two-row shape.
- One member-aware coverage writer used by checkout, repayment and discount.

## Technical Context

**Language/Version**: TypeScript (strict), Node 22, React 19

**Primary Dependencies**: `@liratek/core` (repositories/services), Electron 31 IPC, Express REST (`backend/`), TanStack Query, Zod

**Storage**: SQLite (SQLCipher on desktop, Litestream-replicated on Fly); migration v209

**Testing**: core jest (repositories, pure allocation), frontend jest (display helpers, modal), web e2e (`lira-web-051`); desktop e2e via CI only

**Target Platform**: Electron desktop (Windows) and the multi-tenant web app

**Project Type**: monorepo desktop + web app (`packages/core`, `electron-app`, `backend`, `frontend`, `packages/ui`)

**Performance Goals**: repayment modal preview recomputes instantly (pure function, ≤ 20 open items typical); open-items read is one query per item kind

**Constraints**: money integrity (constitution IV); rule 13 (no SQL in services — incl. `SessionPaymentService`); rule 29 (allocation module Node-free); rule 23 (four-place field add); rule 27 (no server clock in new logic); one `shop_base_system` helper

**Scale/Scope**: ~6 core files, 1 migration, 1 new read endpoint × 2 transports, 1 extended write, Debts page modal + purchases list, Transactions viewer display helper, checkpoint card

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Applies? | Status |
|---|---|---|
| I. One core, two transports | Yes — new read endpoint + extended write | Pass: core service shared; IPC + REST; adapter via `ipcOrHttp`; payload built once; allocation module Node-free and exported from both entry points |
| II. Layer boundaries | Yes | Pass: all SQL in `DebtRepository` / `SessionPaymentRepository`; checkout OMT-first SQL goes in the repository, not `SessionPaymentService` |
| III. Contracts defined once | Yes | Pass: `targets` added to `addRepaymentSchema`; `AddRepaymentPayload` derived; four-place diff (schema, preload, handler `RepaymentData`, service mapping); primary-system predicate defined once |
| IV. Money integrity | Yes — core of the feature | Pass with named guards: FEATURE_GUIDE §13 walked (below); IN legs only for routing; reversal owner = generic void (`_reversePayments` + `_restoreRepaymentDebt` extended for members); create + void nets to 0 per currency (tests D3–D5, I1) |
| V. Data and security | Yes | Pass: `?` placeholders; `tenant_id` on every new statement; same roles as today; migration in both files with `down()`; new columns NOT NULL DEFAULT 0 |
| VI. Testing | Yes | Pass: guards written failing-first; web e2e asserts deltas + identity; field names from schema; run counts confirmed |
| VII. Code quality | Yes | Pass: no `any`; module loggers; `api` via ref in the modal's effects |

### FEATURE_GUIDE §13 walk-through
1. Schema/plumbing — v209 both files; repo → service → handler + Zod + `requireRole` + envelope; preload typed; `electron.d.ts`; core build & sync.
2. Transactions row — no new type; `DEBT_REPAYMENT` metadata gains `routed`, `targets`, `coverage_applied.members`.
3. IN/OUT badge — unchanged types.
4. Payment legs — routing reads IN legs only; OUT legs still debited once by the shared loop; kept change via `resolveKeptChange` as today; applied amount (IN − OUT − kept) caps routing.
5. Drawers — primary drawer per `shop_base_system`; wallet-app rule: never routed.
6. Client propagation — unchanged (`clientId` already on the payload).
7. CUSTOMER_ACCOUNT — unchanged booking; basket member shares derived at checkout.
8. Supplier ledger — untouched (owed to OMT is booked at transfer time).
9. Void path — generic void restores members + routing; refund-with-override guarded (D4); refunded repayments stop counting as routed (D5).
10. Profits — per-member hold (D10); totals measured before/after on a DB copy.
11. Sessions — checkout split OMT-first (D11); basket members carry `owed/covered`.
12. Audit viewer — merged lines + drawer breakdown (D9).
13. E2E guard — `lira-web-051` (deltas + identity).
14. One obligation, one owner — the routed cash is the shop's physical cash in the counter drawer; what is owed to OMT stays on `supplier_ledger`; invariant: Σ drawer deltas of a repayment = applied amount + kept change, per currency.
15. Legs vs amount — routing and coverage both derive from the same applied amount; one predicate decides routable legs (`resolveServiceCashDrawer`).

**Gate result: PASS.** No violations; Complexity Tracking not needed.

## Project Structure

### Documentation (this feature)

```text
specs/304-debt-item-picking/
├── spec.md
├── plan.md              # this file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/debt-api.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks (not yet)
```

### Source Code (repository root)

```text
packages/core/src/
├── db/migrations/index.ts                      # v209: member owed/covered + backfill
├── utils/debtRepaymentAllocation.ts            # NEW pure allocation (coverage + routing + preview), Node-free
├── repositories/
│   ├── DebtRepository.ts                       # addRepayment uses allocation; applyCoverage writer; findOpenDebtItems; routing rewrite
│   ├── settingsSql.ts                          # NEW readShopBaseSystem(db) — one helper
│   ├── SessionPaymentRepository.ts             # checkout OMT-first split + member owed write
│   ├── sessionDebtCoverage.ts                  # member-level outstanding fragment
│   ├── ProfitRepository.ts                     # notDebtPending per member
│   └── TransactionRepository.ts                # _restoreRepaymentDebt members; routed-sum excludes reversed; stale comments
├── services/
│   ├── DebtService.ts                          # targets mapping; getOpenDebtItems
│   └── SessionPaymentService.ts                # calls repository for the new split (no SQL here)
├── validators/debt.ts                          # targets in addRepaymentSchema
├── index.ts / browser.ts                       # export allocation + types
electron-app/
├── handlers/debtHandlers.ts                    # RepaymentData.targets; debt:get-open-items
├── preload.ts                                  # addRepayment type; getOpenItems binding
└── create_db.sql                               # v209 columns
backend/src/api/debts.ts                        # GET /clients/:id/open-items; targets passthrough
packages/ui/src/api/types.ts                    # ApiAdapter.getOpenDebtItems
frontend/src/
├── api/backendApi.ts, api/ElectronApiAdapter.ts, types/electron.d.ts
├── features/debts/pages/Debts/index.tsx        # basket expand; picker in repayment modal; preview
├── features/debts/components/DebtItemPicker.tsx  # NEW
├── features/audit/paymentDetailLines.ts        # NEW merge + drawer breakdown helper
├── features/audit/pages/TransactionsViewer.tsx # use the helper
└── features/closing/{components/DrawerCard.tsx,hooks/useDrawerCheckpoint.ts}  # info total
frontend/tests/e2e-web/lira-web-051-debt-item-picking.spec.ts  # NEW
docs/release-notes/UNRELEASED.md, docs/FEATURE_GUIDE.md (§7, §11 updates)
```

**Structure Decision**: existing monorepo layout; no new package. New code sits next to the code it extends.

## Phasing (dependency order)

1. **Foundation** — v209 migration + backfill + I1 guard; `readShopBaseSystem`; primary-system predicate; `applyCoverage` writer; allocation module.
2. **US1 routing parity** (P1) — routing rewrite in `addRepayment` (ticked first, then OMT first; primary only; cash only; cross-currency; per-transfer cap; basket members), D3/D5 guards.
3. **Checkout split OMT-first** (FR-009a) — member `owed` from the new split.
4. **US2 picking** (P1) — `targets` four-place add, coverage with targets, `findOpenDebtItems` + endpoint, picker + preview.
5. **US5 void** (P1) — `_restoreRepaymentDebt` members, refund-with-override guard (D4).
6. **US4 profit** (P2) — per-member hold + before/after measurement.
7. **US3 / US6** (P2) — basket expand on the Accounts page, payment-detail lines.
8. **US7** (P3) — checkpoint info total.
9. **Proof & docs** — web e2e `lira-web-051`, desktop e2e (CI), FEATURE_GUIDE §7/§11, release note, gates.

## Re-check after Phase 1 design

Constitution re-checked against data-model.md and contracts/: no new violations. The two highest-risk points (routing
cap drift, override refund) have named failing-first tests. **Gate: PASS.**

## Complexity Tracking

Not needed — no constitution violations.
