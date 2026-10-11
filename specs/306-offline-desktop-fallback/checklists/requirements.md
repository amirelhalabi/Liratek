# Specification Quality Checklist: Offline desktop fallback (events redesign)

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-10-11
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs) — _exception, deliberate:_ the "Verified facts" section and
      a few FRs name tables/channels because the owner's N4/N5 are themselves mechanism-level decisions; user stories and
      success criteria stay in shop language.
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders (stories, edge cases, success criteria)
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain (two owner confirmations tracked as O-new-7 / O-new-8, not blockers for design)
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (SC-001…SC-007 automated, SC-008 owner-measured)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded (vouchers and catalog online-only; Phase D and Litestream out)
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows (replay, multi-PC merge, review, copies, offline mode, switch-on)
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into user stories

## Notes

- Validation pass 1 (2026-10-11): all items pass; the mechanism-level FRs are kept on purpose (owner decisions N4/N5).

## Analyze passes (speckit-analyze, fresh independent reviewer each pass)

### Pass 1 — CRITICAL 1, HIGH 8, MEDIUM 17, LOW 6

| ID | Sev | Resolution |
| --- | --- | --- |
| CON-1 | CRITICAL | Device-key routes / actor-from-event (E1–E3) put behind owner gate **G0**; `[G0]` tasks listed; core work proceeds. E4 closed inside its own task (REST route first). |
| DEF-1 | HIGH | `effectiveNow` applies to every offline/checkpoint channel; central writers (`createTransaction`, `moneyPosting`, sales, repayment, expense) swept first (T036–T037). |
| DEF-2 | HIGH | `requestNow` guard also catches INSERTs relying on a `created_at` default (void reversal row) (T026). |
| DEF-3 | HIGH | Dedicated replay connection via `dbOverride` in the tenant context; web writes wait, never join (FR-018, R6, T033). _Superseded in pass 2 (H1) and pass 3 (D2): no second connection; no-yield invariant + `REPLAY_IN_PROGRESS` refusal._ |
| DEF-4 | HIGH | Dependants of a skipped certain duplicate held until Mark reviewed / Book anyway (FR-026, T058). |
| DEF-5 | HIGH | Existing working copy resumed at boot; sequence from outbox max inside the transaction; id counters from max of all sources (FR-008a, T117, T123). |
| DEF-6 | HIGH | Re-pair re-keys the same device row (FR-001a); `SEQ_CONFLICT` defined. |
| DEF-7 | HIGH | Event records the rates in force; replay uses them; `rate_changed` note (FR-021a, O-new-24, T036). |
| CON-2 | HIGH | Scenario test T051, bindings guard T077, policy guard T009 moved first; combined tasks split; pinning tests labelled honestly. |
| MEDIUM/LOW | — | INC-1 `offline:*` in policy (422/local 24); INC-2 `pendingLift`; INC-3 `OFFLINE_ID_EXCLUDED_TABLES`; DEF-8 manifest flags only unexplained rows; DEF-9 reads wait during a write window; DEF-10 main-row-only mapping after replay-only rules; DEF-11 schema fingerprint + double-parse guard; DEF-12 notes on every clamp/backward time; INC-4 one clamp bound; AMB-1 Apply bypasses only the hold reason; DEF-13 handler/binding parity (T110); DEF-14 + INC-6 id-order kept (O-new-19 revised), `DebtRepository:1320` dropped; UND-1 finishing → offline; UND-2 ready after last finish; UND-3 numeric strings; COV-1/2/3 added; INC-7/8 fixed; CON-3 `OfflineOutboxRepository`; UND-4 FR refs on tasks; UND-5 not taken (optional). |

### Pass 2 — CRITICAL 1, HIGH 7, MEDIUM 11, LOW 9

| ID | Sev | Resolution |
| --- | --- | --- |
| C1 | CRITICAL | G0 widened: device service + actor policy (T029–T030), review routes/page/PCs panel (T070–T076), e2e helpers (T002–T003) tagged `[G0]`; plan gate text lists exactly what is gated; E1 row covers both halves. |
| H1 | HIGH | Dedicated replay connection dropped; invariant "an event transaction never yields to the event loop" with a `setImmediate` sentinel guard (R6, FR-018, T033); PC queues `local` channels too and paired modes stop writing timers. |
| H2 | HIGH | plan §F and US2 AS-3 now say: skipped, no map rows, dependants wait until Mark reviewed / Book anyway. |
| H3 | HIGH | Sequence = max(outbox, `pairing.json` lastSeq, server maxSeq) + 1 everywhere (FR-011, FR-008a, R1, data-model, ipc contract, T123, T125). |
| H4 | HIGH | Content-rejected events stored as `refused` and acked (gap-free); identity conflicts stop the queue and show on the PCs panel (FR-015, REST contract, T031, T131). |
| H5 | HIGH | All rate readers routed through `getEffectiveRate()`; guard against raw `exchange_rates` reads; path corrected (R11, FR-021a, T017, T026, Phase 6 (a)). |
| H6 | HIGH | Plan §C: web sale S#881 moved to 10:12 (within 5 min of P2.e1 at 10:10). |
| H7 | HIGH | Version compatibility by schema shape (added optional keys without defaults are compatible); incompatible → review with content for re-entry, Dismiss only; operations rule (FR-016, R9, O-new-26, T027). |
| MEDIUM/LOW | — | M1 `timeless` flag removed; M2 note compares with current server rate; M3 SQLite text format + date-range assertions (T036); M4 candidates exclude every server row this PC created (result_json); M5 stock path maps fully, distinct "could not be linked" reason; M6 ready after events processed + 24 h warning; M7 re-key restricted; M8 T104 written first; M9 cart writes moved behind a service (T081); M10 transition table; M11 id map + review items wiped on Reset Data; L1 path; L2 49; L3 `deviceNo` from pairing.json; L4 quickstart names; L5 range; L6 plan comment; L7 US3 note list; L8 labels; L9 carrier usage decided. |

### Pass 3 (final — owner capped analyze at 3 passes) — CRITICAL 0, HIGH 4, MEDIUM 9, LOW 11

No CRITICAL remains, so no re-check was needed. Per the owner's rule each remaining HIGH became an explicit
failing-first test task placed before the implementation it guards (the design text was corrected too):

| ID | HIGH | → test task (before) |
| --- | --- | --- |
| D1 | positional ids (`session:update`, `session:cart:add`, `loto:checkpoint:update`) stripped by body-only schemas → never rewritten | **T011** `offline/__tests__/argEnvelope.test.ts` (before T012) |
| D2 | no-yield guard only detected a yield; a web write could be silently undone | **T034** `offline/__tests__/replayIsolation.test.ts` — `REPLAY_IN_PROGRESS` refusal (before T035); plus T077 microtask-only assertion over all bindings |
| D3 | duplicate links paired child rows by order → wrong item refunded | **T059** `offline/__tests__/duplicateLinkMainRowOnly.test.ts` (before T060, T069) |
| D4 | rate readers misnamed; `lotMarketRate.ts` is browser-reachable (rule 29) | **T016** `utils/__tests__/effectiveRate.readers.test.ts` (before T017) |

MEDIUM/LOW fixed in text: D5 one time function/format; I1 T048 phrase; D6 checkpoint Apply recomputes expected
amounts; A1 `MAP_EXCLUDED_TABLES` named (basket tables mapped); I2 plan gate lines; G1 banner tasks `[G0]`; D7
"renumber unsent work" recovery; D11 guarantee narrowed + held items listed on standby; D8 strict rates schema; G2,
D9, D10, D12, D14 (receipt alias web-only), I3, I4, I5, I7, I9. **Left as is**: I6 (T067 combines a backend test and
its route in one task — low risk, the test is still written first inside the task).
