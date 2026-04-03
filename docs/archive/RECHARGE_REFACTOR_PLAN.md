# Recharge Page Refactoring Plan

**Status:** ✅ **COMPLETED** — March 16, 2026  
**Sprint Task:** T-65

## Goal ✅

Split the 3300-line `frontend/src/features/recharge/pages/Recharge/index.tsx` into maintainable, focused components while preserving all functionality.

## Architecture ✅

### What Goes Where

**NOT moving to @liratek/ui:**

- The form components (FinancialForm, KatchForm, TelecomForm, CryptoForm) are feature-specific, not generic UI
- They depend on app-specific types, APIs, and business logic

**Keeping in feature folder:**

- All recharge-related components stay in `frontend/src/features/recharge/`

### New File Structure ✅

```
frontend/src/features/recharge/
├── pages/
│   └── Recharge/
│       └── index.tsx (MobileRecharge.tsx - orchestrator only, 586 lines)
├── components/
│   ├── FinancialForm.tsx (630 lines) - OMT_APP, WISH_APP, IPEC form
│   ├── KatchForm.tsx (680 lines) - KATCH card grid with batch submission
│   ├── TelecomForm.tsx (520 lines) - MTC, Alfa recharge
│   ├── CryptoForm.tsx (280 lines) - BINANCE transactions
│   ├── HistoryModal.tsx (155 lines) - Reusable history modal
│   ├── ProviderStats.tsx (83 lines) - Stats cards (today's commission, etc.)
│   ├── ProviderTabs.tsx (46 lines) - Provider tab navigation
│   └── CompactStats.tsx (86 lines) - Compact inline stats for header
└── types/
    └── index.ts (180 lines) - All types and constants
```

### Component Responsibilities ✅

All components implemented as specified. See original plan for details.

## Migration Steps ✅

1. ✅ Create types file
2. ✅ Create HistoryModal component
3. ✅ Create ProviderStats component
4. ✅ Create ProviderTabs component
5. ✅ Extract FinancialForm
6. ✅ Extract KatchForm
7. ✅ Extract TelecomForm
8. ✅ Extract CryptoForm
9. ✅ Clean up main index.tsx (586 lines, down from 3302)
10. ✅ Update imports and verify typecheck/lint
11. ✅ Add CompactStats component for inline header stats
12. ✅ Typecheck passes
13. ✅ Lint passes (0 errors, 342 warnings - pre-existing)

## Benefits ✅ Realized

- **Maintainability**: ✅ Each form is isolated, easier to debug
- **Reusability**: ✅ HistoryModal, ProviderStats, CompactStats can be used elsewhere
- **Readability**: ✅ No more 3300-line file (now 586 lines)
- **Performance**: ✅ Components can be lazy-loaded if needed
- **Testing**: ✅ Each component can be tested independently

## Files Modified

| File                                                      | Change                                                |
| --------------------------------------------------------- | ----------------------------------------------------- |
| `frontend/src/features/recharge/pages/Recharge/index.tsx` | 3302 → 586 lines, imports 8 components                |
| `frontend/src/features/recharge/components/*.tsx` (8 new) | Extracted form components, stats, tabs, history modal |
| `frontend/src/features/recharge/types/index.ts`           | Shared types and constants                            |
| `frontend/src/features/recharge/components/index.ts`      | Barrel exports                                        |

---
