# Financial Services — Implementation Plan

**Last Updated**: March 1, 2026  
**Status**: Phases 1–4, 6 Complete ✅ | Phase 5 (WHISH Fees) Pending 📋

---

## Completed Phases Summary

| Phase | Description                                                   | Status                                    |
| ----- | ------------------------------------------------------------- | ----------------------------------------- |
| 1     | 3-Drawer Cash-Reserve + Remove BILL_PAYMENT + Western Union   | ✅ Done                                   |
| 2     | Auto-Profit Calculation (OMT fee schedules, commission rates) | ✅ Done                                   |
| 3     | Multi-Payment Method Support                                  | ✅ Done                                   |
| 4     | Transaction History Page (`/transactions`)                    | ✅ Done                                   |
| 6     | Services UI Redesign (compact layout, labels)                 | ✅ Done                                   |
| 7     | Currency Handling                                             | ✅ Not needed — current system works fine |

> Historical phase details archived in `docs/archive/IMPLEMENTATION_COMPLETE.md`, `PHASE3_COMPLETE.md`, `PHASE4_COMPLETE.md`

---

## 🚧 Phase 5 — WHISH Fee Calculation & Service Types

**Status**: Not started  
**Priority**: Medium

### Context

Currently WHISH transactions use the same UI as OMT but without service type differentiation. OMT has 8 service types (INTRA, WESTERN_UNION, CASH_TO_BUSINESS, etc.) with auto fee calculation. WHISH needs the same treatment.

### Backend Tasks

- [ ] Define WHISH service types
  - Propose: `INTRA`, `SEND`, `COLLECT`, `ONLINE` (confirm with business)
  - Add `whish_service_type` column to `financial_services` table
  - DB migration for new column + CHECK constraint
- [ ] WHISH fee calculator (`packages/core/src/utils/whishFees.ts`)
  - Fee schedules per WHISH service type
  - Similar structure to `omtFees.ts`
- [ ] Auto-calculation in `FinancialServiceRepository` for WHISH provider
- [ ] Update validators (`packages/core/src/validators/financial.ts`) with `whish_service_type`

### Frontend Tasks

- [ ] WHISH service type dropdown (when provider = WHISH)
- [ ] WHISH fee input field (parallel to OMT fee field in Services UI)
- [ ] "Including Fees" checkbox for WHISH SEND transactions
- [ ] Commission preview for WHISH (auto-calculated, read-only)
- [ ] WHISH-specific profit rate selector (if needed)

### Files to Modify

| File                                                           | Change                                 |
| -------------------------------------------------------------- | -------------------------------------- |
| `packages/core/src/utils/whishFees.ts`                         | New — fee calculator                   |
| `packages/core/src/validators/financial.ts`                    | Add `whish_service_type` enum          |
| `packages/core/src/repositories/FinancialServiceRepository.ts` | WHISH auto-calc                        |
| `packages/core/src/db/migrations/index.ts`                     | New migration for `whish_service_type` |
| `frontend/src/features/services/pages/Services/index.tsx`      | WHISH service type UI                  |
| `electron-app/create_db.sql`                                   | Update schema                          |

---

## Architecture Notes (Reference)

### OMT — 3-Drawer Cash-Reserve Model (IMPLEMENTED)

```
OMT SEND (Money In):
  (1) payment drawer +amount  (customer pays here)
  (2) General -amount         (cash reserve)
  (3) OMT_System +amount      (owed to OMT company)

OMT RECEIVE (Money Out):
  (1) General -amount
  (2) OMT_System -amount

Commission → General drawer
```

### WHISH — 2-Drawer Model (IMPLEMENTED, no fee calc yet)

```
WHISH SEND:
  (1) payment drawer +amount
  (2) Whish_System +amount    (NO General involvement)

WHISH RECEIVE:
  (1) Whish_System -amount    (NO General involvement)
```

### OMT Service Types & Commission Rates (IMPLEMENTED)

| Service Type     | Commission         |
| ---------------- | ------------------ |
| INTRA            | 15%                |
| WESTERN_UNION    | 10%                |
| CASH_TO_BUSINESS | 25%                |
| CASH_TO_GOV      | 25%                |
| OGERO_MECANIQUE  | 25%                |
| OMT_CARD         | 10%                |
| OMT_WALLET       | 0%                 |
| ONLINE_BROKERAGE | 0.1–0.4% of amount |

---

## Architecture Decisions (Resolved)

| #   | Issue                                     | Decision                         | Status  |
| --- | ----------------------------------------- | -------------------------------- | ------- |
| D1  | `recharges` table unused                  | Keep — used for MTC/Alfa         | ✅ Done |
| D2  | `binance_transactions` separate table     | Merged into `financial_services` | ✅ Done |
| D3  | Column naming inconsistency               | Standardized to `currency_code`  | ✅ Done |
| D4  | `sales.drawer_name` wrong default         | Fixed to `'General'`             | ✅ Done |
| D5  | MTC/Alfa recharges write to `sales`       | Fixed — use `recharges` table    | ✅ Done |
| F1  | Orphaned `IKWServices/`, `Binance/` pages | Deleted                          | ✅ Done |
| F6  | SEND/RECEIVE labels confusing             | Renamed to Money In/Money Out    | ✅ Done |

---

## Validation Checklist (Run After Each Phase)

```bash
yarn typecheck      # 0 errors
yarn build          # successful
yarn test:frontend  # 81+ tests
yarn test:backend   # 291+ tests
```
