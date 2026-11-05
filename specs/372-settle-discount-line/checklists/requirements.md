# Specification Quality Checklist: One Discount line on every settle screen

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-11-05
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

- Replaces part of LIRA-365 (2026-10-31) and the LIRA-310 follow-up (2026-10-12); recorded in Clarifications.
- Confirmed 2026-11-05: Debts Forgive shrinks from "up to the due" to $5 / 450,000 LBP for every role; bigger amounts go through an admin's Write off (FR-009).
- After planning, the owner decided that the payment line follows the discount on all 7 screens (FR-010), that a mixed-direction Settle Account keeps its refusal (FR-011), and that batch Settle shows the line only when the shop pays (FR-002).
