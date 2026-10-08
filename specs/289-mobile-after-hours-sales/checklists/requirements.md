# Specification Quality Checklist: Mobile app — owner records and tracks digital sales from the phone

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-10-08
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- Iteration 1: one acceptance scenario (Story 1, #2) stated how a Katch sale moves balances without that being verified against the existing flow; reworded to "exactly as at the counter", which FR-002 already requires.
- No clarification markers were used. Two scope choices were made as defaults and recorded under Assumptions, for the owner to confirm in `/speckit-clarify`: MTC/Alfa recharge is out of this version; Binance is a payment choice only, not a sale type.
- The Assumptions section names one load-bearing unknown for `/speckit-plan`: whether closing is per drawer or per shop, and whether the expected balance is calculated since the last closing or by calendar date (drives FR-008 to FR-010).
- "Installable on the home screen" (FR-019) and the web-only exception are product scope, not implementation choices.
- Iteration 2 (owner, second round): added sign-in (User Story 1, FR-022 to FR-028, SC-008/SC-009); store apps for Android and iOS replace the installable web app (FR-019). Expo is recorded as an owner constraint under Clarifications and Assumptions, not as a design choice of the spec.
- One [NEEDS CLARIFICATION] marker is open: how the shop is decided when a username exists in several shops (Edge Cases). Waiting on the owner.
- New dependency: LIRA-288 (per-shop Google sign-in, platform sign-in directory) for Google sign-in without the current one-shop and shared-database limits.
- Iteration 3 (owner, third round): marker resolved. Google sign-in opens the shop of the account's owner (exactly one, no shop list); password sign-in takes shop address + username + password, matched inside that shop only; no Sign in with Apple for now; "Create your shop" in the app sends the existing email sign-up link and the rest happens on the web (FR-023 to FR-025, FR-029). All items pass.
- Iteration 4 (planning research, owner decision): LiraTek has no "day closed" state, so the next-business-day rule was replaced by the local calendar day. Story 3, FR-007 to FR-011, Key Entities and SC-003/SC-005 rewritten; FR-012 retired. "Owner" defined as the admin role. All items still pass.
