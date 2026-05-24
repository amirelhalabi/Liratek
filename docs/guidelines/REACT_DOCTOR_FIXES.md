# React Doctor Fixes

**Baseline**: 87 → **94/100** (1 error, 70 warnings)

All actionable fixes have been applied, including recharts lazy loading via `React.lazy()` + `Suspense` with dedicated `DashboardChart.tsx` and `CommissionsChart.tsx` wrapper components.

---

## Rules intentionally skipped

- **prefer-useReducer** (29 instances): Style preference, not a bug. Track as tech debt.
- **no-giant-component** (19 instances): Architectural change, not a quick fix. Track as tech debt.
- **no-effect-event-handler** (9 instances): Needs case-by-case review.
