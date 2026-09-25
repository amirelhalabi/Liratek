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
> **LIRA-220 … LIRA-228** — came out of building the three. **LIRA-229** and **LIRA-230** came out of the
> 2026-09-24 Profits audit (§6.9), so the next free ID is **LIRA-231**.

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

~~Neither is a bug report. Both are the owner changing their mind after using the thing.~~
**Corrected 2026-09-23 — that framing was right for D18 and wrong for D1.** D18 is a genuine
change of policy (now answered, §2b). **D1 is a model bug**: the RECEIVE branch assumes the
*receiving* customer pays the fee at our counter, and where the sender actually paid it, the drawer
and OMT's debt are both wrong by `f` in opposite directions — cancelling on paper, which is why
nothing caught it. It also explains note #6. Full reasoning and the still-open question in §2b.

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
building them. LIRA-229 and LIRA-230 followed on 2026-09-24; the next free ID is **LIRA-231**.

### Table 1 — Tuesday (14 notes)

| # | Note | ✅ Done already | ⬜ Not done |
| --- | --- | --- | --- |
| 1 | staff user does a trxn; the txn table must show the staff user name | User column + `LEFT JOIN users` (`TransactionRepository.getRecent`, `:786`/`:795`), sortable; no hardcoded `user_id` left in core | **Verification only** — may already work. Needs the module name from the customer (§0.9). **LIRA-197** ⬜ only if it reproduces |
| 2 | staff must not see settings/profits; staff SHOULD see txn + audit | **LIRA-177** ✅ profits is staff-visible behind a password *by your own spec* · **LIRA-178** ✅ settings REST gate closed · **LIRA-198** ✅ **SHIPPED 2026-09-23** — migration v178 + the role widening on both transports + the per-tenant `TenantRepository.seedModules` fix — §0.5 | Nothing on this note — **confirm with the customer.** One spin-off: **LIRA-220** ⬜ redact `SENSITIVE_SETTING_KEYS` in `dbHandlers.ts`'s audit rows, now that staff can read them |
| 3 | profits shows `−0.32$` + `90,000 LBP`; fold the USD into LBP | **LIRA-181** ✅ SMS fee became an expense — *this is what creates the `−0.32`* · ✅ **Closed 2026-09-24 as "no change"** by the owner: credits are reduced in USD, so `−0.32$` and `+90,000 LBP` stay separate (§2b #3) | Nothing — **LIRA-199** won't be filed. **LIRA-183** ⬜ (LBP rows' 0% margin) is a separate bug and stays |
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

### 2b. Your decisions — ✅ D18 answered, 🟠 D1 half-answered (2026-09-23)

- ✅ **#7 / D18 — ANSWERED: surplus as a credit, applied manually.** Whole-row settlement stays
  exactly as it is: the guard at `SupplierRepository.ts` (the "mismatch in EITHER direction … is a
  hard reject" block in `settleAccount`) is NOT relaxed, because its own comment records the leak it
  prevents — *"a supplier owed $100 could be 'settled' with a $150 CASH leg and the drawer would drop
  the full $150 while the ledger only nets $100."* Instead the surplus is booked as its own `PAYMENT`
  ledger row with its own drawer leg, in the same atomic action, so the guard's actual principle —
  *money never moves without a matching ledger fact* — still holds. The ledger already models a
  supplier-owes-us balance (`SUPPLIER_PAYS_US`). **Auto-apply is explicitly OUT**: silently marking
  future rows settled against a credit is the "debt marked paid while zero money moves" pattern
  LIRA-193 fixed. The credit sits visibly on the account and is netted by the operator at the next
  settlement. → **LIRA-203 is now unblocked.**
- 🟠 **#4, #15 / D1 — HALF-ANSWERED: "sometimes."** Reframed after reading the code: this is a
  **model bug, not a preference reversal.** The RECEIVE branch (`FinancialServiceRepository.ts`, the
  `// ─── RECEIVE: provider sends money to customer` block) models the fee as paid by the RECEIVING
  customer at our counter — fee-on-top posts a `+f` fee leg into the drawer, and `SUPPLIER_OWED_EXPR`
  books OMT's debt as `x − f`. Where the sender actually paid the fee, both are wrong by `f`: the
  drawer is overstated by `f` (a physical shortfall at closing) and OMT's debt understated by `f` (an
  under-claim at settlement). The two errors cancel on paper, which is why no balance check caught
  it. **Note #6 is the same bug**: the form requires the OMT fee for cash-to-business, forcing the
  operator to enter the number that creates the phantom inflow. The owner answered that a receiving
  customer *sometimes* pays a fee (Whish / some services) — **which services is still needed** before
  this can be built, since those keep the fee leg and the rest become informational-only. Any fix
  needs a **per-row cutover** (`SUPPLIER_OWED_EXPR` must read each row with the formula that wrote
  it), or every unsettled OMT balance shifts by the sum of historic fees overnight.
- **D1 — ANSWERED 2026-09-23 (owner, verbatim intent):** OMT system RECEIVE — no fee is taken from
  the customer; the fee is **always shown** (so the shop sees how it was calculated and what the
  commission is) but **never affects the drawer**. OMT App RECEIVE — no fee, for now. Whish App
  RECEIVE — fee optional. Every other case — optional, and when the shop asks the customer for it,
  it affects the drawer (collected on top, or deducted from the received amount).

  **Case matrix, mapped against source 2026-09-23** (`FinancialServiceRepository.ts` dispatches
  RECEIVE into three families — system `useSystemDrawerFlow = isOMT || isWHISH`, wallet
  `isBINANCE || isAppWallet`, and generic — with partner and session variants cutting across):

  | # | RECEIVE path | Today | Owner rule | Verdict |
  | --- | --- | --- | --- | --- |
  | 1 | OMT system, walk-in | Services page offers fee-on-top (`+f` drawer leg) or fee-included (payout `x − f`); ledger books OMT's debt `x − f`; validator REQUIRES a manual fee for cash-to-business & co | fee shown, no drawer effect, payout `x`, OMT owes `x`, commission still from the fee | ❌ change — also closes note #6 |
  | 2 | OMT system, THROUGH-partner | LIRA-124 made the fee-on-top leg post unconditionally | no fee taken | ❌ change |
  | 3 | OMT system, FOR-partner | early-return branch; not yet traced for fee handling | no fee taken | ⚠ trace before building |
  | 4 | OMT system, session basket | fee leg skipped under `deferPayment`, but the fee rides into the cart payload (Phase F) | no fee taken | ⚠ check the checkout modal |
  | 5 | OMT App | wallet branch honours a manual fee (on top via fee legs, else deducted), booked as shop profit | no fee, for now | ❌ change — force 0 / hide the input |
  | 6 | Whish App | optional; on top or deducted; shop profit | optional, affects drawer | ✅ already matches |
  | 7 | Binance | same as Whish App | optional (other case) | ✅ already matches |
  | 8 | Whish system | same shape as OMT system today, fee netted against Whish's debt (`x − f`) | optional, affects drawer | 🟠 **whose fee is it** — see below |
  | 9 | Custom / other providers | generic branch; RECEIVE *credits* the drawer (wrong direction) | optional | ❌ separate bug — owned by `SYRIA_REMITTANCE_PLAN.md` |

  **✅ Both follow-ups ANSWERED 2026-09-23:**
  - **Whish system RECEIVE fee = SHOP PROFIT.** Whish owes the full `x`; a fee the shop charges the
    receiver moves the drawer (on top, or deducted from the payout) and is booked as the shop's
    profit — same as Whish App. So row 8 becomes ❌ **change** (today it nets `f` against Whish).
  - **Past OMT transactions: no restatement, no reconciliation.** Cutover only — new rows book the
    new formula; existing rows keep `−(x − f)` exactly as written (the LIRA-095 D3 precedent).
  **D1 is fully decided. Rows 1, 2, 5, 8 are to build; rows 3, 4 are to trace first; row 9 stays
  with `SYRIA_REMITTANCE_PLAN.md`.**
- **#21 / LIRA-088** — your Thursday note answers the open question; confirm the reading and it
  can be built immediately.
- **Owner answers, 2026-09-23 (round 3):**
  - **#11 — the note's "extract in/out/payment metadata to the session txn group" is a UI ask.** Today
    every transaction in a session carries the same random colour AND repeats the same pooled
    in/out/payment detail. The owner wants that detail shown ONCE, on the session group, with each
    member row showing only its own amount. **Checkout cash is NETTED** (orchestrator recommendation,
    not objected to): a cash prize and cash-paid items net against each other, change is computed on
    the net, and only the cash that physically moved is recorded. Item rows stay separate. Non-cash
    payouts (to the customer's account or a wallet) stay gross. The existing 390,000 LBP drawer gap on
    tenant 5 is **left alone** — the account will be reset and retested.
  - **#3 — convert the SMS fee at the LBP BUY rate from Settings → Exchange Rate** (tenant 1 today:
    buy 89,000; market 89,500; sell 90,000). Read it tenant-scoped at report time, never hardcode it,
    and print it next to the figure. Worked example: 90,000 − 0.32 × 89,000 = **61,520 LBP**. Do NOT
    use `getUsdLbpSellRate` (no tenant filter — separate bug). The 85,000 credit cost rate was
    considered and rejected by the owner: it is what 1$ of credit COSTS, not the dollar's value.
    **REVERSED 2026-09-24 — #3 is closed as "no change".** Once told the combined line would fold
    the WHOLE period's net USD (every module), the owner dropped it: the note is an MTC/Alfa-only
    case, and credits are bought and reduced in **USD**, not LBP, so folding the SMS fee into LBP
    misstates it. The page keeps showing **−0.32$** and **+90,000 LBP** as separate figures. No
    combined LBP line anywhere (Overview headline card, By Module footer). The per-currency headline
    card of #29 stays. The build that already landed is removed after the current Profits run
    (the orchestrator does it; lanes must not act on this line).
  - **#20 — Part A ONLY.** The purpose is to answer "the customer wants 50 EUR — how much USD does he
    pay?", so "Customer gets" must be typeable for EVERY currency, EUR included (all three boxes are
    `readOnly` today, Exchange/index.tsx ~:1476/:1515/:1545). **Part B (payment drawer for the
    customer's side) is dropped.**

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
| **LIRA-199** | ⛔ won't file (owner, 2026-09-24) | ~~Fold the USD profit slice into LBP on Profits~~ — credits are reduced in USD; keep the figures separate |
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
| #3 | ✅ closed "no change" 2026-09-24 (LIRA-199 won't be filed) · LIRA-181 ✅ · LIRA-183 ⬜ (separate margin bug) |
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

## 6. Profits page — audit action list (PA-0 … PA-4)

**Source:** three read-only audits of the Profits page, 2026-09-23 (Overview; By Module / By Date /
By Payment Method; By Cashier / By Client / Pending / Commissions). The orchestrator re-verified the
severity-1 claims marked ✅ in code. **Owner decisions taken:** fix everything in batches 0–4; the
combined net-profit line is **report-time only** (option C — no stored record changes; profit,
expenses and pending stay separate) — *superseded 2026-09-24: the combined line is dropped entirely
(PA-4.21)*; the Recharges card gets its LBP figures.

**Severity:** (1) misleading about money · (2) missing information · (3) cosmetic.
**PR** = `packages/core/src/repositories/ProfitRepository.ts` · **PS** =
`packages/core/src/services/ProfitService.ts` · **UI** = `frontend/src/features/profits/pages/Profits.tsx`
· **FSR** = `packages/core/src/repositories/FinancialServiceRepository.ts`. Line numbers are as of the
audit and WILL drift — anchor on the function names.

### 6.1 How the work is split — lanes, not batches

Batches 1–4 edit the same functions (`getByUser`/`getByClient` are touched by four batches), so one
agent per batch in parallel would overwrite each other. **Batch 0 runs first, alone.** Then **one lane per
Profits tab** runs in parallel; each lane implements every batch-1–4 item inside its tab, in batch
order. Lanes own disjoint functions and disjoint UI blocks.

| Lane | Owns | Items |
|---|---|---|
| **L0** (first, alone) | every FS profit-stamp arm in PR | PA-0.1 |
| **LO** Overview + By Module + By Date | PS `getSummary`/`getByModule`/`getByDate`; PR queries behind them (FS settled/pending/by-provider, sales, recharge, mobile, loto, custom, maintenance, kept change, discounts, supplier commission, deferred, the By Date CTEs, new top-up query); rate read via `RateRepository`; UI Overview / By Module / By Date blocks + their types & loaders; `profitRecognition.guard.test.ts` | PA-1.4 (FS part), 2.1–2.4, 2.8–2.10, 3.1, 3.6, 3.10, 3.11, 4.1–4.14, 4.16 (own loaders), 4.21–4.23 |
| **LCC** By Cashier + By Client | PR `getByUser`/`getByClient` + their service wrappers; UI By Cashier / By Client blocks | PA-1.2, 1.3, 1.7, 2.5, 2.6, 2.11, 3.9, 4.16 (own), 4.19 |
| **LP** Pending | PR `getPendingSaleProfit`, `getUnsettledCommissions`; PS `getPendingProfit`; UI Pending block. **Reads** `getDeferredProfit`, never edits it | PA-1.5, 3.2, 3.3, 3.7, 3.8, 4.16 (own), 4.19 (Pending copy line) |
| **LPay** By Payment Method | PR `getPaymentMethodRows` + its commission row; PS `getByPaymentMethod`; the shared internal-methods constant (exported from `TransactionRepository`); UI By Payment block | PA-1.4 (payment part), 3.5, 4.15, 4.16 (own) |
| **LC** Commissions | FSR `getAnalytics`, `getUnsettledSummaryByProvider`; a new Profits-gated commissions route + IPC + adapter + preload + types; UI Commissions block | PA-1.1, 1.6, 2.7, 3.4, 4.16 (own), 4.17, 4.18, 4.20 |
| **LR** rate | `packages/core/src/utils/exchangeRate.ts` | PA-1.8 |

**Shared-file protocol (non-negotiable):** on PR, PS, UI, FSR and `TransactionRepository.ts` use the Edit
tool only — never Write, never a whole-file rewrite script, never `git stash`/`checkout`/`restore`/`reset`
(the tree holds every lane's uncommitted work plus the owner's staged batch). Every Edit must leave the
file compiling. Rule-17 "revert to prove red" is done with Edit on your OWN code only.

### 6.2 Batch 0 — fix before committing (defect in the uncommitted D1 work)

- **PA-0.1** (1) ✅ **Model-1 FS rows' profit stamp — kept change and the D1 Whish RECEIVE fee — is not
  recognised until the supplier settles.** Model-1 OMT/WHISH rows are born `is_settled = 0`
  (`isPendingSupplierSettlement`, FSR ~:958-968, ~:1674). By Cashier / By Client FS arms count the stamp
  only when `fs.is_settled = 1` (PR ~:2962, :2973, :3115, :3126); the Overview's
  `getFinancialSettledByCurrency` requires `is_settled = 1` (~:1674); `getFinancialPendingByCurrency`
  (~:1697-1724) sums the unsettled stamps and labels them **"pending commission"** — exactly what D1 says
  the Whish fee is not. Then it appears backdated once Whish settles. **Fix:** ONE named predicate
  (rule 14) — the stamp is recognised when `fs.is_settled = 1 OR fs.commission_model = 1` (a model-1 stamp
  never contains commission, only money already in the drawer) — applied to EVERY FS profit-stamp arm:
  Overview, By Cashier / By Client, By Module base arm (`getFinancialSettledByProvider`), By Date
  (`daily_commissions`). Restrict `getFinancialPendingByCurrency` to model 0. **Check first:** a model-1
  BILL through the cost-price flow stamps `price − cost` (FSR ~:1584-1586) — decide whether that is
  realised money; exclude it if it is an estimate. Also closes Overview-audit #7 (OMT/WHISH kept change
  shown as pending).

### 6.3 Batch 1 — stop adding LBP into USD

- **PA-1.1** (1) ✅ [LC] **Commissions headline adds LBP into USD and counts mobile margins as
  "commission".** `getAnalytics` (FSR ~:4958, :4990, :5023) sums `commission` with no currency split and no
  provider filter; UI renders it as USD (~:1840, :1870; `$` hard-coded ~:2023). A 96,000 LBP Katsh margin
  reads "$96,000". **Fix:** filter `COMMISSION_PROVIDERS` (closes the LIRA-108 residual for this query),
  split USD/LBP (`byCurrency` is already returned), render both.
- **PA-1.2** (1) [LCC] By Cashier / By Client FS `revenue_usd` = `fsRevenue(fs)` with no currency check
  (PR ~:2923, :3079) — a 5,000,000 LBP transfer adds $5,000,000.
- **PA-1.3** (1) [LCC] "Pending Profits" column `SUM(fs2.commission)` has no currency filter (PR ~:2988,
  :3141), rendered as USD (UI ~:1736, :1811). Split `_usd`/`_lbp`.
- **PA-1.4** (1) [LPay + LO] `currency != 'LBP'` lumps EUR and others into USD: By Payment (PR ~:2635) — LPay;
  FS rows in By Module / By Date (~:2256-2258, :2472-2475) and Overview (PS ~:319-325) — LO. USD columns use
  `= 'USD'`; other currencies dropped or given their own columns.
- **PA-1.5** (2) [LP] Pending rows print `$` for Amount / OMT Fee / Commission of LBP rows (UI ~:2143-2149).
- **PA-1.6** (2) [LC] Commissions pie and pending column read only `pending_commission_usd` (UI ~:1939, :1983).
- **PA-1.7** (2) [LCC] By Cashier / By Client `revenue_lbp` is computed but never displayed, and ungated
  (`SUM(t.amount_lbp)`, PR ~:2938, :3094).
- **PA-1.8** (1, cross-tenant) [LR] `getUsdLbpSellRate` has **no tenant filter**
  (`utils/exchangeRate.ts` ~:24-26) — on web one shop can read another's rate; recharge stamps use it
  (`RechargeRepository.ts` ~:759).

### 6.4 Batch 2 — tabs agree with the Overview

- **PA-2.1** (1) ✅ [LO] By Module omits kept change (`getDebtRepaymentProfit`), counterparty discounts
  (`getCounterpartyDiscountTotals`) and bills-only supplier commission — `getByModule` never calls them
  (they are called only in `getSummary`). Add three rows; split `getSupplierCommissionTotals` into
  bills-only and cashless (cashless is already under the provider rows — do not count it twice).
- **PA-2.2** (1) [LO] By Date omits the same three (final SELECT of `getByDate`). Add three `daily_*` CTEs
  with identical filters; update `profitRecognition.guard.test.ts` (it lists CTEs by name).
- **PA-2.3** (1) ✅ [LO] `TELECOM_CREDIT_BUYBACK` and `RECHARGE_TOPUP` profit (and their REFUND rows) is
  missing from Overview gross — PS never references them — but counted in By Cashier / By Client via
  `PROFIT_TXN_TYPES`. Add a query, a "Top-ups / Buybacks" card, and rows in By Module and By Date.
- **PA-2.4** (1) [LO] Post-cutover OMT/WHISH commission shows under "Supplier Commission" (UI ~:1197-1240)
  while the Financial Services card's Commission reads $0 for model-1 (UI ~:809-819). Show cashless
  commission on the FS card as "Commission (at settlement)"; keep Supplier Commission for bills-only.
- **PA-2.5** (1) [LCC] By Cashier credits model-1 settlement commission to the **settling** user; By Client
  lumps it under "Walk-in" (`supplierSettlementProfitArm` PR ~:878-890, grouped ~:3007). Attribute through
  `settlement_commission_allocations` → FS row → its own transaction's user / client.
- **PA-2.6** (2) [LCC] By Cashier / By Client leave out exchange profit, PM fees, kept change and
  counterparty discounts. Add arms where attributable (exchange, PM fee, kept change); caption what is not.
- **PA-2.7** (1) [LC] Commissions "Realized" excludes every settled model-1 commission (FSR ~:4944-4946) — a
  fully migrated shop reads ~$0 forever. Include settlement commission (allocations by provider, as
  `getFinancialSettledByProvider` does), reusing PR's exported fragments — do not edit them.
- **PA-2.8** (2, hypothesis) [LO] Mobile-services line: Overview counts unsettled mobile rows (no gate) while
  By Module / By Date count only settled; FS providers outside the 8 hard-coded codes appear in By Module /
  By Date but not the Overview. Same provider list and settled gate everywhere.
- **PA-2.9** (1 once the cost column ships) [LO] By Module FS rows hard-code cost 0 (PS ~:574-575) while
  revenue = price. Add cost by currency in both arms of `getFinancialSettledByProvider` (0 in the allocation
  arm). **Prerequisite for PA-4.23.**
- **PA-2.10** [LO] Reconciliation guards: Σ By Module profit per currency = Overview gross, and Σ By Date net
  = Overview net, on one fixture.
- **PA-2.11** (1) [LCC] By Cashier / By Client date a refund by the REFUND row (PR ~:3005, :3160); the
  Overview adjusts the original period. Date the REFUND by its original transaction's `created_at`.

### 6.5 Batch 3 — earned vs pending, and voids

- **PA-3.1** (1) ✅ [LO] **Kept change stored in the other currency is dropped from net.** A sale stores
  `profit_lbp = kept_change_lbp` (`SalesRepository.ts` ~:817) but `getSalesProfit` sums only `profit_usd`
  and `grossProfitLbp` has no sales term; recharges / FS / mobile read `CASE WHEN currency='LBP' THEN
  profit_lbp ELSE profit_usd` (PR ~:1670, :1705, :1749, :1791); loto sums only `profit_lbp` (~:1899).
  Custom services and maintenance are correct. Add the other-currency column as `kept_change_*` outputs,
  include it in gross, show it on the Kept Change card.
- **PA-3.2** (1) [LP] Pending double-counts for-partner sales (`getPendingSaleProfit` uses only
  `saleNotFullyPaid`; a partner sale always has `paid_usd = 0`; realised already weights it by
  `partnerCoverageRatio`). Exclude partner-obligation sales or weight by `(1 − ratio)`.
- **PA-3.3** (1) [LP] Pending `potential_profit` ignores the sale discount (the realised stamp subtracts it,
  `SalesRepository.ts` ~:537).
- **PA-3.4** (1) [LC] Commissions applies no recognition gates at all (voided / refunded, `notDebtPending`,
  partner coverage, status) — reuse the Overview's named gates.
- **PA-3.5** (1) ✅ [LPay] **By Payment counts voids as cash.** `getPaymentMethodRows` joins `transactions`
  but never checks status or refund, and keeps `p.amount > 0` — a voided sale's cash still counts, and
  voiding an expense or payout writes a positive leg that reads as new takings. Its internal-methods list
  has drifted from `TransactionRepository.INTERNAL_LEG_METHODS` (missing TRANSFER, DRAWER_TRANSFER,
  CREDIT_RETURN, CREDIT_USED, SMS_COST, PM_FEE); owner cash-in is posted as CASH
  (`DrawerTopUpRepository.ts` ~:107, :188-196). The "Commission (Settled)" row sits in the tender table and
  its Share denominator (UI ~:1523-1530) and is legacy-only; raw PM_FEE rows keep voided fees. **Fix:**
  ACTIVE + not-refunded + no reversal legs; ONE shared internal-methods constant; exclude drawer top-ups and
  transfers; take commission / PM_FEE out of the tender table (or at least out of the denominator).
- **PA-3.6** (1) [LO] Unsettled FS rows' revenue is added into "Transaction Amount" / Total Revenue (PS
  ~:334-339) while their commission is excluded, and the pending query lacks the settled query's gates.
  Separate `pending_revenue_*`, shown on the yellow Pending line.
- **PA-3.7** (2) [LP] The Pending tab covers only unpaid sales and legacy model-0 commission — debt-pending
  services / recharges / custom / maintenance, the partner-pending share and cashless deferred commission
  appear only in the Overview's deferred block; `getUnsettledCommissions` is model-0 only and the section
  hides when empty, so post-cutover pending OMT / Whish / bill commission is invisible. Add a Deferred card
  from `getDeferredProfit` and a model-1 awaiting-settlement count row.
- **PA-3.8** (2) [LP] Pending hides unpaid sales older than the date range (30-day default). Pending means
  "as of now": show all outstanding receivables regardless of range, and say so on screen.
- **PA-3.9** (2, hypothesis) [LCC] By Client groups by `client_id` + name / phone snapshots while pending
  matches `client_id` only — a renamed client splits into rows each carrying the full pending. Group by
  `t.client_id` when not null.
- **PA-3.10** (1) [LO] The "Supplier Commission: Deferred" card renders with zero settlements whenever
  `client_debt_profit` ≠ 0 (UI ~:1241-1262), which includes ordinary unpaid recharge / service / loto /
  maintenance debt. Gate on the cashless-deferred amount alone, exposed as its own `DeferredProfitRow` field.
- **PA-3.11** (2) [LO] Unpaid sales appear nowhere on the Overview. Add an "Unpaid sales (not counted)" line
  to the Deferred card via `getPendingSaleProfit`.

### 6.6 Batch 4 — display, plus #3, #14 slice 1 and #29

- **PA-4.1** [LO] Recharges card is USD-only (UI ~:982-994) → both currencies. *Owner-approved.*
- **PA-4.2** [LO] Custom Services card is USD-only (~:947-962) → both.
- **PA-4.3** [LO] Mobile Services card shows one currency or the other (~:896-928) → USD + LBP, like Maintenance.
- **PA-4.4** [LO] The LBP net card has no "Gross" subline; `total_cost_*` is never shown.
- **PA-4.5** [LO] Every module profit is hard-coded green, even when negative → a `profitClass(v)` helper.
- **PA-4.6** [LO] The Kept Change card hides negatives and vanishes when only reversals fall in range.
- **PA-4.7** [LO] In an LBP-only period, Total Expenses and the Deferred lines show "$0.00" as the main figure.
- **PA-4.8** [LO] "Total Revenue" includes pass-through money (FS principal, exchange USD leg, loto face value).
  **Default:** relabel "Turnover (incl. transfers & exchange)", both currencies at equal weight.
- **PA-4.9** [LO] PM fees render inside the Financial Services card but include iPick / Katsh / BOB fees → own card.
- **PA-4.10** [LO] Caption: "Commission appears when settled; past periods may increase" (legacy model-0).
- **PA-4.11** [LO] Exchange "Volume" counts only USD pairs → caption.
- **PA-4.12** [LO] By Module: add a TOTAL footer; sort by USD-equivalent at the LBP buy rate (today USD-only,
  PS ~:702, so LBP-only modules always sink); human labels for provider codes; explain Count 0 on
  allocation-only rows.
- **PA-4.13** [LO] By Date chart runs newest-left → reverse it for the chart; pending commission shows 4 decimals.
- **PA-4.14** [LO] By Date: show `expenses_lbp` and `net_profit_lbp` (already returned by `getByDate`).
- **PA-4.15** [LPay] Rename the tab "Cash intake by method"; count distinct transactions, not legs; fix the
  "No Profit" flag; fix the export name (`profit-by-payment`).
- **PA-4.16** [every lane, own tab] Errors display as "no data": `getByModule` / `getByDate` /
  `getByPaymentMethod` catch and return `[]`; page loaders swallow errors; Commissions shows "Loading…"
  forever on failure. Rethrow and show a visible error state.
- **PA-4.17** [LC] Commissions ignores the date picker (`loadCommissions` passes no dates;
  `getUnsettledSummaryByProvider` is all-time yet feeds a table titled "Today"). Pass from / to through both
  transports, or label each window explicitly.
- **PA-4.18** [LC] Commissions display bugs: `byProvider` is grouped by provider × currency but keyed by
  provider (duplicate keys, slices and pending); "Revenue by Provider" plots commission.
- **PA-4.19** [LCC; the Pending copy line → LP] "Avg Profit/Txn" ignores LBP and counts REFUND / settlement /
  debt-pending / unsettled rows; By Client is silently the top 30; the Pending card's "Recognized once fully
  paid" is wrong for partner sales.
- **PA-4.20** [LC] Commissions data is served by routes outside the Profits lock (`GET
  /api/services/analytics`, `GET /api/suppliers/unsettled-summary`, IPC `omt:get-analytics`,
  `suppliers:unsettled-summary`). **Default:** add a Profits-gated commissions route + IPC behind
  `requireProfitsUnlock` / `requireProfitsGate` (LIRA-177 is server-enforced); leave the originals for the
  pages that already use them.
- **PA-4.21** [LO, **note #3**] ⛔ **Combined line DROPPED by the owner 2026-09-24** (see §2b #3: credits
  are reduced in USD, so the −0.32$ stays a USD figure) — remove `combined_net_profit_lbp` /
  `combined_rate_used` and both renderings after the run; the `margin_pct` part below is kept.
  *Original spec:* Combined **"Total Net Profit ≈ X LBP (at buy rate N)"** — computed at report
  time, the per-currency cards unchanged. Rate = LBP `buy_rate` from `exchange_rates`, tenant-scoped via
  `RateRepository` (never `getUsdLbpSellRate`); `null` + "set an LBP rate" when missing. Server-side
  `margin_pct` / `margin_converted` on `ProfitByModule` (LIRA-183: LBP-only rows rate-free; mixed rows "≈").
  Worked example: 90,000 − 0.32 × 89,000 = **61,520 LBP**.
- **PA-4.22** [LO, **note #29**] Headline "Total Net Profit" card with an explicit Gross − Expenses = Net.
- **PA-4.23** [LO, **note #14 slice 1**] By Module cost columns; expandable Revenue − Cost = Profit per
  currency; maintenance parts / labour split (computed, never rendered); footer Σ gross − expenses = net
  (the combined line is dropped — PA-4.21). Depends on PA-2.1 and PA-2.9.

### 6.7 Explicitly NOT in these batches

- **LIRA-196** (web "today" shifted 3 hours by the UTC server) — blocked on the owner decision of where a
  tenant's timezone lives.
- **#14 slices 2–3** (transaction-level drill-down per module).
- Any repair of historical rows.

### 6.8 Owner decisions taken during the run (2026-09-24) — By Payment ("Cash intake by method")

1. **Net of change.** The tab shows what actually stayed in the drawer, by tender: a $80 sale paid with a
   $100 note shows CASH **$80**, not $100. Signed legs are summed per transaction and method; partial item
   refunds are subtracted too.
2. **Customer wallet payments are shown.** A sale paid with the customer's Whish Wallet / OMT Wallet /
   Binance appears under that method. The provider's own transfer and stock legs stay excluded.
3. **Debt repayments get their own column.** Each method shows new-sales intake vs debt-repayment intake;
   both count in Share. The all-or-nothing "No Profit" flag is removed.

Also found by LPay's round-3 reviewer and being fixed: the lane had added `WALLET_EXCHANGE` to the SHARED
`INTERNAL_LEG_METHODS`, which also drives refund-override validation — a money-path side effect that broke
this run's reporting-only rule. It moves back into the report's own exclusion list, with a test pinning the
refund behaviour to HEAD. Also: voided session baskets still counted as intake; buyback / self-charge credit
legs leaked in as tenders.

### 6.9 Status

**2026-09-24 ~02:50 — laptop on battery; owner ordered: implement tonight, run NOTHING until tomorrow.**
The fix→verify runs were stopped mid-round and an implementation-only run
(`implement-only-tonight`, run id `wf_a2e1e9a5-d6a`) closes the open findings by Edit alone. It runs
no jest, tsc, lint or scripts; its reviewers judge by reading only. **Every test written tonight is NOT RUN.** Where things stood when the tested runs stopped:

| Lane | Last *executed* verdict | Open going into tonight |
| --- | --- | --- |
| Batch 0, LR, LP, LC | ✅ clean (earlier rounds) | — |
| LO (Overview / By Module / By Date) | 29/31 items closed | PA-4.13 (4-decimal pending commission), LO-V14, EUR phantom By Module row, footer loading race, LO-R4/R10 residuals — **plus the #3 combined-line removal** |
| LCC (By Cashier / By Client) | LCC-B1 fixed (item refunds counted again) | **PA-2.11**: item refunds dated and attributed by the refund, not the original sale — By Cashier/Client disagree with the Overview across periods |
| LPay (By Payment) | tenantIsolation = stale fixture, **no leak** | **LPAY-X1**: change in the other currency not netted (USD sale + LBP change overstates LBP intake); X3/X4 minors; LIRA158 test needs `total_lbp` |
| Dashboard chart (§7.1) | 7/8 DC items closed | LINT-1 (4 `react-refresh` errors), DC-7 web silent failure in `getProfitSalesChart`, DC-8 guard weak, rule-14 dup, `Dashboard.tsx` allSettled typecheck errors |

**03:21 — stopped at 8% battery.** How far `wf_a2e1e9a5-d6a` got (nothing run; "clean" means clean by reading):
- **LPay** — all items done (X1 unit-level netting, X3, X4, LIRA158 `total_lbp`); review ✅ clean by reading, 5 minors.
- **Chart** — all §7.1 items done (lint helpers moved to a utils module, DC-7 web error, allSettled types, rule-14 constant); review ✅ clean by reading, 4 minors.
- **LO** — all items done **incl. the #3 combined-line removal**; its review was **cut off** (re-review first). Owner question: **LO-R10** — `ClosingRepository`'s loto mirror now diverges from `getLotoTotals` (which gained `kept_change_usd`).
- **LCC** — round 1 done, but the review found **PA-2.11 still open** (item-refund join fans out). Round 2 was **cut off mid-edit**, so check `getByUser`/`getByClient` for half-finished edits before anything else.

**2026-09-24 12:15 — resumed on the charger.** `yarn rebuild:node` (the binary had been left on the
Electron build) → probe constructs a DB. Run `finish-and-design-219` (`wf_d9d23aa7-354`): the four lanes
with EXECUTED fix→verify loops, then the rule-17 proof pass and the critic; in parallel the LIRA-219 design.

**LIRA-219 WIDENED — owner decision 2026-09-24.** "Today's profit in the closing report = the Profits
page's profit for today." Closing reuses the Profits page's shared code instead of its own copies;
only owner-decided differences (e.g. LIRA-158 settlement-day FS commission) survive, as named exceptions.
Covers: LO-R10 (loto's USD kept change), kept change for every module, every module's LBP profit slice
(the original ticket), and the per-unit sales formula (`ClosingRepository.ts:880`, never × quantity).
Partner loto tickets (closing: all-or-nothing and same-day only; Profits page: proportional) are OUT of
scope and go with LIRA-173.
**12:50 — design approved, build started** (`lira-219-build`, `wf_41c5e5a9-2b5`). Design, owner answers
E-Q1..E-Q7 (net line added; PDF converted totals kept; profit hidden from staff unless the Profits page is
unlocked, server-enforced; "as of HH:MM" line; "unavailable" never $0.00) and the measured closing-vs-Profits
table: `docs/plans/ongoing_plans/LIRA-219_CLOSING_PROFIT_PARITY.md`. The design also found that closing counts a
credit buyback's whole cash payout as profit ($18 on a $20-credit buyback instead of $2).
*Exposure, measured 2026-09-24 (read-only):* production has 3 loto tickets and 4 sale lines, all on
tenant 5; the local desktop DB has 1 and 3. Neither has a partner loto ticket, USD kept change on loto,
or a multi-quantity sale line, so no stored closing figure is wrong yet and the fix is preventive.

**~13:45 — run 1 (`wf_d9d23aa7-354`) COMPLETE.** All four lanes CLEAN on executed verification.
- **Proof pass:** ~35 undo→red→restore checks, and the tree ended byte-identical. It added
  `CommissionsReportService.realDb.test.ts` (untracked — stage it with the batch) for PA-2.7 and PA-3.4.
  Two guards are weaker than the rest: DC-8's formatter body can't be caught on a UTC+ machine, and
  PA-1.1's `realized_lbp` is only asserted indirectly.
- **Critic's own gates:** core jest 3,673 passed, backend 921, frontend 1,770 (1 pre-existing skip),
  electron 163; the typechecks, tenant-scoping and bind-arity all clean.
- **Reconciliation, measured with the real `processSale` and `refundSaleItem`:** Overview = Σ By Module =
  Σ By Date = Σ By Cashier = Σ By Client. The later-month item refund lands in the sale's month.
- **Orchestrator gates, 13:50:** `build:core` ✅; `check:schema-equivalence` ✅ (72 tables, zero diffs);
  frontend `tsc` ✅ (15 s); electron `tsc` ✅; `yarn lint` ❌ with exactly one error (below).
- **LIRA-219 build run (`wf_41c5e5a9-2b5`) did NOTHING.** Its agents read the owner's "status?" as their
  instruction and declined; zero files changed. It needs a fresh go-ahead message from the owner.

**Open before a commit:**
1. Lint: an unused `excludedProviders` at `Profits.commissionsExcludedProviders.test.tsx:129`.
2. Desktop e2e `lira-158` step 7 still expects cashless commission on `supplier_commission`. After
   PA-2.4 that amount is `financial_services.commission_at_settlement_usd`, so the spec must be updated.
3. PA-4.23: the By Module detail row. See decision (a).

**Owner decisions, 2026-09-24 afternoon (all as recommended):**
- (a) **PA-4.23 — fix the sum.** Sale revenue and cost become net of discounts and refunded items, so the
  row adds up to the ledger profit. The $22 profit is right; the $70 and $42 were the wrong figures.
  OMT/Whish/transfer rows show "Commission: $x" instead of an equation.
- (b) **Exchanges stay OUT** of "Cash intake by method" (LPAY-V1).
- (c) **By Payment count:** a sale counts only under the methods that RECEIVED money. A method that only
  gave change doesn't count (LPAY-V2-SIDE-2).
- (d) **Draft autosave SALE rows → LIRA-229**, its own ticket.
- (e) **Named walk-in kept change → LIRA-230**, its own ticket.
- (f) **Two commits:** the owner-note money fixes in one, the Profits + chart work in the other.
- (g) **RECEIVE cash fee on a wallet payout** (LPAY-V2-SIDE-1): PARKED with the open RECEIVE
  payout-fee question.
- (h) **FS commission waiting for a customer's account repayment** (L0-4): ADD a "waiting for repayment"
  line to the Financial Services card, kept out of profit until repaid.

**~17:30 — build run `wf_93c2397c-2cf` COMPLETE, all gates CLEAN on the first pass.**
- **Built:** LIRA-219 (closing profit = Profits page gross, both transports, the PDF net / as-of /
  hidden / unavailable lines, profit server-hidden from staff unless unlocked). Profits follow-ups (a)
  and (h). By Payment (c) and the lint fix. Dashboard DC-10..DC-12. The e2e specs lira-158 and lira-103
  are updated but NOT run.
- **Proof:** 38 undo→red→restore checks passed, with the tree byte-identical before and after.
- **Gates:** core jest 3,747 passed, backend 937, electron 173, frontend 1,824 (1 pre-existing skip); the
  typechecks for all 7 parts, lint (0 errors), schema-equivalence, tenant-scoping and bind-arity all clean.
- **Leftovers now running as `post-run-followups` (`wf_5b107092-745`):**
  - By Date / By Cashier / By Client sale revenue net of discount and refunds (one shared rule; the
    lane boundary had blocked it);
  - the chart's Sales series on the client day;
  - deleting the dead `getMonthlyPL`;
  - the stale comments.
- **Next:** the remaining owner notes are being scouted read-only (`wf_e2d7b9bf-05d`); the owner is
  interviewed before they are built.

**~18:15 — the REMAINING notes: scouted (read-only) and the owner interviewed (8 rounds).**
- **Decisions and build spec:** `docs/plans/ongoing_plans/OWNER_NOTES_REMAINING_BUILD.md`.
- **In scope:** #11 (A/B/C), #19 (Tier A), #20, #21, #24, #28, #13, #16, #14 slice 2 and lira-141.
- **Out of scope:**
  - #17 is PARKED — the owner is unsure whether it is the rate band or a selling price;
  - #1 and #25 need the customer's confirmation;
  - #5 needs the voice note.
- **Process (owner, 2026-09-24):** implement everything first, with a typecheck only per finished
  module area; all tests, proofs and gates run once at the end, then whatever they find is fixed.

**~18:40 — `post-run-followups` COMPLETE, gates CLEAN on the first pass.**
- **Built:** sale revenue net of discount/refunds via ONE shared rule on By Date / By Cashier /
  By Client; the chart's Sales series on the client day; `getMonthlyPL` deleted with its dead
  channel, route and bindings.
- **Proof:** 4/4 guards went red and were restored.
- **Gates:** core jest 3,748, backend 937, electron 173, frontend 1,824; all typechecks, lint (0
  errors) and the checks clean.
- **Launched:** the remaining-notes build `owner-notes-remaining-build` (`wf_ea0dce81-c70`), following
  the owner's implement-first rule. Migrations are pre-assigned: v181 #11-C, v182 #21, v183 #24,
  v184 #28, v185 #16.

**~20:00 — the notes build hit the org's monthly API spend limit.** 44 of 61 agents failed.
- **Implemented before the cut:** #11-A, #11-B, #19, #20, #21, #13, #16, #14, lira-141.
- **Cut mid-edit:** #24, #28, #11-C, and three fix rounds (#20, #21, #14).
- **23:11 — owner said "continue now".** A resume of the same run re-started EVERY agent from scratch:
  the cache did not hit after the script was edited. It was stopped within ~2 minutes, and no file
  was edited (checked).
- **Continuation `owner-notes-continue` (`wf_e2bceb21-f9c`):** it re-hands each agent its saved
  context from `scratchpad/notes_ctx/`, finishes the cut work, reviews each lane read-only with one
  fix round, then writes the e2e specs and runs the ONE end-of-batch gates run (fix loop), the proof
  and the critic.

**~23:25 — owner (weekly credits at 6%): "Just implement… I can run the e2e and everything else
later."**
- **Stopped:** `owner-notes-continue`, before any e2e, gates, proof or critic.
- **Final run:** `owner-notes-finish-implementation` (`wf_5b6f620d-40a`), implementation only. It
  finishes the 7 cut pieces: #11-B fix → #11-C impl, #14 fix, #16 fix, #20 fix, #11-A fix, #28 fix.
- **NOT reviewed after their last change:** #21 and #24.
- **NOTHING in this batch has been run.** The owner's later verification must cover build:core,
  schema-equivalence, typecheck, lint, full jest, the rule-17 proofs for every new test, and desktop
  then web e2e.

**~00:05 (2026-09-25) — remaining-notes IMPLEMENTATION COMPLETE, nothing run.**
- **Implemented:** #11 A/B/C, #19, #20, #21, #24, #28, #13, #16, #14 slice 2 and lira-141.
- **Reviewed by reading, with the findings fixed:** #11-A, #11-B, #13, #14, #16, #19, #20, #28.
- **NOT reviewed after their last change:** #11-C, #21, #24.

Open items for the verification pass / the owner:
- **#28 — owner policy:** should an oversold NO_EXPIRY line also bank into "sold ahead"? Today it
  keeps the pre-#28 arithmetic.
- **#28 — known limitation:** reversing BOTH a days sale AND the later line charge in the same
  session does not fully net. Verify.
- **#16 — owner to confirm:** today's summary leaves a Syria payout's amount out of sales but counts
  its commission as profit.
- **#11-A:** e2e lira-094 group 4 (a large mixed basket) has not been traced against the new netting
  math. The optional lira-135 "netted-to-zero" variant was not added.
- **#14:** test coverage for the drill-down is partial (review item M5).
- **#11-C:** basket REFUND has no test of its own; it shares the void path's checks.
- **Later tickets (owner decisions):** single-item reversal from a basket; #14 slice 3 (the remaining
  modules' drill-down).

**~02:00 (2026-09-25) — the notes batch VERIFIED (unit level).**
- **Owner's first run:** core and frontend failing, and a truncated paste. The typecheck and lint had
  not really run: in cmd, `*>` passed `*` as an argument.
- **Fixes, each by a Sonnet agent:**
  - the Hold Money leg typing (schema-derived guard);
  - four test fixtures missing new columns or tables;
  - an absolute-URL assertion, and `export {}` on 14 global-script dual-mode tests (okJson TS2393);
  - Exchange float noise, stripped in `calculateExchange`'s outputs (a display bug, no cash rounding);
  - **#28 real bug:** `CarrierLineRepository.reverseMovement` clipped a restored expiry to today+365,
    breaking the LIRA-113 exact-restore guard;
  - #21's "void leaves 0.5 profit" was a wrong test (a VOID excludes the original via
    `status != 'ACTIVE'`);
  - `hold_money_pickups` classified in `resetTables` and seeded in the DatabaseReset test;
  - 4 lint errors, incl. TopBar's ref write during render, moved into an effect.
- **Orchestrator's final run:**
  - `build:core`, schema-equivalence (74 tables, 175 migrations, zero diffs), tenant-scoping and
    bind-arity ✅;
  - `yarn typecheck` ✅ (61 s) and `yarn lint` ✅ (0 errors);
  - jest: core 3,931/3,931, backend 963/963, electron 198/198, frontend 1,949 passed (1 pre-existing
    skip).
- **NOT yet done:** the rule-17 red-proofs for this batch's new tests, and desktop + web e2e (the
  owner runs them).

**Owner answers, 2026-09-25:**
- **#28:** a NO_EXPIRY line is never "sold ahead". Keep the pre-#28 arithmetic; no change needed.
- **#16:** today's summary keeps a Syria payout's principal OUT of sales and counts only the
  commission as profit. As built; no change.
- **OMT_APP RECEIVE:** refuse a fee with the SAME D1 message as OMT system, one constant
  (`OMT_RECEIVE_NO_FEE_MESSAGE`). **To do**, after the owner's e2e re-run, so a live run doesn't
  pick it up.
- **Local Sep 7 test sales** (stamps −150/+50 vs FIFO-true +100/+300, from the 04:19–16:43 window
  between `289d9348` and `b013c476`): LEAVE them; production is clean.

**Desktop e2e 2026-09-25: 310 passed / 3 failed. Web e2e: 118 passed / 3 failed / 1 skipped.**
All 6 failures were stale specs, now fixed:
- **lira-127:** the pooled "Session:" line (#11-B).
- **lira-custom-service-payout:** used `page` instead of `appPage`.
- **lira-web-016:** expectations re-derived for D1.
- **lira-web-017 (d)/(e):** the D1 refine now comes first in the shared validator, on both transports.

After the fixes: core 3,935 ✅, frontend 1,949 ✅, typecheck ✅, backend 963 ✅, electron 201 ✅. The
owner re-runs the 3 desktop specs and web e2e.

**Tomorrow, charger in, in this order:** `yarn dev` must NOT be running → `yarn rebuild:node` + a probe that
constructs a database → `yarn build:core` → the per-lane test files the run's checklist names → the rule-17
proof pass (severity-1 items + LCC-B1 + LPAY-X1 + the Debt Repayment column) → `check:schema-equivalence`,
tenant-scoping, bind-arity → `yarn typecheck` + `yarn lint` → full jest per workspace (`--maxWorkers=2`) →
then DC-10..DC-12 (§7.2) → desktop e2e (after the `yarn dev` → stop cycle) before web e2e. Nothing is committed until the owner says so.

## 7. Dashboard Sales/Profit chart and the Net Profit tile — action list (DC-…)

**Source:** read-only audit, 2026-09-24 — a logic trace, a data check that ran the chart's real SQL against
a copy of the local DB plus synthetic rows, and an adversarial verifier. Orchestrator re-verified DC-10's
core claim in code: the chart's Profit query is `SUM(si.sold_price_usd - si.cost_price_snapshot_usd)` —
per unit, never × quantity, no discount (`SalesRepository.getChartData`), while `getTopProducts` in the same
file multiplies by quantity. Synthetic day: chart **$54** profit vs correct **$49 + 20,000 LBP**.

**Owner decisions (2026-09-24):**
1. The chart's **Profit = gross profit, BEFORE expenses**.
2. **"Sales" = product and telecom sales only** — relabelled, not widened to all revenue.
3. **Chart and tile both cover the PAST 30 DAYS (rolling).** The tile becomes **net profit over the same 30
   days**, so Σ(chart gross) − expenses = tile, and both match the Profits page's By Date for those days.

**Production check (read-only, 2026-09-24):** wrong-cost SALE stamps from the v164→v165 window
(`b013c476` fixed new sales only) — **0 affected in production** (tenant 1 has no sales; tenant 5's 4 sales
are all consistent). Only the owner's local dev DB carries such rows. **No repair needed.**

### 7.1 Now — files the Profits run is not touching (`SalesRepository.getChartData`, `Dashboard.tsx`, `DashboardChart.tsx`, `backend/src/api/dashboard.ts`)

- **DC-1** (1) Sales series counts **voided / refunded recharges and financial services** — the two queries
  never check `is_refunded`. Add `COALESCE(is_refunded,0) = 0`.
- **DC-2** (1) Sales series counts **money paid OUT**: `CREDIT_BUYBACK` stores the payout as `price`, a client
  Whish `TOP_UP` stores credits as `price`. Exclude them (the Profits page avoids both by joining
  `transactions` on `type = 'RECHARGE'`).
- **DC-3** (1) An **item refund** leaves the sale `completed` and its full `final_amount_usd` in Sales until
  every line is refunded. Subtract the refunded share.
- **DC-4** (2) Relabel the series **"Product & telecom sales"** (owner decision 2); correct the wrong code
  comment claiming OMT/WHISH are included; define "telecom" precisely (MTC/Alfa recharges + iPick/Katsh/BOB
  mobile-service item sales — not bills, not transfers, not app wallets) and make the query match it; tooltip
  note that the USD line is the USD value of sales, not USD cash.
- **DC-5** (3) Y-axis labels read "0k 0k 1k 1k" for a shop under ~$500/day — plain `$` below 1,000.
- **DC-6** (3) The "USD Sales" tooltip has no `$` and rounds to whole dollars — use `formatAmount(v, "USD")`.
- **DC-7** (3) If ANY dashboard request fails, `Promise.all` rejects and **every tile silently stays at 0** —
  load independently (`Promise.allSettled`), show a per-widget error.
- **DC-8** (3) `new Date("YYYY-MM-DD")` parses as UTC midnight — browsers west of UTC label the previous day.
  Parse the string by hand.

### 7.2 After the Profits run lands — needs its final `ProfitService.getByDate`

- **DC-10** (1) Chart **Profit** = the Profits page's By Date **gross profit per day, before expenses**, USD and
  LBP, LBP on a second axis, over the same past 30 days. Replaces the current query, which ignores quantity,
  discounts, partial refunds, unpaid-sale and partner weighting, every non-product module and all LBP.
- **DC-11** (1) The **"Monthly Net Profit" tile** becomes **"Net Profit — last 30 days"** = Σ By Date net over
  the same window, USD + LBP (today: calendar month, its sales part has the same bugs, no recharges /
  exchange / custom / maintenance / loto). Rewrite `FinancialRepository.monthlyPL.test.ts` test 5, which
  only passes by building an impossible state.
- **DC-12** Reconciliation guard: Σ chart gross − Σ expenses = tile net; chart day = Profits By Date day.
- **Access — owner decision 2026-09-24: keep the Dashboard as it is.** The chart's profit and the Net Profit
  tile stay visible to every role, with no Profits-unlock gate. This differs deliberately from LIRA-219's closing
  PDF, which hides profit from staff unless the Profits page is unlocked (E-Q6).
- **LIRA-196** (web day boundary) stays out of scope — blocked on the tenant-timezone decision.

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
