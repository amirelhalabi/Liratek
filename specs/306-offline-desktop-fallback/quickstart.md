# Quickstart — proving LIRA-306 slice by slice

Prereqs: Node ABI for core/backend jest and web e2e (`node -e "const D=require('better-sqlite3'); new D(':memory:'); console.log('Node ABI')"`
must construct a database). Never launch Electron on this Mac (G5). Confirm every green run actually ran (suite/test
counts and elapsed time, rule 28).

| Slice | Prove it with | Expected |
| --- | --- | --- |
| Pure modules (policy, id range, id positions) | `yarn workspace @liratek/core test offline/` | guards fail on an unclassified channel / undeclared id key; LBP amount ≥ 10¹² in an amount key untouched |
| Migration v210 | core jest migration test + `yarn check:schema-equivalence` | tables in both files; `down()` drops them |
| Replay engine + id map | core jest `ReplayEngine.*.test.ts` | scenario client → sale on account → repayment → refund lands on server rows; parity per currency (SC-001) |
| Effective now | core jest per family `*.replayTime.test.ts` | 23:50 day N replayed on N+1 → every timestamp on day N |
| Merge + skew | core jest `OfflineMergeProcessor.basic.test.ts` / `.multiPc.test.ts` | plan §D order; gap stops one PC; skew correction + clamp |
| Duplicates | core jest `DuplicateDetector.test.ts` | certain → skipped + note; likely → held; near-misses booked |
| Device + review routes | backend jest `offlineDevice.api.test.ts` (after G0) / `offlineReview.api.test.ts` (tenant ≠ 1, see `jest.setup.ts` trap) | envelopes, admin-only review, device key scoping |
| Web e2e (after G0) | `yarn test:e2e:web -g "lira-web-05[56]"` (`OFFLINE_MERGE_GATHER_MS=0` in the web config) | 055: upload through device API, rows booked once on the right day, resend no-op; 056: review page apply/dismiss/book-anyway/mark reviewed, staff refused |
| Snapshot | core jest `tenantSnapshot.test.ts` (two shops) | only the shop's rows; secrets stripped; high-water marks |
| Desktop recorder / modes | `yarn workspace @liratek/electron-app test offline/` | write + event in one transaction; online-only refused; id seeding; manifest — **desktop behaviour unverified until CI/Windows** |
| Owner drill | `docs/OPERATIONS.md` runbook | two PCs + phone; review list shows only the planted duplicates and drawer counts |
