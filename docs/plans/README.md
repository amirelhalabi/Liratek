# Plans

Three folders, split by **how far the work has got**, not by how important it
is:

- **`todo_plans/`** — nothing built yet. Designs awaiting approval,
  diagnoses, triage lists, and read-only audits whose findings nobody has
  acted on.
- **`ongoing_plans/`** — started and unfinished. Some phases shipped, some
  did not, and the document itself names what is left. This is where a plan
  spends most of its life, and the folder that is worth reading before
  picking up new work.
- **`done_plans/`** — fully shipped, kept as the design record. Specs and
  code comments reference them; do not delete.

The middle folder exists because the two-folder version could not express the
common case. A plan with four phases where two shipped is neither "todo" nor
"done", and calling it either loses the fact that half the work is live —
which is exactly the fact you need when deciding what to touch next.

## Moving a plan

When a plan's first ticket ships, `git mv` it to `ongoing_plans/`. When the
last one ships, flip its status to ✅ and `git mv` it to `done_plans/`.

Either way, update the `docs/plans/...` references repo-wide — source
comments, spec headers, `CLAUDE.md`. A stale path is worse than none, because
it reads as authoritative.

**Do not rewrite paths inside `done_plans/`.** Those are historical records;
a reference that was correct when written should stay as written.

## Deciding which folder

Read the plan's own status section, and keep reading past the header. Headers
in this repo go stale within days — `FOR_PARTNER_AND_COST_UNIFICATION_PLAN`
carries a note about exactly that, added after two sections marked
"remaining" turned out to have shipped. The reliable signal is usually near
the bottom: a closure record, a "what is NOT done" section, or a summary
line naming the items left.

Two traps worth naming, both hit during the 2026-09-10 sweep:

- A header saying **IMPLEMENTED** or **SHIPPED** may still have a phase
  outstanding. `EXCHANGE_LOT_SETTLEMENT` says "IMPLEMENTED" and, in the same
  sentence, "e2e guard still pending (Phase 8)".
- A plan may list items that read as open but are explicitly **another
  document's scope**. `BIDIRECTIONAL_PAYMENT_LEGS_PLAN` has three, all
  labelled as deliberate non-goals, and it is genuinely complete.

A `//TODO` in the body is not automatically a remainder either — several mark
features the owner deferred on purpose, which belong to a future plan rather
than this one.
