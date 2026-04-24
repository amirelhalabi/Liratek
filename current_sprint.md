# LiraTek POS — Current Sprint

> **Sprint Focus:** Exchange Rate System, OMT/Whish fixes, Sell Prices & Dev Testing  
> **Created:** 2026-04-23  
> **Last Updated:** 2026-04-23  
> **Status Legend:** `TODO` | `IN PROGRESS` | `DONE` | `BLOCKED`

---

## Exchange Rate System & OMT/Whish (High Priority)

| ID     | Task                                 | Status | Notes                                                                      |
| ------ | ------------------------------------ | ------ | -------------------------------------------------------------------------- |
| CS-001 | Whish App SEND/RECEIVE toggle        | TODO   | Toggle is explicitly hidden for WISH_APP, needs to be enabled              |
| CS-002 | OMT System Rate settings UI          | TODO   | No settings UI or `system_settings` entries exist for OMT rates            |
| CS-003 | Whish System Rate settings UI        | TODO   | No settings UI or `system_settings` entries exist for Whish rates          |
| CS-004 | All rates dynamically loaded from DB | TODO   | Rates should come from `exchange_rates` / `system_settings`, not hardcoded |

---

## Sell Prices & Dev Mode Testing (Medium Priority)

| ID     | Task                              | Status | Notes                                                    |
| ------ | --------------------------------- | ------ | -------------------------------------------------------- |
| CS-005 | Update remaining sell prices      | TODO   | ~48% done — 199 items still have sell price "0"          |
| CS-006 | Dev mode full transaction testing | TODO   | End-to-end test of all transaction types in dev mode     |
| CS-007 | Price validation (cost < sell)    | TODO   | Validate that selling price > cost price on product save |

---

## Summary

| Priority  | Total | Done  | Remaining |
| --------- | ----- | ----- | --------- |
| High      | 4     | 0     | 4         |
| Medium    | 3     | 0     | 3         |
| **Total** | **7** | **0** | **7**     |

---

> **Recommendation:** Start with CS-001 (Whish App SEND/RECEIVE toggle) — likely the smallest change since the feature is already implemented but hidden.
