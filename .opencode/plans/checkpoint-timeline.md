# Checkpoint Timeline — Implementation Plan

**Created**: 2026-03-10  
**Feature**: Visual timeline of opening/closing checkpoints throughout the day  
**Status**: Planning Complete

---

## 📋 Overview

Create a **Checkpoint Timeline** page that shows all opening and closing checkpoints (balance settings) that occurred throughout the day, with timestamps. This provides an audit trail of when cashiers opened/closed their shifts and set opening balances.

### Current State

**Database Schema** (`daily_closings` table):
- `created_at DATETIME` - Timestamp exists ✅
- `created_by INTEGER` - User who set checkpoint
- `opening_balance_usd/lbp` - Amounts set
- `physical_usd/lbp` - Actual counted amounts (for closings)
- `variance_usd` - Difference (for closings)

**Transaction Tracking**:
- Opening balances create `transactions` entries with `type = 'OPENING'`
- Closing creates `transactions` entries with `type = 'CLOSING'`
- Both have `created_at` timestamps
- Linked via `source_table = 'daily_closings'` and `source_id`

**Current UI**:
- Opening modal - Sets opening balances
- Closing page - Creates daily closing report
- **Missing**: Timeline/history view of checkpoints

---

## 🎯 Requirements

### Functional Requirements

1. **Timeline View**
   - Show all opening/closing checkpoints for selected date
   - Chronological order (newest first)
   - Show timestamp (date + time)
   - Checkpoint type (Opening vs Closing)
   - User who created it
   - Drawer name and total amount

2. **Filtering**
   - Filter by date (default: today)
   - Filter by type (All / Opening only / Closing only)
   - Filter by drawer (All / General / OMT / Whish / etc.)

3. **Details**
   - Currency breakdown (USD, LBP, EUR)
   - Opening vs physical vs variance (for closings)
   - Notes if any

---

## 🔧 Implementation Plan

### Backend (1 hour)

**1. ClosingRepository.ts** - Add method:
```typescript
getCheckpointTimeline(filters: CheckpointFilters): CheckpointRecord[]
```
- Query `daily_closings` JOIN `transactions` JOIN `users`
- Filter by date, type, drawer_name, user_id
- Load currency breakdown from `daily_closing_amounts`

**2. ClosingService.ts** - Add service method:
```typescript
getCheckpointTimeline(filters): Promise<{success, checkpoints?, error?}>
```

**3. closingHandlers.ts** - Add IPC:
```typescript
ipcMain.handle("closing:getCheckpointTimeline", ...)
```

### Frontend (1.5 hours)

**4. Create CheckpointTimeline/index.tsx**
- Date filter (default today)
- Type filter dropdown
- Drawer filter dropdown
- DataTable with columns: Time, Type, Drawer, Amount (USD/LBP), User, Notes
- Type badges: Opening (green), Closing (amber)
- Loading and empty states

**5. Add route to App.tsx**
```typescript
<Route path="/checkpoint-timeline" element={<CheckpointTimeline />} />
```

**6. Add to Sidebar navigation**
- Icon: Clock
- Label: "Checkpoint Timeline"
- Path: /checkpoint-timeline

### Tests (30 min)

**7. Backend tests** - ClosingService.test.ts
**8. Frontend tests** - CheckpointTimeline.test.tsx

---

## ✅ Acceptance Criteria

- [ ] Timeline displays checkpoints for selected date
- [ ] Chronological order (newest first)
- [ ] Type badges (Opening=green, Closing=amber)
- [ ] Timestamp shown (HH:MM format)
- [ ] User name displayed
- [ ] Drawer name shown
- [ ] Amount breakdown (USD + LBP)
- [ ] Variance shown for closings
- [ ] Filter by date works
- [ ] Filter by type works
- [ ] Filter by drawer works
- [ ] Empty state when no checkpoints
- [ ] Loading state while fetching
- [ ] All tests pass
- [ ] TypeScript compilation (0 errors)
- [ ] Build successful

---

## 📁 Files to Modify

### Create:
1. `frontend/src/features/closing/pages/CheckpointTimeline/index.tsx`
2. `frontend/src/features/closing/pages/CheckpointTimeline/__tests__/`

### Modify:
1. `packages/core/src/repositories/ClosingRepository.ts`
2. `packages/core/src/services/ClosingService.ts`
3. `electron-app/handlers/closingHandlers.ts`
4. `frontend/src/types/electron.d.ts`
5. `frontend/src/app/App.tsx`
6. `frontend/src/shared/components/layouts/Sidebar.tsx`

---

## 🚀 Estimated Time: 2.5-3 hours

**Ready for Implementation** ✅
