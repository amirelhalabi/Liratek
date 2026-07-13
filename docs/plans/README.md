# Plans

- **`todo_plans/`** — active or not-yet-built plans. A plan lives here while
  any of its tickets is open.
- **`done_plans/`** — fully shipped plans, kept as the design record (specs
  and code comments reference them; do not delete).

When the last ticket of a plan ships: flip its status table to ✅, `git mv` it
to `done_plans/`, and update any `docs/plans/...` references repo-wide
(source comments, spec headers, CLAUDE.md).

Current active plans (2026-07-14):

| Plan | State |
| --- | --- |
| `todo_plans/COUNTERPARTY_CONSOLIDATION_PLAN.md` | CQ-0…CQ-6 not started |
| `todo_plans/WEB_PARITY_ROADMAP.md` | living tracker (dual-transport status) |
| `todo_plans/MULTI_TENANT_IMPLEMENTATION_PLAN.md` | core shipped (v123); later phases (super-admin realm, impersonation) open |
| `todo_plans/session-basket-payment-remaining.md` | remaining session-basket items |
