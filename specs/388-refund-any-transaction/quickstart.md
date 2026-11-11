# Quickstart: validate LIRA-388

1. Core guard: `cd packages/core && npx jest src/repositories/__tests__/lira388 --maxWorkers=2` — every owned type: create → refund → each ledger nets 0 per currency, REFUND/reversal row linked; dependency refusals write nothing; the 13 structural types refused.
2. Backend route: `yarn workspace @liratek/backend jest <path>` — staff may refund; envelope on refusal.
3. Page: `cd frontend && npx jest src/features/audit/__tests__/<page test>` — no "Void" on any standalone row, "Refund" on every refundable type, "Can't refund here" only on the non-refundable ones, every reason names an action that exists.
4. Web e2e: `rm -f frontend/test-results/e2e-web/phone_shop.web.db*; node scripts/run-e2e.mjs web view=off --min=1 lira-web-099 lira-web-037 lira-web-096` — standalone loto prize refunded from its row (drawer net 0, day prize total back), Alfa top-up refunded with one confirm, a sale refunded same-method (same money as the old Void).
