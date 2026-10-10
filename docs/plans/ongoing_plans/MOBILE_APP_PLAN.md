# Mobile app (LIRA-289) — pointer

**Status:** 🔶 ONGOING — build started 2026-10-10, uncommitted. Ticket: LIRA-289 in `current_sprint.md`.

The plan for this feature is the Spec Kit folder, not this file. This page exists so the plan board
(`PLAN_OVERVIEW.md`) can list it with the other open work.

| What | Where |
| --- | --- |
| What and why (stories, requirements, owner decisions) | `specs/289-mobile-after-hours-sales/spec.md` |
| How (structure, constitution check, slices) | `specs/289-mobile-after-hours-sales/plan.md` |
| Findings and decisions R1–R12 | `specs/289-mobile-after-hours-sales/research.md` |
| API contract | `specs/289-mobile-after-hours-sales/contracts/mobile-api.md` |
| How to run and check it | `specs/289-mobile-after-hours-sales/quickstart.md` |
| Task list (62; 8 done) | `specs/289-mobile-after-hours-sales/tasks.md` |
| Code | `mobile/` (Expo SDK 55), `backend/src/api/mobileAuth.ts`, `packages/core/src/validators/mobileAuth.ts` |

**In one paragraph.**
- **Who and what:** a native Android + iOS app (Expo) for shop **admins**. It records the digital sales that need
  no hand-over (Whish App / OMT App transfers, Katch / iPick vouchers), even after the shop closes. Payment is on
  the customer's account or into the Whish, OMT or Binance wallet.
- **Tracking:** the app shows balances, client debt and the sales made since the last drawer count.
- **Sign-in:** Google, or shop address + username + password.
- **Day rule:** sales count on the shop's local calendar day.
- **Scope:** web-app shops only. Desktop shops' data is not reachable from a phone.

**Remaining, in order:**
1. Local-date reports and since-last-count. Benefits desktop and web on its own.
2. Sign-in hardening: test, `MobileAuthService`, Google.
3. Double-save protection.
4. Shared sale-payload builders.
5. Sale screens.
6. Tracking and repayment.
7. Store readiness.
