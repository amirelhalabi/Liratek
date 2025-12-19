# Current Sprint (Dec 19–Dec 26, 2025)

Note: This is the canonical, single source of truth for active work, backlog, and done. Older planning/status docs are deprecated in favor of this file.

Goal: Type-safe cross-layer contracts, UI polish (services/exchange), and event/logging consistency.

In Progress
- Phase 3: Repositories typing — ProductRepository done; SalesRepository deep-typed (rows, aggregates)

Todo
- Introduce toErrorString helper for consistent error normalization across services; refactor callers incrementally (completed)
- Add global Window interface augmentation for notificationHistory/currentUserId to remove scattered casts (completed)
- Consolidate shared DTOs into packages/shared and align imports (completed: core DTOs moved to @liratek/shared; renderer re-export; electron.d.ts updated)
- Tighten TypeScript config incrementally (completed: enabled noImplicitOverride + exactOptionalPropertyTypes across app/electron/node; checks green)
- Repository error typing: introduce discriminated unions for known DB codes and normalize at repo boundary (completed)
- Drive remaining lint warnings to zero in flagged files (ClosingRepository, Maintenance, POS, etc.) (completed)
- Phase 3 next: ClientRepository cleanup (remove any, add row DTOs) — completed; ran lint/typecheck/tests
- Phase 3 then: ClosingRepository cleanup (remove any, add row DTOs) — completed; ran lint/typecheck/tests
- Phase 3 later: Handlers sweep (dbHandlers, inventoryHandlers, maintenanceHandlers, reportHandlers, salesHandlers) — completed; checks passed
- Phase 3 final: Repository-wide pass (ProductRepository completed; RechargeRepository completed; CurrencyRepository clean; ActivityRepository clean; next: service/UI hotspots) — continuing detailed cleanup; tests green

Ready for Testing

Completed
- Opening/Closing: Opening modal is now accessible from anywhere (moved listener/modal to MainLayout)
- Modals: click-outside-to-close enabled across key modals (Opening/Closing, POS Checkout + receipt preview, ProductForm, ClientForm, Expenses, Debts, Maintenance)
- Modals: fixed rounded corner clipping (added overflow-hidden to containers)
- Tests: fixed React act(...) warning in useCurrencies hook test
- Maintenance hooks cleanup (avoid set-state-in-effect)
- Notifications: Introduced NotificationItem and typed TopBar/NotificationCenter
- POS: Typed drafts, checkout handlers, and removed remaining any types
- Lint executed; reduced warnings in appEvents/NotificationCenter and Settings UI; remaining warnings deferred to next passes
- appEvents: typed overloads with generic fallback (keeps tests like "ping")
- Preload typing pass: Inventory, Clients, Debt, Exchange, OMT, Closing payloads
- Activity logs: unified to details_json across repositories (FinancialService, Exchange, Recharge, Maintenance)
- Legacy DB migration: ensured activity_logs.details_json; OMT/Whish transaction retest passed
- Phase 2 progress: Cleaned error handling in Settings, Expense, Rate, Report, Currency, Client, Closing, Exchange, Financial, Inventory, Sales, and Maintenance services; tests all green
- Services/Exchange layout: constrained cards to max-h-[80vh], reduced padding
- Debts/Dashboard: introduced concrete DTO types; tooltip formatter typed
- ClientForm: normalized whatsapp_opt_in to 0/1 and separated create/update payloads
- Services page layout: adjusted OMT/Whish cards to fit viewport without nested scroll
- Quotation: Confirmed Developer Total (excl. Hardware) is $1000
- Checks: yarn lint, typecheck, tests (413), coverage summary generated, and build succeeded
- Phase 3 progress: ProductRepository typing improvements (removed any in error paths), SalesRepository catch normalization

Checks
- Lint/Typecheck/Tests/Coverage run daily; gate merges on passing status.

Backlog
- Code signing and auto-updates (deferred to v1.1+)
- Multi-location support
- Real-time drawer balance improvements
- Optimization pass (runtime perf + build size)
- Opening/Closing Phase 2 improvements
- Marketing plan follow-ups

Notes
- Quotation template updated to reflect $1000 developer total (excluding hardware).
- Lint is currently clean in CI checks; keep it at 0 warnings going forward.
