# Quickstart: Profits tenant audit script

1. Unit tests (no network): `node --test scripts/__tests__/profitsAuditChecks.test.mjs` → every check test passes; `# fail 0`.
2. Syntax: `node --check scripts/profits-audit.mjs && node --check scripts/lib/profitsAuditChecks.mjs`.
3. Usage error: run without env vars → exit 2, message names the missing variable, no request sent.
4. Live (once, sequential, owner credentials in env only):
   `LIRATEK_PASSWORD=… LIRATEK_PROFITS_PASSWORD=… yarn profits:audit --host cornertech.liratek.shop --user admin --from 2026-09-01 --to 2026-11-16`
   → expected baseline until LIRA-393–396 ship: FAIL on views-agree (#2), Katsh price − cost (#3), negative paid / refunded "still owes" (#4), enum/blank detail (#5), `ClientN` counterpart (#6); exit 1; run time < 60 s.
5. Replay without network: `node scripts/profits-audit.mjs --input <saved file>` → same verdict, zero requests.

**Live result 2026-11-18** (31 requests, 37.0 s): FAIL #2, #3 (30 Katsh + 17 SALE + 1 CUSTOM_SERVICE rows), #4 (1 negative paid + 6 refunded/emptied "still owes"), #5, #6; #7 INFO (SALE 11, TOPUP_BUYBACK 51 zero rows); #1 and #9 PASS.
