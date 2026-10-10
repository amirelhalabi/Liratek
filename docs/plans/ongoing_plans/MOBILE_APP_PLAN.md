# Mobile app (LIRA-289) — pointer

**Status:** 🔶 ONGOING — first phone version built 2026-10-10 (39 of 62 tasks). Committed; pushed up to `062ce29a`. Ticket: LIRA-289 in `current_sprint.md`.

The plan for this feature is the Spec Kit folder, not this file. This page exists so the plan board
(`PLAN_OVERVIEW.md`) can list it with the other open work.

| What | Where |
| --- | --- |
| What and why (stories, requirements, owner decisions) | `specs/289-mobile-after-hours-sales/spec.md` |
| How (structure, constitution check, slices) | `specs/289-mobile-after-hours-sales/plan.md` |
| Findings and decisions R1–R12 | `specs/289-mobile-after-hours-sales/research.md` |
| API contract | `specs/289-mobile-after-hours-sales/contracts/mobile-api.md` |
| How to run and check it | `specs/289-mobile-after-hours-sales/quickstart.md` |
| Task list (62; 39 done) | `specs/289-mobile-after-hours-sales/tasks.md` |
| Code | `mobile/` (Expo SDK 55), `backend/src/api/mobileAuth.ts`, `packages/core/src/validators/mobileAuth.ts` |

**In one paragraph.**
- **Who and what:** a native Android + iOS app (Expo) for shop **admins**. It records the digital sales that need
  no hand-over (Whish App / OMT App transfers, Katsh / iPick vouchers), even after the shop closes. Payment is on
  the customer's account or into the Whish, OMT or Binance wallet.
- **Tracking:** the app shows balances, client debt and the sales made since the last drawer count.
- **Sign-in:** Google, or shop address + username + password.
- **Day rule:** sales count on the shop's local calendar day.
- **Scope:** web-app shops only. Desktop shops' data is not reachable from a phone.

**Remaining:**
1. Release the phone APK to cornertech: push the local commits, then rebuild the APK.
2. Phone UI tests (Maestro), and web/desktop e2e for the count panel.
3. Store readiness (`docs/OPERATIONS.md`, "Phone app").
4. Deferred by the owner: Google sign-in and Binance as a phone payment. Katsh/iPick catalog sales (vouchers,
   cards) were built 2026-10-10 in LIRA-302 (`specs/302-mobile-catalog-sales/`); bills stay on web/desktop.
