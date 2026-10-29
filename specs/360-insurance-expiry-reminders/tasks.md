# Tasks: Insurance expiry reminders (LIRA-360)

**Input**: `specs/360-insurance-expiry-reminders/` — spec.md, plan.md, research.md, data-model.md, contracts/insurance-renewals.md, quickstart.md

**Tests**: Required by the project (rule 17): each guard test is written FIRST, run against the unfixed code, and its real failure recorded before the implementation task. Ask the owner before running any test; run only the named paths.

**Format**: `- [ ] T### [P?] [US?] Description with file path`

---

## Phase 1: Setup

- [ ] T001 Read `docs/FEATURE_GUIDE.md` §13 and confirm in a one-line note in `current_sprint.md` (LIRA-360) that this feature writes no transaction, payment, drawer or ledger row (no money flow; the insurance sale itself is unchanged except the new `insurance_type` field)
- [ ] T002 Confirm the last migration in `packages/core/src/db/migrations/index.ts` is still v226 (another session may have added one); use the next number in T005

---

## Phase 2: Foundational (blocks every story)

- [ ] T003 [P] Write failing pure-helper tests in `packages/core/src/utils/__tests__/insuranceRenewal.test.ts`: `addOneCalendarYear("2024-02-29") === "2025-02-28"`; `daysBetween` table from quickstart.md with today `2026-10-29` (8→not listed, 7, 0, −1, −150, −608 listed); `normalizePhoneForMatch` makes `+961 70 123 456`, `0096170123456`, `070-123-456`, `70123456` equal and returns `""` for null/blank; `selectInsuranceRenewals(rows, today)` drops renewed rows (same `client_id`; same normalised phone; same type only; untyped older row renewed by any type; tie on sale_day broken by id), drops dismissed rows, sorts by `days_left` ascending
- [ ] T004 Create pure module `packages/core/src/utils/insuranceRenewal.ts` (no imports beyond other pure utils — rule 29): `INSURANCE_TYPES = ["COMPULSORY","THIRD_PARTY","DOMESTIC_WORKER","ALL_RISK","LIFE"] as const`, `InsuranceType`, `INSURANCE_RENEWAL_WARNING_DAYS = 7`, `addOneCalendarYear(day)`, `daysBetween(from, to)` on `YYYY-MM-DD` strings (UTC date math, never host zone), `normalizePhoneForMatch(phone)` (digits only; strip leading `00961` or `961`; strip one leading `0`), `InsuranceRenewalCandidate`/`InsuranceRenewal` types per data-model.md, `selectInsuranceRenewals(candidates, today)` implementing research R6 (renewer must be live; dismissed renewer still counts). Make T003 pass
- [ ] T005 Add migration v227 in `packages/core/src/db/migrations/index.ts`: `ALTER TABLE custom_services ADD COLUMN insurance_type TEXT DEFAULT NULL`, `renewal_dismissed_at TEXT DEFAULT NULL`, `renewal_dismissed_by TEXT DEFAULT NULL`, with a `down()` that removes them (follow an existing column-drop migration's pattern); use the `add-migration` skill
- [ ] T006 Add the same three columns to `custom_services` in `electron-app/create_db.sql` and bump its recorded schema version (rule 10)
- [ ] T007 Export `INSURANCE_TYPES`, `InsuranceType`, `InsuranceRenewal`, `INSURANCE_RENEWAL_WARNING_DAYS`, `normalizePhoneForMatch` from both `packages/core/src/index.ts` and `packages/core/src/browser.ts` (uncommitted LIRA-359 edits are in these files — append only, do not reformat)

**Checkpoint**: core helper green; schema has the columns.

---

## Phase 3: User Story 3 — Pick the insurance type when selling (P1)

Built first because US2's renewal rule needs typed sales. **Independent test**: Insurance category → type picker required; History shows the chosen type.

- [ ] T008 [US3] Rule-23 three-way key diff for `custom-services:add`: list keys in `createCustomServiceSchema` (`packages/core/src/validators/customService.ts`), the `preload.ts` binding `data` type, and the fields `CustomServiceRepository.addService` INSERT reads; record the result in the PR description / sprint note before editing
- [ ] T009 [US3] Write failing tests in `packages/core/src/validators/__tests__/customService.insuranceType.test.ts`: insurance + `insurance_type: "LIFE"` accepted; insurance with no type accepted (research R12 — server optional); `category: "repair"` + `insurance_type` refused; unknown code `"MAID"` refused
- [ ] T010 [US3] Add `insurance_type: z.enum(INSURANCE_TYPES).optional()` to `createCustomServiceSchema` plus a refine "insurance_type only for category insurance" in `packages/core/src/validators/customService.ts`; make T009 pass
- [ ] T011 [US3] Write failing repository test in `packages/core/src/repositories/__tests__/CustomServiceRepository.lira360InsuranceRenewals.test.ts` (new file): an insurance added with `insurance_type: "COMPULSORY"` reads back `insurance_type` from the history read
- [ ] T012 [US3] Persist and project `insurance_type` in `packages/core/src/repositories/CustomServiceRepository.ts`: INSERT column list + value (`data.insurance_type ?? null`), `getHistoryColumns()`, and the row interface; make T011 pass
- [ ] T013 [P] [US3] Add `insurance_type?: InsuranceType` to the `custom-services:add` binding `data` type in `electron-app/preload.ts` and `frontend/src/types/electron.d.ts` (rule 12); confirm `electron-app/schemas/index.ts` re-exports the updated schema
- [ ] T014 [US3] Rule-22 check: find every place that builds a custom-service add payload (walk-in, session cart, For Partner, offline replay — grep `custom-services:add` / `addCustomService` in `frontend/src`); confirm all go through one builder in `frontend/src/features/custom-services/pages/CustomServices/index.tsx`, and add `insurance_type` there only
- [ ] T015 [US3] Write failing frontend test `frontend/src/features/custom-services/pages/CustomServices/__tests__/CustomServices.insuranceType.test.tsx`: picker `data-testid="insurance-type-select"` hidden for other categories; submit blocked with no type; chosen type sent in the payload (field name taken from the schema, rule 24); stable `useApi` mock (rule 25)
- [ ] T016 [US3] Add the required type picker (5 options, translated labels) under the Insurance category in `frontend/src/features/custom-services/pages/CustomServices/index.tsx`, reset with `category` on submit/switch; make T015 pass
- [ ] T017 [P] [US3] Add `insuranceTypeLabel(code, t)` in `frontend/src/features/custom-services/utils/labels.ts` and locale keys (en: Compulsory, Third party, Domestic worker, All risk, Life; ar: إلزامي, ضد الغير, عاملة منزلية, شامل, حياة; other locales: English fallback) in the custom-services locale files
- [ ] T018 [US3] Show the type next to the insurance status in `frontend/src/features/custom-services/pages/CustomServices/components/HistoryModal.tsx` (blank for untyped/non-insurance)

---

## Phase 4: User Story 1 — Dashboard card (P1) 🎯 MVP

**Independent test**: sale backdated 360 days → card lists "in 5 days"; none due → empty message; module off → no card.

- [ ] T019 [US1] Extend `CustomServiceRepository.lira360InsuranceRenewals.test.ts` with failing tests for `getInsuranceRenewalCandidates()`: returns only live insurance rows (`category = 'insurance' AND status = 'completed' AND is_refunded = 0 AND COALESCE(direction,'IN') = 'IN'`) of the current tenant; `sale_day` is the shop day (`created_at = '2025-11-04 22:30:00'` with client offset +180 → `2025-11-05`); refunded, voided, OUT, other-category and other-tenant rows absent; dismissal fields returned
- [ ] T020 [US1] Implement `getInsuranceRenewalCandidates()` in `packages/core/src/repositories/CustomServiceRepository.ts` using `localDayExpr("created_at")` from `reportingTimeFragments.ts` and parameterized, tenant-scoped SQL; make T019 pass
- [ ] T021 [US1] Write failing service test `packages/core/src/services/__tests__/CustomServiceService.insuranceRenewals.test.ts` (mocked repo): `getInsuranceRenewals("2026-10-29")` returns `selectInsuranceRenewals(candidates, today)` filtered to `days_left <= 7`; no money fields in the result
- [ ] T022 [US1] Add `getInsuranceRenewals(today: string)` to `packages/core/src/services/CustomServiceService.ts`; make T021 pass
- [ ] T023 [US1] Add `insuranceRenewalsQuerySchema = z.object({ client_day: <existing ISO-day schema>.optional() })` in `packages/core/src/validators/customService.ts`, exported from both entry points
- [ ] T024 [P] [US1] IPC: `custom-services:insurance-renewals` in `electron-app/handlers/customServiceHandlers.ts` (session required, no role restriction; `validatePayload`; calls service with `client_day ?? clientDay()`; returns the raw array); preload binding + `frontend/src/types/electron.d.ts` type
- [ ] T025 [P] [US1] REST: `GET /api/custom-services/insurance-renewals` in `backend/src/api/customServices.ts`, declared BEFORE `router.get("/:id")`; `validateRequest` on query; same service call; raw array
- [ ] T026 [US1] Adapter: `getInsuranceRenewals(query)` via `ipcOrHttp` in `frontend/src/api/backendApi.ts` (payload typed `z.input<typeof insuranceRenewalsQuerySchema>` — rule 21), exposed on `frontend/src/api/ElectronApiAdapter.ts`, typed on `packages/ui/src/api/types.ts`
- [ ] T027 [US1] Write failing test `frontend/src/features/dashboard/components/__tests__/InsuranceRenewalsCard.test.tsx`: rows (name or description, phone, type label, expiry date, "in N days" / "today" / "expired N days ago"), overdue rows red first, empty message `insurance-renewals-empty`, no prices anywhere, stable `useApi` mock
- [ ] T028 [US1] Create `frontend/src/features/dashboard/components/InsuranceRenewalsCard.tsx`: calls `useApi().getInsuranceRenewals({ client_day: localDay() })` (api through a ref — rule 25), scrollable list (~5 rows visible) + total count, testids per contract §4; make T027 pass
- [ ] T029 [US1] Place the card as the third tile of the Credits & Stock grid in `frontend/src/features/dashboard/pages/Dashboard.tsx`, only when `useModules()` has `custom_services` enabled; dashboard locale keys (title "Insurance renewals", empty "No insurance renewals due", day wording) in en/ar + fallback

**Checkpoint**: MVP — the card works on both transports.

---

## Phase 5: User Story 2 — A renewal clears the reminder (P1)

Logic is already in `selectInsuranceRenewals` (T004); this phase proves it end-to-end through the repository.

- [ ] T030 [US2] Extend `CustomServiceRepository.lira360InsuranceRenewals.test.ts` (real DB, via service): renewal by client_id clears; renewal by walk-in phone `+961 70 123 456` vs stored `70123456` clears; different type does not clear; untyped old row cleared by any type; refunding the renewal brings the old row back; two old unrenewed same-type rows → only the newest listed. Record whether each fails before T004/T020 exist (rule 17: if written after, say "not proven failing-first")

---

## Phase 6: User Story 4 — Daily bell summary (P2)

**Independent test**: due insurances → one bell line; reload same day → still one.

- [ ] T031 [US4] Check whether `UINotification` in `packages/ui` supports a click target; if not, add an optional `href` and make `NotificationCenter` navigate on click (keep existing notifications unchanged)
- [ ] T032 [US4] Write failing test `frontend/src/shared/components/layouts/__tests__/TopBar.insuranceRenewals.test.tsx`: one `warning` line "Insurance: 3 expire this week, 12 expired"; zero parts omitted; nothing when empty; second poll same day adds nothing; with `localStorage` key `liratek.insuranceRenewals.lastBellDay` = today nothing is emitted; storage throwing still emits once; hidden when module off
- [ ] T033 [US4] Add the check to the TopBar poll in `frontend/src/shared/components/layouts/TopBar.tsx`: call `getInsuranceRenewals({ client_day: localDay() })`, count `0 <= days_left <= 7` and `days_left < 0`, emit once per day (in-memory key + `localStorage` wrapped in try/catch), link to `/`; layout locale keys; make T032 pass

---

## Phase 7: User Story 5 — "Won't renew" (P2)

**Independent test**: mark a listed customer → gone for every user, both apps.

- [ ] T034 [US5] Extend the repository test file with failing tests for `dismissInsuranceRenewal(id, actor)`: sets `renewal_dismissed_at` (UTC) and `renewal_dismissed_by`; row leaves `getInsuranceRenewals`; errors (`success:false`) for missing id, non-insurance, refunded/voided, already dismissed, other tenant; a later same-type sale for that customer is listed normally next year
- [ ] T035 [US5] Implement `dismissInsuranceRenewal` in `CustomServiceRepository.ts` (tenant-scoped, parameterized, guarded `WHERE renewal_dismissed_at IS NULL`) and `CustomServiceService.ts`; add `dismissInsuranceRenewalSchema = z.object({ id: z.coerce.number().int().positive() })` in `validators/customService.ts`, exported from both entry points; make T034 pass
- [ ] T036 [P] [US5] IPC `custom-services:dismiss-insurance-renewal` in `electron-app/handlers/customServiceHandlers.ts` with `requireRole(["admin","staff"])`, `validatePayload`, actor from the desktop session, envelope `{ success, error? }`; preload + `electron.d.ts`
- [ ] T037 [P] [US5] REST `POST /api/custom-services/insurance-renewals/:id/dismiss` in `backend/src/api/customServices.ts` (before `/:id` routes), `requireRole(["admin","staff"])`, actor `req.user.username`, HTTP 200 envelope
- [ ] T038 [P] [US5] Offline binding `custom-services:dismiss-insurance-renewal` in `packages/core/src/offline/bindings/customServices.ts` (actor = event actor; no `mainRow` beyond the custom_services row)
- [ ] T039 [US5] Adapter `dismissInsuranceRenewal(payload)` in `backendApi.ts` / `ElectronApiAdapter.ts` / `packages/ui/src/api/types.ts` (type `z.input<typeof dismissInsuranceRenewalSchema>`)
- [ ] T040 [US5] Extend `InsuranceRenewalsCard.test.tsx` (failing first): button `insurance-renewal-dismiss-<id>` asks for confirmation; cancel does nothing; confirm calls the adapter and refreshes the list; error shows the message. Implement in `InsuranceRenewalsCard.tsx`

---

## Phase 8: Polish & cross-cutting

- [ ] T041 Web e2e `frontend/tests/e2e-web/lira-web-0xx-insurance-renewals.spec.ts` (next free number): seed a Compulsory insurance sold 360 days ago via the API → card shows "in 5 days" → one bell line, still one after reload → sell a new Compulsory to the same phone through the UI with the type picker → row gone → "Won't renew" a second customer → gone. Assert by identity, not row position (rule 15). Run with `node scripts/run-e2e.mjs web -g "insurance renewals"` and confirm a non-zero test count
- [ ] T042 Rebuild core and sync: `cd packages/core && npm run build`, then `cp -r packages/core/dist/. node_modules/@liratek/core/dist/`; run `browserEntryIsNodeFree.guard.test.ts` (rule 29)
- [ ] T043 `yarn typecheck` and `yarn lint` (measure elapsed time; a sub-second clean run is not a pass)
- [ ] T044 Release notes (rule 30): bullet lines under Dashboard and Custom Services headings in `docs/release-notes/UNRELEASED.md`; a `### Insurance renewals` Highlights card with a real landscape screenshot at `frontend/public/whats-new/<next version>/insurance-renewals.png` taken from the Cedar Mobile screenshot DB; run `node scripts/build-release-notes.cjs --check`
- [ ] T045 Update `docs/FEATURE_GUIDE.md` / `frontend/tests/e2e-electron/README.md` index if they list Custom Services fields or web specs; update LIRA-360 in `current_sprint.md` with status and the "What users will notice" line

---

## Dependencies

- Phase 1 → Phase 2 → stories.
- US3 (Phase 3) before US2 proof (Phase 5) — renewal by type needs typed sales.
- US1 (Phase 4) needs Phase 2; US4 and US5 need US1's read + adapter (T020–T026).
- US2 (Phase 5) needs T004 + T020.
- Polish after all stories.

## Parallel opportunities

- T003 ‖ T005/T006 (different files).
- T013 ‖ T017 within US3.
- T024 ‖ T025 (IPC vs REST) once T022–T023 are done.
- T036 ‖ T037 ‖ T038 once T035 is done.

## Implementation strategy

1. MVP = Phases 1–4 (+ US3 since typed sales feed matching): card visible on both apps.
2. Then US2 proof, US4 bell, US5 dismiss.
3. Polish: e2e, gates, release notes. No commit without the owner's go-ahead.
