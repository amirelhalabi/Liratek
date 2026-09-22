# Owner Notes 2026-09-21 — triage, ticket mapping & verified status

> # 🔴 HIGHEST PRIORITY — this plan outranks every other item on the board
>
> This supersedes the ordering in `PLAN_OVERVIEW.md` §5 until it is worked through.
> These are **29 notes from the customer actually using the web app**, collected Tuesday /
> Wednesday / Thursday, all **before** the 2026-09-21 push (`9c0194cd`). Everything else on the
> board is an audit finding, a doc chore or an infrastructure track; this is the only document
> describing what a human hit while running the shop.
>
> **Written 2026-09-21.** Every ticket number below was checked against **source**, not against
> a status line — per the habit `PLAN_OVERVIEW.md` §0 exists to enforce. Where a plan header and
> the code disagreed, the code won, and the disagreement is called out.

**29 notes → 5 map onto existing tickets · 1 is already fixed and never had a ticket · 1 maps to
a named plan with no number · 22 need new tickets (21 new IDs; two notes share one).**

> **Progress, 2026-09-23.** Of the 22 proposed IDs, **three are now built and filed as DONE** —
> **LIRA-198** (audit visible to staff, §0.5), **LIRA-205** (returned credits in the txn table,
> note #9) and **LIRA-208** (adjust-stock discoverability, §0.7) — plus the `create_db.sql` rule-10
> repair from §0.10, which never had a number. **19 of the 22 remain open.** Two owner decisions
> were taken in the same batch and are recorded in §0.5: audit scope stays **BROAD** (staff keep
> both tabs), and the transactions-table row actions stay **VISIBLE** to staff with an explanatory
> failure message rather than being hidden behind a role check. Nine follow-up tickets —
> **LIRA-220 … LIRA-228** — came out of building the three, so the next free ID is **LIRA-229**.

**Status glyphs, used consistently throughout:**
✅ done and verified in source · 🟡 partially shipped (the row says which half) ·
🟠 open, blocked on an owner answer · ⬜ not started · ⚠ a doc or ID disagrees with the code.

**The verbatim customer notes are in Appendix A** — everything in §1 is a paraphrase.

---

## 0. The headline: what the triage actually found

Ten discoveries matter more than the counts.

### 0.1 Three notes are already fixed, and one of them shipped the same day

- **"topups trxns should be able to refund from the txn table"** → **LIRA-194, DONE**, shipped
  2026-09-21 in `9c0194cd` — *the very push these notes predate*. No work needed; confirm with
  the customer.
- **"maintenance… without phone number… remove it from validation"** → fixed 2026-09-21 in
  `ed211887`. It was a **web-only** bug (`optionalPhoneNumberSchema`); desktop was never
  affected, which is why it survived for months. It has **no ticket of its own** — it was found
  while chasing red web e2e specs and is recorded only in `OMT_OPEN_CREDIT_ACCOUNT_PLAN.md`'s
  `lira-web-030` row.
- **"charge 1 year to a customer line when the shop line has 5 months"** → the mechanism the
  owner proposes ("maybe we can change the shop line expiry to accept negative values") is
  **already what LIRA-157 does**: `sell (days < 0): (expiry or today) + days — never refused, no
  grace, no ceiling`. Only the *seamless workflow* half is new.

### 0.2 Two notes REVERSE decisions the owner confirmed within the last six weeks

This is the single most important thing in this document, because building either one without
saying so out loud would silently contradict shipped, tested, deliberate behaviour.

| Note | Reverses | Decision as it stands today |
| --- | --- | --- |
| #7 — "we can pay omt more than what we owe, our account becomes positive" | **D18**, `OMT_OPEN_CREDIT_ACCOUNT_PLAN.md` | *"Settlement clears WHOLE rows only — confirmed, keep it (owner, 2026-09-15). You tick which rows you are clearing and the payment must equal them exactly."* |
| #4 / #15 — "fee… is already paid, it shouldn't affect our drawers or account with the supplier" | **D1**, `COMMISSION_AT_SETTLEMENT_PLAN.md` | RECEIVE books the supplier payable as `−(x − f)` — the fee **does** reduce what we owe. Verified live at `FinancialServiceRepository.ts:823`. |

Neither is a bug report. Both are the owner changing their mind after using the thing, which is
legitimate — but each needs an explicit "yes, replace the old decision" before code moves.

### 0.3 ✅ `COMMISSION_AT_SETTLEMENT_PLAN.md`'s header was wrong about Phase 2 (and Phase 3) — CORRECTED 2026-09-22

The plan's header reads **"Phases 2-4 NOT started."** The code disagrees, in detail:

```
FinancialServiceRepository.ts:1551   commissionModel = (serviceType === "BILL" ||
                                       isOmtWhishTransfer(provider, serviceType)) ? 1 : 0
FinancialServiceRepository.ts:821-827  SUPPLIER_OWED_EXPR has GROSS branches for
                                       OMT/WHISH SEND *and* RECEIVE at commission_model = 1
```

OMT/WHISH SEND/RECEIVE are **born `commission_model = 1`** and the gross flip landed with them,
in lockstep, exactly as the plan's own warning demanded. `PLAN_OVERVIEW.md` already records
this correctly ("Phases 2-3 shipped"); the plan file itself did not. **Fixed 2026-09-22** — the
header now reads "Phases 0-3 SHIPPED," correcting Phase 3 too, which this note itself had not
credited as shipped (it is, via LIRA-158/159/160-163).

**Re-corrected 2026-09-23 — Phase 3 is not *fully* shipped.** Four of its five bullets are; the
fourth (*"Resolve the LIRA-108 residuals here: provider set of the Commission row …"*) is
**not**, and `ProfitRepository.getRealizedCommissionTotals`'s own doc comment says so in as many
words (`ProfitRepository.ts:2605-2608`): *"The `provider IN (COMMISSION_PROVIDERS)` filter is
still deliberately NOT adopted from the sibling — narrowing by provider remains a separate
owner-facing semantics question, not part of … the LIRA-108 gate closure."* The plan header now
reads **"Phase 3 SHIPPED except the LIRA-108 residual bullet"** and that bullet is carried into
the remaining work.

The same code comment names a live follow-up nobody has filed:

> *"`FinancialServiceRepository.omtCommissionModelGate.test.ts` … that file's expectations
> describe the PRE-Phase-2 shape and are stale after this change — a Phase 2 follow-up must
> re-derive them to the new invariant, rule 17."*

**Corrected 2026-09-22:** the test is NOT stale — it was re-derived in the same commit
(`…omtCommissionModelGate.test.ts:19-43`, assertions at `:395/:405/:440`). The stale artifact is
the *comment*. **LIRA-216** keeps its ID and is rescoped to: delete the comment, and confirm the
(admittedly never-executed) re-derivation actually passes.

### 0.4 ✅ `LIRA-176` was TWO different tickets — collision RESOLVED 2026-09-22

Found while checking statuses for this triage:

```
current_sprint.md, heading             ## LIRA-219: LBP-denominated profit is dropped
                                               from BOTH closing totals — MEDIUM — TODO
done_plans/LIRA-176_MAINTENANCE_PARTS_PLAN.md  # LIRA-176 — Maintenance Parts, Parts Profit,
                                               and Job Detail Panel — DONE (396b0dfa)
```

Two unrelated tickets, one number, one DONE and one TODO. This is the same failure
`OWNER_NOTES_TASK_PLAN.md` documented for LIRA-070/094 and recommended renumbering for. **Both
of these notes' triage touches it** — note #3 means the closing one, note #25 means the
maintenance one — so this document **resolved 2026-09-22**: the maintenance ticket keeps
**LIRA-176** (DONE); the closing-LBP one was renumbered to **LIRA-219** (TODO).

### 0.5 Note #2 has a one-line mechanism, and it is not where you'd look

"staff user should not see settings and profits page [partially true]" reads like a vague
permissions complaint. It is three precise, separate facts:

- **Profits is visible to staff on purpose.** LIRA-177 migration **v163** flipped
  `modules.admin_only = 0` for `profits` and put a per-page password in front of it — *your own
  spec*, answered three ways (everyone types it, server-enforced, re-prompt every visit). That
  is the "partially true".
- **Settings is admin-only and correct** — `/settings` is `AdminRoute` (`App.tsx:330`), and
  LIRA-178 closed the REST hole (`b1dae8db`).
- **The audit page is hidden from staff by a single column**, and that is the actual ask:

```
electron-app/create_db.sql — the tenant-1 `modules` seed, `key = 'audit'` row
  BEFORE (as of 2026-09-21):
  (1, 'audit', 'Audit & Transactions', 'Shield', '/audit', 97, 1, 1, 1)
                                                            ▲  ▲
                                                 is_enabled ┘  └ admin_only = 1
  NOW (working tree 2026-09-23, line 1584):
  (1, 'audit',      'Audit & Transactions', 'Shield', '/audit',   97,  1, 0, 1),
                                                                        ▲
                                                           admin_only = 0 ┘
frontend/src/shared/components/layouts/Sidebar.tsx:118
  .filter((m) => !m.admin_only || isAdmin)
```

**✅ SHIPPED 2026-09-23 as LIRA-198** — exactly the shape proposed here, and it took all three
pieces, not just the migration:

- **Migration v178** `audit_module_visible_to_all_roles` (`packages/core/src/db/migrations/index.ts`;
  its `name:` literal is at `:11962`) flips `modules.admin_only → 0` for `key = 'audit'`, mirroring
  v163's `profits` shape. Rule 10 satisfied: `electron-app/create_db.sql`'s tenant-1 seed carries the
  post-migration value directly (`:1584`) **and** a `(178, 'audit_module_visible_to_all_roles')`
  `schema_migrations` seed row (`:2253`).
- **The role sweep this note demanded** — the nav flag really was a curtain. `audit:get-recent` and
  `audit:search` were `requireRole(["admin"])` on **both** transports; they are now
  `["admin", "staff"]` in `electron-app/handlers/auditHandlers.ts` and `backend/src/api/audit.ts`
  (`audit:get-by-entity` / `GET /by-entity` already allowed staff). Two new role-gate tests guard it:
  `backend/src/api/__tests__/auditRoleGate.api.test.ts` and
  `electron-app/handlers/__tests__/auditHandlers.roleGate.test.ts`.
- **The per-tenant seed**, which this note's first pass missed entirely: `TenantRepository.seedModules`
  provisions a NEW web tenant's `modules` rows independently of both files above, and it still seeded
  `audit` with `admin_only = 1` (and `profits` with `1`, wrong since v163 — a pre-existing gap). Both
  are now `adminOnly: 0` in the newly extracted `MODULE_SEED_ROWS` constant, pinned by a value-level
  parity test in `backend/src/__tests__/wp5_wp6_admin_tenant.api.test.ts`.

**Scope, per the owner's decision of 2026-09-23: BROAD, as built.** Staff keep BOTH tabs — the
Transactions tab and the Audit Log tab. `audit:search` / `POST /api/audit/search` are **not** to be
reverted to admin-only. Row actions (Void / Refund / Void-entire-checkout) stay **visible** to staff;
they remain `requireRole(["admin"])` server-side, and the failure message was made identical and
explanatory on both transports instead (LIRA-205's `describeActionFailure`).

**Every operation staff can now reach on this surface is a read**, by enumeration: `auditHandlers.ts`
registers exactly three `ipcMain.handle` channels and `backend/src/api/audit.ts` exposes exactly three
routes, all landing on `AuditService.getRecent` / `search` / `getByEntity`. There is no write channel
on either file, and `AuditRepository`'s three queries all carry `tenant_id = ?`.

⚠ **One gap this widening opens, filed as LIRA-220:** `electron-app/handlers/dbHandlers.ts`'s
`db:update-setting` / `settings:update` write an audit row with `new_values: { value }` **without
redacting `SENSITIVE_SETTING_KEYS`** — and they write it even when `SettingsService.updateSetting`
*rejected* the write (`SettingsService.updateSetting` returns `{ success: false }` rather than
throwing — `SettingsService.ts:152-162`). The REST twin already guards this
(`backend/src/api/settings.ts:99-104` returns early, before `auditRest`, with a comment saying
exactly that), so it is a desktop-only leak **and** a rule-19c divergence. `AuditRepository.search` is `SELECT *`, so any such
row is now staff-readable.

⚠ **Related, and worth a decision of its own:** `/audit` has **no in-app link outside the
sidebar**. Grepping the whole frontend for `"/audit"` returns the route definition and e2e specs
— nothing else. The `audit` module row is what supplies the sidebar entry, so flipping the flag
is what gives staff any way in at all.

### 0.6 Note #11 (loto) is two shipped tickets colliding, not one new bug

The duplicated summary is **LIRA-064** (structured in/out legs) meeting session baskets. Basket
payment legs are written with `transaction_id = NULL, session_id = <basket>` — deliberately, per
**LIRA-115** — so the legs join is **pooled across the basket** and renders *the same in/out
summary on every row in it*. Two rows, one payment, printed twice. The `−400,000 LBP` and
`1,280,000 LBP` rows are both correct; their *summaries* are the shared pool.

The refund half ("basket item - see admin to reverse") is LIRA-115's own guard, and LIRA-115 is
**DONE** — `TransactionRepository._reverseSessionPooledPayments` reverses the pooled basket legs
(`transaction_id IS NULL, session_id = ?`) exactly once for the whole basket, and both
`voidSessionBasket` and `refundSessionBasket` call it once at the end of their own transaction. So
refunding *is* possible; the UI is still showing the old dead-end message.

> **Citation corrected 2026-09-23.** An earlier pass of this document cited
> `TransactionRepository.ts:1300` as the line that "reverses basket legs by `session_id` exactly
> once". That line reverses nothing. It sits inside `refundSessionBasket`, and the machinery near it
> — `_assertSessionBasketReversible` (`:1341` in the current working tree) — **throws** when the
> basket has already been reversed. It is the idempotency guard, not the writer. The writer is
> `_reverseSessionPooledPayments` (`:1386`). Cite the symbol, not the line: this file moved +59 lines
> in the current batch alone.

The genuinely new ask — *"for customer session, we have to find a way to extract the in/out and
payment detail metadata to the session txn grp"* — is the right fix and is filed as **LIRA-201**.

### 0.7 Note #18 (inventory quantity) is BY DESIGN, and there is a button

`ProductForm.tsx`'s Quantity input — the `D13:` comment block, `:822` in the current working
tree — disables the field on edit:

> *D13: `InventoryService.updateProduct` silently ignores `stock_quantity` on an edit — quantity
> changes now only happen through a real intake/adjustment event (batches, supplier ledger, FIFO
> cost). Editing this field on an existing product would quietly do nothing, so it's disabled
> here rather than left as a silent no-op.*

That is `SUPPLIER_STOCK_INTAKE_PLAN.md` decision D13, shipped deliberately. The form even prints
*"Use 'Adjust Stock' from the product list to change quantity."* — and that button **exists and
works on both transports** (the row action in `ProductList.tsx`, `title="Adjust stock"` at `:1279` in
the current working tree, → `AdjustStockModal`; `adjustStock` in `backendApi.ts` is dual-mode with a
REST twin at `POST /api/inventory/products/:id/stock`).

**So this is a discoverability failure, not a defect** — the counter-argument being that a disabled
field with a hint is weaker than a control the operator can find.

**✅ SHIPPED 2026-09-23 as LIRA-208**, and building it surfaced a second, real D13 instance this note
had not spotted:

- The edit form now carries its own **"Adjust Stock"** button (`ProductForm.tsx`, testid
  `product-form-adjust-stock`), rendered only when `product && onAdjustStock`. With unsaved edits it
  shows a confirm strip — *Discard & adjust* / *Keep editing*.
- The hand-off resolves the row **fresh** from `ProductList`'s own `products` state at click time
  (`handleAdjustFromForm(productId)`, `ProductList.tsx:738-779`) rather than from the `editingProduct`
  snapshot taken when the form opened. That snapshot was genuinely stale-prone and it moves money:
  `AdjustStockModal` computes `parsedQuantity - currentStock` and routes an increase through
  `receiveStock`, which books a FIFO batch **and a supplier debit** — a stale baseline books the
  wrong supplier debt.
- **The second D13 instance:** the "Old stock" checkbox rendered editable on an existing product, but
  `InventoryService.updateProduct`'s type has no `is_old_stock` field at all and `handleSubmit` only
  sends it on CREATE — so ticking it on an edit was a pure silent no-op, the exact shape D13 exists
  to prevent. It is now `disabled={!!product}` with an explanatory title.

Three follow-ups came out of it and are filed: **LIRA-224** (a *Save & adjust* option — needs your
answer), **LIRA-225** (the hand-off still searches a *filtered* client-side list, so a product filtered
out of view dead-ends; the real fix is a single-row read), and **LIRA-228** (`warrantyMonths` is
outside the minimize/restore snapshot and is silently lost).

### 0.8 One note was diagnosed wrong — and the same commit as #12 very likely already fixed it

*"maintenance, create a maintenance job, in the received tab, click on start, nothing is
happening."* The earlier diagnosis in this document — *"there is no REST route to change a job's
status"* — is **wrong**, and it was wrong in a way worth naming: it looked for a
`POST …/status` route, and there isn't one, but there was never meant to be.

`handleStatusTransition` (`Maintenance/index.tsx:453`) does not call a status endpoint. It calls
the ordinary **save**, with the new status in the payload:

```
Maintenance/index.tsx:482   clientPhone: job.client_phone || ""      ← an EMPTY STRING
Maintenance/index.tsx:486   await api.saveMaintenanceJob(payload)
backendApi.ts:2180-2191     dual-mode → POST /api/maintenance/jobs
backend/src/api/maintenance.ts:36  router.post("/jobs", requireRole(["admin"]),
                                     validateRequest(saveMaintenanceJobSchema))
```

The route exists, it is dual-mode, and its roles match the IPC handler (`maintenanceHandlers.ts:22`
— both `["admin"]`). What did not exist was tolerance for that empty string: until `ed211887`,
core's `saveMaintenanceJobSchema` used `phoneNumberSchema.optional()`, which accepts `undefined`
but **400s on `""`**. `ed211887` replaced it with `optionalPhoneNumberSchema`
(`validators/maintenance.ts:34`; `validators/common.ts:23-25`). That commit's own message names
`Maintenance/index.tsx:432` — the very line this payload is built on.

**So #25 is the same bug as #12, reached through a different button, and is very likely already
fixed.** The symptom matches exactly: `handleStatusTransition` checks `if (result.success)` and
has **no else branch** (`:487-490`), so a rejected save produces no error, no toast and no
change — literally "nothing is happening".

**LIRA-211 is probably unnecessary.** Do not build a status REST route; there is nothing for it
to do.

**Residual uncertainty — the one thing that would change this.** The phone fix only explains a job
whose `client_phone` was empty. If the customer's job **did** carry a phone number, the save would
have passed validation and something else is wrong — start at the silent `if (result.success)` with
no else (`:487-490`), which will hide whatever the real error is. Ask the customer whether that job
had a phone.

**Worth fixing regardless of #25:** that missing else is a silent-failure pattern, and it is what
turned a validation 400 into "the button is dead". Surfacing `result.error` costs one line.

### 0.9 Two notes cannot be sized until the customer gives one more fact

Both looked small at first pass. Neither is, and for opposite reasons.

**#1 (staff name in the txn user column) may already work.** The machinery is all there:

```
TransactionRepository.getRecent  u.username (:786), LEFT JOIN users u ON u.id = t.user_id (:795)
TransactionsViewer.tsx:529-530   { header: "User", sortKey: "username" }
```
*(Line numbers re-resolved 2026-09-23 against the working tree — they were `:753,762` and
`:483-486` when this was written; both files moved in this batch. The symbols did not.)*

and a repo-wide grep finds **no hardcoded `user_id: 1` left in `packages/core/src`** (T-57 closed
that). So the column exists, is joined and is sortable. If the customer saw a wrong or blank name,
the defect is in *which* `user_id` a specific write path stamps — which one? **Ask which module
the transaction came from**; without that this is a hunt, not a fix.

**#17 (+15% sell-price adjustment is blocking) — the guard is not in the codebase.** Searching
`packages/core/src`, `frontend/src` and `packages/ui/src` for `0.15`, `1.15`, `15%`,
`maxIncrease` and `PRICE_*_LIMIT` returns nothing that blocks a sale. The only price-ish alert
that exists is recharge's `marginAlertThreshold` (default 100,000 LBP, `HistoryModal.tsx:95`) —
and it **already only warns, never blocks**. So either the customer means a different screen, or
they mean a different rule. **Ask which page showed the block and what the message said.**

### 0.10 `create_db.sql` had drifted behind the migrations — a rule-10 breach a fresh install would hit

Found while scouting this batch, at the state of the tree before this batch's edits landed.
`packages/core/src/db/migrations/index.ts` ran to **v177**, but `electron-app/create_db.sql`'s
`schema_migrations` seed block stopped at **v171**. Missing versions, computed by diffing the two:
**163, 172, 173, 174, 175, 176, 177**.

**Corrected 2026-09-23 — the earlier wording of this paragraph was wrong.** It said `161`, `162`,
`165` and `166` were *"absent by design"*. They were never absent. All four are **present as seeded
`schema_migrations` rows**, each carrying a marker comment explaining why the fresh schema needs no
separate DDL for it (data-only backfill, or the post-migration value is already declared on the table
above). Re-verified by executing both the `HEAD` and working-tree copies of `create_db.sql` in
Python's stdlib `sqlite3` and reading `schema_migrations` back: at HEAD the block held 150-166 and
169-171 with **exactly one** hole below 172 — **163**, and it was the only one of its neighbours with
no marker comment either. What was missing was *seed rows*, not schema. In the current working tree
150-178 are contiguous (161 at `:2195`, 162 at `:2200`, 163 at `:2205`, 165 at `:2209`, 166 at
`:2213`, 172 at `:2226`, 178 at `:2253`) with 167/168 correctly absent — those two numbers were never
used (the LIRA-176 renumber to v170/v171, noted in the file).

**One correction to how this was first read.** The initial pass concluded "v176's schema
(`supplier_account`/`account_id`) is absent from `create_db.sql` entirely" from a grep for those
two literal names, which return zero matches. That grep was for the wrong names: v176's real
column is `suppliers.account_supplier_id` (migration `add_supplier_account_link`,
`migrations/index.ts:11394-11449`), and re-checking for that name shows the column, its index, and
the per-tenant seed `UPDATE` were **already present** in `create_db.sql` — just not marked as
applied in the `schema_migrations` seed list. So the real gap was seven missing seed *rows*, not
missing schema; a fresh install would still get the right columns, just re-run migrations
163/172-177 harmlessly on first boot (their `up()` functions are idempotent, per the same
`columnExists`/`tableExists` guards v166 established) rather than skip them as already applied —
the safe direction, but still not what rule 10 asks for.

**✅ CLOSED 2026-09-23 — and it grew a guard, which is the part that matters.** The repair this note
saw mid-flight landed:

- All seven missing seed rows (163, 172-177) plus 178 are now in `create_db.sql`, each with a marker
  comment in the file's existing style. `schema_migrations` seeds and `MIGRATIONS` now agree on all
  **168** versions, in both directions.
- **Six seed-row NAMES had also drifted** — a separate, latent hazard nobody had noticed, because the
  migration runner keys on `version` and never reads `name`. `schema_migrations` has `UNIQUE(name)`,
  so a drifted name is a collision waiting for the right insert. v66-v69 and v78-v79 are now
  byte-identical to `migrations/index.ts`.
- `scripts/check-schema-equivalence.mjs` existed but was **wired nowhere** — not in `package.json`,
  not in any workflow. It is now `yarn check:schema-equivalence` and runs in `ci.yml`'s `typecheck`
  job beside the tenant-scoping and bind-arity checks, and it was **extended** to diff the
  `schema_migrations` seed CONTENTS (both directions) against the real executed `MIGRATIONS` array —
  the exact class of drift that shipped here. It also refuses to run against a stale
  `packages/core/dist`. Each of those was proven by reintroducing the bug and watching the script
  exit 1, not by reasoning about it.

Two residual gaps are filed as **LIRA-226**: the A-vs-B *shape* half of that check is vacuous on a
`push` to `main` (DB A is built from `HEAD`, which on a push **is** the pushed commit, so A and B are
identical by construction — the seed-CONTENTS half is unaffected and does have signal), and a
duplicated `version:` in `MIGRATIONS` is silently collapsed by a `Map` rather than reported.

Method note, because it bit once while checking this: a line comment inside the seed block
(`-- v162 repoints the 'omt_whish' module's route from '/services' to '/omt-whish';`) contains a
semicolon, so a naive "read to the first `;`" parse truncates the block at v161 and reports far more
missing versions than there are. Strip SQL comments before parsing.

---

## 1. The 29 notes — what is done, and what is not

Three tables, one per day. **✅ Done** is what is already in `main` and verified in source; **⬜
Not done** is what is left. Most notes are partly both — that is the point of splitting them.
Each ticket carries its status glyph, so nothing has to be matched up by position.

Proposed new IDs run **LIRA-197 → LIRA-218** (LIRA-196 was the maximum when this was written); they
were *proposed, not filed* — file each into `current_sprint.md` when you start it. **LIRA-219** was
additionally taken 2026-09-22 by the LIRA-176 renumber (§0.4).

**Updated 2026-09-23:** **LIRA-198**, **LIRA-205** and **LIRA-208** are now filed in
`current_sprint.md` as **DONE**, and **LIRA-220 … LIRA-228** were filed for work discovered while
building them. The next free ID is **LIRA-229**.

### Table 1 — Tuesday (14 notes)

| # | Note | ✅ Done already | ⬜ Not done |
| --- | --- | --- | --- |
| 1 | staff user does a trxn; the txn table must show the staff user name | User column + `LEFT JOIN users` (`TransactionRepository.getRecent`, `:786`/`:795`), sortable; no hardcoded `user_id` left in core | **Verification only** — may already work. Needs the module name from the customer (§0.9). **LIRA-197** ⬜ only if it reproduces |
| 2 | staff must not see settings/profits; staff SHOULD see txn + audit | **LIRA-177** ✅ profits is staff-visible behind a password *by your own spec* · **LIRA-178** ✅ settings REST gate closed · **LIRA-198** ✅ **SHIPPED 2026-09-23** — migration v178 + the role widening on both transports + the per-tenant `TenantRepository.seedModules` fix — §0.5 | Nothing on this note — **confirm with the customer.** One spin-off: **LIRA-220** ⬜ redact `SENSITIVE_SETTING_KEYS` in `dbHandlers.ts`'s audit rows, now that staff can read them |
| 3 | profits shows `−0.32$` + `90,000 LBP`; fold the USD into LBP | **LIRA-181** ✅ SMS fee became an expense — *this is what creates the `−0.32`* | **LIRA-199** ⬜ fold USD into LBP on Profits · **LIRA-183** ⬜ · **LIRA-219** ⬜ (both record the same currency-folding fork) |
| 4 | OMT RECEIVE fee is already paid; must not touch drawers or the supplier account | **LIRA-095** Ph 0/1/2 ✅ — the gross-payable flip shipped (`:1551`, `:821-827`) | ⚠ **Your decision first**: this REVERSES D1. Then RECEIVE must book `−x`, not `−(x − f)` (`:823`) — §0.2 |
| 5 | cashout unicef — check voice | — | **LIRA-200** ⬜ **blocked** — zero matches for "unicef" repo-wide; needs the voice note before it can be specified |
| 6 | OMT RECEIVE $40 cash-to-business, no fee, but "OMT fee" is required | — | **LIRA-202** ⬜ one refinement at `validators/financial.ts:303-328` — `CASH_TO_BUSINESS` sits in the manual-fee branch. Shared validator, so both transports fix at once |
| 7 | pay OMT more than owed → positive balance; auto-apply to later txns | — | ⚠ **Your decision first**: this REVERSES D18. Then **LIRA-203** ⬜ — §0.2 |
| 8 | debt settle leaves `−340 LBP`; txn shows `0$ + 2,519,660 LBP` | — | **LIRA-204** ⬜ **money bug, highest severity here.** Reproduce first; same class as the `repaymentReduction.ts` cross-currency fix (2026-07-20) |
| 9 | txn table should show returned credits on an MTC/Alfa card sale | **LIRA-180** ✅ the returned-credits number already exists and is overridable · **LIRA-205** ✅ **SHIPPED 2026-09-23** — a **Ret. Credits** column (the 11th) on the transactions table, fed by `returned_credits_usd` on the repository row | Nothing — **confirm with the customer** |
| 10 | buy back $9 → drawer shows `+18$` credits (double) | — | **LIRA-206** ⬜ **money bug.** Buy-back shipped as Phase 6 of `CARRIER_LINES_VALIDITY_PLAN.md`; this is a new defect in it |
| 11 | loto in a session: summary printed twice, returned money missing, can't refund | **LIRA-064** ✅ structured legs · **LIRA-115** ✅ basket refund works (`TransactionRepository._reverseSessionPooledPayments`, `:1386`) | **LIRA-201** ⬜ per-row in/out metadata for the session group; the UI still prints the old "see admin to reverse" dead end — §0.6 |
| 12 | maintenance: phone number shouldn't be required | ✅ **FIXED** 2026-09-21 (`ed211887`), web-only bug, never ticketed | Nothing — **confirm with the customer** |
| 13 | shop buys phone numbers (lines) and sells them later | — | **LIRA-207** ⬜ a new flow, not a fix |
| 14 | profits: per-module detail — what sold, how profit propagated | — | **LIRA-209** ⬜ (shared with #29) · **LIRA-185** ⬜ the audit that would tell you what is wrong per module |

### Table 2 — Wednesday (4 notes)

| # | Note | ✅ Done already | ⬜ Not done |
| --- | --- | --- | --- |
| 15 | OMT RECEIVE fee only determines the commission | **LIRA-095** Ph 0/1/2 ✅ | Same as #4 — the D1 reversal, then `−x` |
| 16 | implement Syria transaction OUT (we have IN only) | — | `SYRIA_REMITTANCE_PLAN.md` ⬜ everything; blocked on owner decisions D1–D6 |
| 17 | sell-price adjustment +15% should tag an alert, not block | Recharge's `marginAlertThreshold` ✅ already warns without blocking (`HistoryModal.tsx:95`) | ⚠ **Cannot size it** — no 15% blocking guard exists anywhere in source. Needs the page and the message from the customer (§0.9). **LIRA-210** ⬜ · **LIRA-068** ⬜ is the alert to reconcile with |
| 18 | inventory: can't edit quantity after adding/editing a product | **LIRA-077** ✅ "Adjust stock" exists, works on both transports (`ProductList.tsx:1279`); the field is disabled **deliberately** (D13) · **LIRA-208** ✅ **SHIPPED 2026-09-23** — an Adjust Stock button on the edit form itself, hand-off resolved fresh, **plus** a second silent D13 no-op found and closed (the "Old stock" checkbox on edit) — §0.7 | **LIRA-224** 🟠 *Save & adjust* needs your answer · **LIRA-225** ⬜ filtered-list dead-end + a hand-off regression test · **LIRA-228** ⬜ `warrantyMonths` lost on minimize/restore |

### Table 3 — Thursday (11 notes)

| # | Note | ✅ Done already | ⬜ Not done |
| --- | --- | --- | --- |
| 19 | account debit doesn't affect the open customer session | — | **LIRA-212** ⬜ |
| 20 | exchange: "customer gets" auto-fills "you receive"; payment form in a right drawer | — | **LIRA-213** ⬜ |
| 21 | MTC/Alfa shop-line checkbox: buy back credits (OUT) vs charge the customer (IN), no SMS fee | — | **LIRA-088** 🟠 ⭐ **this note IS the answer** to the question that has blocked it; confirm the reading and it can be built |
| 22 | selling credits doesn't deduct the shop line (settings + MTC page), Alfa too | **LIRA-145** ✅ `Line_Usage` is the precedent to copy | **LIRA-088** 🟠 the signed decrement — `Math.abs(data.amount)` still forced (`RechargeRepository.ts:487`) |
| 23 | top-up txns should be refundable from the txn table | **LIRA-194** ✅ shipped 2026-09-21 (`9c0194cd`), *after* these notes | Nothing — **confirm with the customer** |
| 24 | use the payment form everywhere there is a payment (hold-money returns) | **LIRA-060** ✅ Hold Money itself | **LIRA-214** ⬜ put the payment form on it so returns can be recorded |
| 25 | maintenance: "Start" in the Received tab does nothing | **LIRA-176** 🟡 desktop button + `maintenance_status_history` shipped (`396b0dfa`) | **Verify with the customer** — very likely already fixed by `ed211887` (same bug as #12, via the save route). **LIRA-211** 🟡 probably unnecessary; keep only the one-line "surface the save error" fix — §0.8 |
| 26 | expenses don't affect the profits page | `ProfitRepository` already carries `expenses_usd` / `expenses_lbp` | **LIRA-215** ⬜ **money.** A wiring or display defect, not a missing feature · **LIRA-185** ⬜ |
| 27 | profits shows total revenue `68,022,024$`; debts must not feed profits | **LIRA-098** ✅ · **LIRA-160** ✅ — the recognition gates this should be using already exist | **LIRA-217** ⬜ **money.** Point the revenue query at those gates |
| 28 | sell 1 year off a shop line holding 5 months, recharge, sell the rest — seamlessly | **LIRA-157** ✅ negative expiry is already allowed (`sell: never refused, no grace, no ceiling`) | **LIRA-218** ⬜ the operator workflow only |
| 29 | profits page should show total profit (net profit − expenses) | — | **LIRA-209** ⬜ same surface as #14, one ticket covers both |


> **Housekeeping:** **LIRA-216** is not an owner note — it is the stale-guard follow-up from
> §0.3, filed here so it is not lost. Final new range: **LIRA-197 … LIRA-218**, 22 IDs.

---

## 2. Suggested order

Ranked by *cost of being wrong*, not by size.

### 2a. Money first — four notes where the books are wrong

1. **#8, LIRA-204** — debt settlement leaves `−340 LBP` and books `0$ + 2,519,660 LBP` against a
   `25$ + 300,000 LBP` payment. A customer's balance is wrong on screen today.
2. **#10, LIRA-206** — buy-back credits the drawer **twice**. Silent, and it inflates the drawer.
3. **#27, LIRA-217** — a `68,022,024$` revenue figure means the profits page is reading a source
   it must not. The gates it should use (**LIRA-098**, **LIRA-160**) already exist and are DONE.
4. **#26, LIRA-215** — expenses missing from profits understates cost, which overstates profit.

All four are rule-17 candidates: reproduce, write the failing test, then fix.

### 2b. Your decisions — minutes of your time, unblocks three tickets

- **#7 / D18** — confirm you want to replace whole-row settlement with an overpayable account.
- **#4, #15 / D1** — confirm RECEIVE should book `−x`, not `−(x − f)`.
- **#21 / LIRA-088** — your Thursday note answers the open question; confirm the reading and it
  can be built immediately.

### 2c. Cheap and shipped-adjacent

- ~~**#2, LIRA-198**~~ ✅ **shipped 2026-09-23** — migration v178, the role sweep on both transports,
  and the per-tenant seed fix the first pass had missed (§0.5).
- **#25** — **nothing to build until the customer confirms**; `ed211887` very likely fixed it
  already (§0.8). LIRA-211 shrinks to a one-line error-surfacing fix.
- **#12** and **#23** — nothing to do, already fixed; **confirm with the customer**.
- ~~**#18, LIRA-208**~~ ✅ **shipped 2026-09-23** — and it was not only a nudge: a second silent D13
  no-op (the "Old stock" checkbox on edit) came out with it (§0.7).
- ~~**#9, LIRA-205**~~ ✅ **shipped 2026-09-23** — the Ret. Credits column, plus one cross-transport
  failure message for the admin-only row actions (owner decision 2).

### 2d. Doc corrections that prevent re-work — do these in the same commit

- ~~Renumber one of the two LIRA-176 tickets~~ ✅ done 2026-09-22 — closing ticket is now **LIRA-219** (§0.4).
- `COMMISSION_AT_SETTLEMENT_PLAN.md` header: Phase 2 **shipped** (§0.3). *Re-corrected 2026-09-23:*
  Phase 3 is **SHIPPED except its LIRA-108-residual bullet** — `ProfitRepository.ts:2605-2608` still
  says in so many words that the `provider IN (COMMISSION_PROVIDERS)` narrowing is *"deliberately NOT
  adopted … a separate owner-facing semantics question"*. That bullet is carried into Phase 4.
- ~~`SPRINT_INVENTORY_2026-08-12.md`: strike the **LIRA-110** row~~ ✅ done 2026-09-23 — the row was
  actually removed (it had only been annotated), so the table now matches its own "Total: 18", and
  **LIRA-138**'s evidence was refreshed. *(LIRA-160 itself is not named in that file — an earlier
  draft of this bullet was wrong about which file/ticket; the stale "LIRA-160 (TODO)" marker was at
  `current_sprint.md`'s `## LIRA-110:` status row and is now corrected.)*
- File **LIRA-216** — rescoped: the *comment* at `FinancialServiceRepository.ts:1541-1544` is
  stale, not the test (§0.3).

---

## 3. Method, and what is NOT verified

**What was done:** every ticket ID in §4a was resolved by locating the named artifact in source —
the constant, the column, the migration, the repository method, the REST route, the component
line. Six status lines were found to disagree with the code and are marked ⚠ there.

**Assumption (unverified):** the 22 "to be created" items were checked by searching ticket
*titles and bodies* across `docs/plans/**`, `docs/tickets/**` and the root `current_sprint.md`
(~190 ticket IDs). I did **not** read all ~190 bodies end to end, so a loosely-worded ticket
could have escaped the sweep. Grep for the module name before filing each new ID.

**Assumption (unverified):** the notes are attributed to the web app, as the owner stated. Only
#12 and #25 were independently confirmed as web-specific (both are transport gaps found in
source). For the rest — in particular the four money bugs in §2a — **reproduce on the transport
the customer used before assuming the other one is clean.** Rule 27 applies to #27 and #3 in
particular: the server's day and the browser's day differ, and both notes involve reported totals.

**Not verified:** none of the four money bugs in §2a was reproduced. Their *mechanisms* are
hypotheses from reading the notes; only the *ticket mapping* is established fact. Per rule 28,
reading produces hypotheses — run something before believing any diagnosis above that is not
backed by a file:line citation.

---

## 4. Summary table — every ticket, its status, and the evidence

### 4a. Existing tickets

Verified 2026-09-21 against **source**, not status lines. ⚠ marks a row where a plan header or
sprint file disagrees with the code.

| Ticket | What it is | Status | Evidence checked |
| --- | --- | --- | --- |
| **LIRA-060** | Services — Hold Money | ✅ DONE (validated 2026-07-19) | hold-money constants in `constants/transactionTypes.ts` |
| **LIRA-064** | Transactions table — structured in/out payment legs | ✅ DONE | `TransactionPaymentLeg`, `TransactionRepository.ts:115`, `:432` |
| **LIRA-068** | Flag a transaction "amount changed" when edited | ⬜ TODO | zero `amount_changed`/`amountChanged` symbols repo-wide |
| **LIRA-077** | Inventory — stock replenishment / adjustment | ✅ DONE | `AdjustStockModal` + the row action in `ProductList.tsx` (`:1279`) + dual-mode `adjustStock`. LIRA-208 (2026-09-23) added a second entry point on the edit form |
| **LIRA-088** | MTC/Alfa signed provider-balance decrement | 🟠 OPEN — needs your answer | `Math.abs(data.amount)` still forced, `RechargeRepository.ts:487` |
| **LIRA-095** | Commission at settlement (OMT/Whish/Katsh) | 🟡 Ph 0-2 DONE · Ph 3 DONE except its LIRA-108 residual · Ph 4 open | `commissionModel` stamp `:1551`; gross RECEIVE `:823`. Plan header corrected 2026-09-22 and re-corrected 2026-09-23 (§0.3) |
| **LIRA-098** | Guard: profit queries must use the debt/partner-pending gate | ✅ DONE | recorded DONE in Sprint 6; `notDebtPending` live |
| **LIRA-115** | Refunding a session-basket item returns no cash | ✅ DONE | `TransactionRepository._reverseSessionPooledPayments` (`:1386`), `Refund Reversal` keyed on `session_id` |
| **LIRA-145** | Carrier-line usage expense (`Line_Usage`) | ✅ DONE | `8845ef2a` |
| **LIRA-157** | Carrier-line validity: grace + 365 ceiling + burned block | ✅ DONE, merged to main | `cc29166d`, confirmed an ancestor of HEAD |
| **LIRA-160** | Daily closing over-recognises profit on four sources | ✅ DONE ⚠ | `notDebtPending` exported, `ProfitRepository.ts:404`. **`SPRINT_INVENTORY` still says TODO — stale** |
| **LIRA-176** | Maintenance parts + status history | 🟡 DONE on desktop · web status unverified | `396b0dfa`; the "no status-write REST route" diagnosis was wrong (§0.8) — the status transition goes through the ordinary save route, which exists dual-mode; the open question is only whether `ed211887`'s phone fix already resolved note #25 |
| **LIRA-219** | LBP profit dropped from both closing totals | ⬜ TODO | `current_sprint.md`'s `## LIRA-219:` heading (renumbered from LIRA-176 2026-09-22 — collision resolved, §0.4) |
| **LIRA-177** | Profits visible to all roles behind a password | 🟡 shipped · verification partial | v163 + `ProfitsAccessService`; `lira-web-029` never run (rule 19d unmet) |
| **LIRA-178** | `PUT /api/settings/:key` had no `requireRole` | ✅ DONE | `requireRole` imported + applied, `backend/src/api/settings.ts` (`b1dae8db`) |
| **LIRA-180** | Per-card "max returned credits" override | ✅ DONE (v160, corrected by v169) | plan archived and independently verified |
| **LIRA-181** | SMS transfer fee becomes an expense | ✅ DONE (2026-09-07) | `cff444ea` — **the source of note #3's `−0.32$`** |
| **LIRA-183** | Every LBP row shows 0% margin on Profits → By Module | ⬜ TODO | `formatPct(row.profit_usd, row.revenue_usd)`, `Profits.tsx:1357` |
| **LIRA-184** | "sales margin" hand-written in six places | ⬜ TODO | no `saleMargin` fragment in `packages/core/src`. *Context only — no note links to it* |
| **LIRA-185** | Profit-surface audit: 19 confirmed, 50 never verified | ⬜ TODO ⚠ compromised | `profit-audit-2026-09/`; 324 verify calls died on a billing limit |
| **LIRA-194** | Every top-up must be voidable | ✅ DONE (2026-09-21) | `9c0194cd` — shipped *after* these notes were taken |
| **LIRA-198** | Audit page visible to staff | ✅ DONE (2026-09-23) | migration **v178** (`migrations/index.ts:11962`) + `create_db.sql:1584`/`:2253` + `["admin","staff"]` on `auditHandlers.ts` and `backend/src/api/audit.ts` + `MODULE_SEED_ROWS` in `TenantRepository.ts`. Scope BROAD by owner decision — §0.5 |
| **LIRA-205** | Show returned credits in the txn table | ✅ DONE (2026-09-23) | `returned_credits_usd` on `TransactionWithUser` (`TransactionRepository.ts:475`, accumulated at `:1037`, USD-only), `ReturnedCreditsCell` in `TransactionCells.tsx`, declared on `TransactionRow` (`useTransactionRows.ts:82`) |
| **LIRA-208** | UX: make "Adjust stock" discoverable | ✅ DONE (2026-09-23) | `product-form-adjust-stock` button in `ProductForm.tsx`; fresh hand-off at `ProductList.tsx:738-779`; the "Old stock" checkbox disabled on edit — §0.7 |
| `SYRIA_REMITTANCE_PLAN.md` | Custom provider that can pay OUT | ⬜ NOT STARTED — no LIRA number | blocked on owner decisions D1–D6 |

### 4b. Proposed new tickets

| Ticket | Status | Covers |
| --- | --- | --- |
| **LIRA-197** | ⬜ to be created | Staff user name in the txn user column |
| ~~**LIRA-198**~~ | ✅ **FILED + DONE 2026-09-23** | Audit page visible to staff (`admin_only → 0`) — see §4a |
| **LIRA-199** | ⬜ to be created | Fold the USD profit slice into LBP on Profits |
| **LIRA-200** | ⬜ to be created | Cashout unicef — **needs the voice note first** |
| **LIRA-201** | ⬜ to be created | Session txn group owns its in/out + payment metadata |
| **LIRA-202** | ⬜ to be created | OMT fee must not be required for cash-to-business |
| **LIRA-203** | ⬜ to be created | Overpay a supplier → credit balance (⚠ reverses D18) |
| **LIRA-204** | ⬜ to be created | **Money** — debt settle leaves −340 LBP |
| ~~**LIRA-205**~~ | ✅ **FILED + DONE 2026-09-23** | Show returned credits in the txn table — see §4a |
| **LIRA-206** | ⬜ to be created | **Money** — buy-back double-credits the drawer |
| **LIRA-207** | ⬜ to be created | Buy and resell phone lines |
| ~~**LIRA-208**~~ | ✅ **FILED + DONE 2026-09-23** | UX: make "Adjust stock" discoverable — see §4a |
| **LIRA-209** | ⬜ to be created | Profits per-module detail **+ net profit − expenses** |
| **LIRA-210** | ⬜ to be created | +15% price adjustment alerts instead of blocking |
| **LIRA-211** | ⬜ to be created | Surface the save error on a status transition (was: a REST route that turned out to exist) |
| **LIRA-212** | ⬜ to be created | Account debit must affect the open customer session |
| **LIRA-213** | ⬜ to be created | Exchange "customer gets" + payment drawer |
| **LIRA-214** | ⬜ to be created | Payment form everywhere (incl. hold-money returns) |
| **LIRA-215** | ⬜ to be created | **Money** — expenses must reach the profits page |
| **LIRA-216** | ⬜ to be created | Stale comment pointing at a guard that was already fixed |
| **LIRA-217** | ⬜ to be created | **Money** — debts must not feed profits revenue |
| **LIRA-218** | ⬜ to be created | Seamless cross-period telecom days sale |

**Filed 2026-09-23 — discovered while building LIRA-198 / LIRA-205 / LIRA-208.** Bodies are in
`current_sprint.md`; these are not owner notes.

| Ticket | Status | Covers |
| --- | --- | --- |
| **LIRA-220** | ⬜ TODO — **security** | `dbHandlers.ts` writes settings audit rows unredacted, and writes them for rejected writes |
| **LIRA-221** | ⬜ TODO | `MODULE_SEED_ROWS` is not yet the single source — export it and guard it against `create_db.sql` |
| **LIRA-222** | ⬜ TODO — **data loss** | `updateProductFull` NULLs `image_url` on every product edit |
| **LIRA-223** | ⬜ TODO | Run the rule-17 failing-first proofs this batch's guards were written without |
| **LIRA-224** | 🟠 needs your answer | A *Save & adjust* option on the product form |
| **LIRA-225** | ⬜ TODO | Adjust-stock hand-off: single-row read + a `ProductList` regression test |
| **LIRA-226** | ⬜ TODO | `check-schema-equivalence` — the shape half is vacuous on `push`; duplicate versions unreported |
| **LIRA-227** | ⬜ TODO | `modules.sort_order` disagrees between an upgraded tenant 1 and a fresh install |
| **LIRA-228** | ⬜ TODO | `warrantyMonths` is lost on a product-form minimize/restore |

---

## 5. Notes grouped by ticket — most-linked first

**Only four tickets touch more than one note.** They are where a single decision or fix clears
two customer complaints at once — and **two of them are waiting on you, not on code.**

| Links | Ticket | Status | Notes it covers |
| --- | --- | --- | --- |
| **2** | **LIRA-095** | 🟡 Ph 2 DONE · D1 challenged | #4 (OMT RECEIVE fee), #15 (same, restated Wednesday) |
| **2** | **LIRA-088** | 🟠 OPEN — needs your answer | #21 (shop-line checkbox), #22 (shop line not deducted on sale) |
| **2** | **LIRA-185** | ⬜ TODO ⚠ compromised | #14 (per-module profit detail), #26 (expenses don't affect profits) |
| **2** | **LIRA-209** *(new)* | ⬜ to be created | #14 (per-module profit detail), #29 (total profit = net − expenses) |

Answer the first two and **four of the 29 notes resolve without anyone writing a line.**

**Everything else is one ticket, one note** — so past the top four there is no leverage to find;
work §2's severity order instead. The other 24 notes, each mapping one-to-one onto its tickets
(`#4`, `#14`, `#15`, `#21` and `#29` are already covered by the four rows above):

| Note | Ticket → status |
| --- | --- |
| #1 | LIRA-197 ⬜ |
| #2 | LIRA-198 ✅ *(2026-09-23)* · LIRA-177 🟡 · LIRA-178 ✅ |
| #3 | LIRA-199 ⬜ · LIRA-181 ✅ · LIRA-183 ⬜ · LIRA-219 ⬜ |
| #5 | LIRA-200 ⬜ |
| #6 | LIRA-202 ⬜ |
| #7 | LIRA-203 ⬜ |
| #8 | LIRA-204 ⬜ |
| #9 | LIRA-205 ✅ *(2026-09-23)* · LIRA-180 ✅ |
| #10 | LIRA-206 ⬜ |
| #11 | LIRA-201 ⬜ · LIRA-064 ✅ · LIRA-115 ✅ |
| #12 | *(no ticket)* ✅ fixed `ed211887` |
| #13 | LIRA-207 ⬜ |
| #16 | `SYRIA_REMITTANCE_PLAN.md` ⬜ |
| #17 | LIRA-210 ⬜ · LIRA-068 ⬜ |
| #18 | LIRA-208 ✅ *(2026-09-23)* · LIRA-077 ✅ |
| #19 | LIRA-212 ⬜ |
| #20 | LIRA-213 ⬜ |
| #22 | LIRA-145 ✅ *(plus LIRA-088 above)* |
| #23 | LIRA-194 ✅ |
| #24 | LIRA-214 ⬜ · LIRA-060 ✅ |
| #25 | LIRA-211 🟡 *(probably unnecessary)* · LIRA-176 ✅ |
| #26 | LIRA-215 ⬜ *(plus LIRA-185 above)* |
| #27 | LIRA-217 ⬜ · LIRA-098 ✅ · LIRA-160 ✅ |
| #28 | LIRA-218 ⬜ · LIRA-157 ✅ |

**Tickets belonging to no owner note:** **LIRA-216** ⬜ (stale guard comment, §0.3),
**LIRA-184** ⬜ (context for the profit surfaces), and the nine **LIRA-220 … LIRA-228** follow-ups
filed 2026-09-23 out of the work above (§4b).

---

## Appendix A — the customer's notes, verbatim

Preserved exactly as received, including typos. §1 paraphrases these; this is the source.

### Tuesday

```
//tuesday notes

1-create staff user, login with it, do a trxn, go back and login with admin, go to txn table,
make sure the user column showcases the staff user name corrrectly for the latest trxn
2-staff user should not see settings and prifts page [partially true] - make staff user able to
see txn and audit age
3-in profits, if i only did sell 6 mtc credits, i can see -0.32$ and 90,000LBP in the profits
page -> instead of doing -0.32$, can we convert it to lbp? and then deduce it from the
90,000lbp profits
4-omt receive change we discussed related to fee [fee computation in receive only helps us
determine the comission amount, it is already paid, it shouldnt affect our drawers or account
with the supplier]
5-cashout unicef -- check voice
6-omt receive 40$, cash to business no fee. i can see omt fee is required for this service type.
7-bl omt setle, we can pay omt more than what we owe, our account becomes positive, it becomes
omt owes us [the extra paid will be unlinked to any trxn since theres no txn yet. and later on
when we do txns, set them directly to paid, or settled]
8-bug: hasan halawi chaikh balance: -0.00$ 2,520,000LBP -> settle: 25$ 300,000lbp [i can see
total amount 28.31 , paid 28.37 -> kept change 0.06$] -- the account shows balance: -0.00$
-340LBP [what the hell is this -340] : this in the txn page, shows debt payment 0$ +
2519660lbp.. altho he paid 25$ 300,000lbp. you should fix this
9- in the trxn table, i want to see the returned credits from mtc or alfa recharge card when the
sale is mtc alfa card [from ipick, katsh or wish app]
10-buy back 9$ from customer, price 675,000LBP. in drawer i can see +18$ credits.. why not 9$?
why double what we actually bought?
11-loto: customer bought ticket worth 1,280,000, cash prize 400,000LBP -> 880,000lbp shoud be
paid from customer. he paid50$, i returned 40$ + 10,000LBP. in the trxn i can see 2 txns, one
:'-400,000LBP', summary : in 50$, out 40$ + 400,000LBP, the second '1280000LBP' summary  in
50$, out 40$ + 400,000LBP. this means : the returned money to customer on payment is not
propagated to txn details, and the summary is repeated twice.. [this is inside a customer
session]. and both cannot be refunded, i can only see in the second row : 'basket item - see
admin to reverse' -- for customer session, we have to find a way to extract the in out and
payment detail metadata to the session txn grp
12- in maintenance, fill cost price, without phone number, not necessairy to be able to sell,
remove it from validation
13-sometimes the shop buys phone numbers [lines] and sells them later.. we should accept this
flow
14-profit page: in each module showcase more details to see what was sold and how did the profit
propagate.. per module
```

### Wednesday

```
//wednesday

-omt receive notes for the fee : In transaction receive, fee is already paid
Our calculstion is just to determine the comission amount the shop will get after settling with
omt
-implement syria transaction out [we have in only]
-make sell price adjustment +15% tags the trxn with alert, can be more, not blocking [currently
it is blocking]
-In inventory after adding a product and editing it, I'm not able to edit the quantity.
```

### Thursday

```
//thursday
-customer session: open a session for a customer that has a account [debt-credit account], go to
account page, add debit, it is not affecting the customer session -- why?
-exchange: enable the customer gets field[it should auto fill theyou receive field ], and when
recording exchange use payment form that opens in a drawer from the right
-mtc alfa pages, when phone number entered is a shop line :
1-case: the shop is buying credits from another customer line
2-case: the shop is letting a customer use his shop line to do a call and charge the customer
create a checkox button, appears only when the phone number value is a shop line
when true: true by default -> this is case 1 , buy back credits [payment out]
when false, this is case 2 , charge the customer [payment in]
in both cases, no sms fees are deduced from our drawers
-set mtc drawer amount -> sell credits -> check dashboard [affected correctly], check
settings-shop lines ,the shop line that should be affected, is not affected, the amount is
showing the old amount and not deduced by the sold credits - same in mtc page. make sure this
fix is applied on alfa shop line too
-topups trxns should be able to refund from the txn table
-in services pages and tabs, use payment form anywhere there is a payment, because currectly we
cannot record a returned amounts in the hold money. we should use payment form everywhere there
is a payment
-maintenance, create a maintenance job, in the received tab, clik on start, nothing is
happening, fix it
-track how expences affects the profits page [record expence in the expences page, and check how
the profits page is affected- it is not affected]
-in profits page, i see total revenue 68,022,024$ which is a huge number. where did that number
come from? if its from the debts account page, that page should not affect our profits page in
any sense.not even in the pending tab [only the new debts should be recorded, the ones that are
linked to items and sales in our system]
-scenario: charge 1 year to customer line from mtc days, shop line has 5 months expiry, so after
selling 5 months , the shop will recharge his line, then sell the customer 7 remaining months --
this should be seemless to the user of the system.. how can we do it?maybe we can change the
shop line expiry to accep tnegative values, the shop will send 1 year altho he has 5 months
expiry, and then the shop will charge his line
-in profits page, we should showcase total profit [net profit-expences], maybe its already
there, but we should see how it works
```
