# Transport-parity audit — finding the rest of the Settle Debt class

> **Status: PLANNED — nothing built.** Written 2026-09-12, straight out of the
> Settle Debt failure ("Invalid input: expected number, received undefined")
> and the actor-trust gap found while explaining it.
> Companions: `CLAUDE.md` rule 19, `WEB_PARITY_ROADMAP.md` (which modules are
> reachable over REST at all — a different question from whether they are
> reachable *correctly*).

---

## 0. Why this exists

One owner-reported bug on one money modal turned up three distinct defects in
the same short call path. None was exotic; all three are the kind a reader
skims past. The question this plan answers is **how many more of each are
there**, and the honest answer today is that nobody knows.

What makes them worth hunting as a group is that they share a failure
signature: **the desktop build is fine, so nothing looks broken until a web
customer hits it.** Desktop has been the product for most of this codebase's
life, and web parity was added module by module — so every one of these is a
place where the second transport was wired by hand and the hand slipped.

Surface, measured 2026-09-12:

| Thing | Count |
| --- | --- |
| Route files under `backend/src/api/` | 46 |
| Write routes (POST/PUT/PATCH/DELETE) | 158 |
| Adapter functions typed `any` in `backendApi.ts` | 31 |
| Components still holding a `window.api` transport gate | 19 |

---

## 1. The three defect classes, with their signatures

### Class A — payload shape drift (the reported bug)

A component writes its payload **twice**, once per transport, and the copies
disagree:

```js
window.api
  ? addRepayment({ clientId,  amountUSD,  amountLBP,  userId })
  : addRepayment({ client_id, amount_usd, amount_lbp, user_id })
```

Both routes validate against the SAME Zod schema, which speaks camelCase, so
the web copy lost `clientId` and every browser repayment was refused.

Three things had to line up, and all three are still true elsewhere:

1. the component chose its shape from `window.api`, so the two copies were
   never compared against each other;
2. the adapter function is typed `payload: any`, so TypeScript checked
   nothing at the call site;
3. **Zod strips unknown keys silently** — `client_id: 42` raised no
   "unexpected field" complaint, so only the *absence* of `clientId`
   surfaced, and only as a type error naming a field the operator never saw.

**Signature to hunt:** a `window.api ? … : …` (or `if (window.api)`) gate in a
page/component where the two branches construct object literals.

**Sharpest sub-case:** a field that has a `.default()` in the schema. In the
reported bug `amountUSD`/`amountLBP` defaulted to `0`, so their snake_case
twins failed *silently into zeroes* rather than erroring. `clientId` has no
default, which is the only reason this surfaced as an error instead of a
**$0 repayment booked against the wrong client**. Any drifted field whose
schema entry carries `.default()` is a silent-corruption candidate, not an
error candidate — grep those first.

### Class B — actor taken from the body instead of the JWT

Rule 19(c) requires REST to inject `userId`/actor from the token. The
repayment route passed `req.body` straight to the service, so a crafted
request could stamp any user id onto a money record. Not privilege
escalation — but the audit trail and "who took this payment" both read that
field, which is precisely what they exist to establish.

The tell that it was a miss rather than a decision: **five of the six
actor-carrying routes in the same file did it correctly**, all spreading
`{ ...req.body, userId }`. One was skipped.

**Signature to hunt:** a write route whose service call receives `req.body`
without an actor spread, where the corresponding IPC handler overrides the
actor from `requireRole(...)`'s result. The IPC side is the reference
implementation — desktop has consistently done this right.

### Class C — silently doing nothing on the web

An Electron-only API reached through optional chaining, so the browser path
no-ops without error:

```js
if (window.api?.display?.setZoomFactor) window.api.display.setZoomFactor(scale);
if (!window.api) return;   // loadServiceDebtDetails — clicking the row does nothing
```

UI Scale saved the value, re-rendered the control as selected, and changed
nothing. A setting that *looks* like it worked is worse than one that is
missing: the operator re-picks it, concludes the app is broken, and files no
bug because there is nothing to report.

**Signature to hunt:** `window.api?.` with optional chaining, and early
returns guarded on `!window.api`, inside `frontend/src/`.

**Judgement required, and this is the part a script cannot do:** some of
these are *correct*. A backup-directory picker or an app updater has no web
equivalent and should be absent, not ported — see the Diagnostics tab, which
was deliberately hidden on web rather than given REST routes it should never
have. The audit must separate "desktop-only by nature" from "desktop-only by
omission", and only the second is a bug.

---

## 2. What to build — a static guard, not a one-time sweep

This repo already has the right shape for this: `scripts/check-*.mjs`, run in
CI (`check:tenant-scoping`, `check:bind-arity` both run in `ci.yml`). A sweep
finds today's instances; a checked-in guard stops tomorrow's. Given all three
classes are mechanically detectable, the guard is the deliverable and the
sweep is what you get for free on its first run.

Proposed `scripts/check-transport-parity.mjs`, three independent rules so any
one can be adopted without the others:

| Rule | Flags | False-positive risk |
| --- | --- | --- |
| **A1** | A `window.api ? … : …` gate in `frontend/src/**` whose branches contain object literals | Low — this pattern has no legitimate use; the adapter exists for it |
| **B1** | A write route in `backend/src/api/**` calling a service with bare `req.body` where the IPC twin injects an actor | Medium — needs the IPC handler paired by channel name |
| **C1** | `window.api?.` or `!window.api` early-return in `frontend/src/**` | **High** — the desktop-only-by-nature cases are legitimate and numerous |

C1 therefore ships with an **allowlist** carrying a one-line reason per entry
("no web equivalent: Electron file dialog"). The allowlist is the useful
artifact — it converts an ambiguous grep result into a reviewed decision, and
a new unexplained entry becomes a CI failure rather than a discovery two
months later.

---

## 3. Order

| Phase | Work | Why here |
| --- | --- | --- |
| **1** | Rule A1 + fix what it finds | Same class as the reported bug; these are live, silent, and money-adjacent |
| **2** | Rule B1 + fix what it finds | Bounded (158 write routes, IPC handlers as the reference), and it is an integrity property |
| **3** | Type the adapter — replace `payload: any` with `z.input<typeof schema>` on money-path functions first | Removes the *enabling condition* for class A. With this in place A1 becomes a belt-and-braces check rather than the only defence |
| **4** | Rule C1 + build the allowlist | Largest surface (19 components), highest judgement content, lowest severity — a visible no-op, not a wrong number |

Phase 3 is the one worth arguing for even if the others slip. `any` at the
adapter boundary is why a field-name typo in a money payload reached a
customer instead of failing to compile.

---

## 4. Known instances already found (start here)

Fixed in `7d2bd697` and its follow-up — listed so the guard can be validated
against known-true positives:

- **A**: `Debts/index.tsx` repayment payload (camelCase vs snake_case) — FIXED
- **B**: `POST /api/debts/repayments` actor from body — FIXED
- **C**: UI Scale on web (`setZoomFactor` optional chain) — FIXED

Open, found while reading, not yet fixed:

- **C**: `Debts/index.tsx` `loadServiceDebtDetails` opens with
  `if (!window.api) return;` — clicking a service-backed debt row does nothing
  in the browser, with no error.
- **A (latent)**: four more `window.api ? … : …` gates in `Debts/index.tsx`
  alone (`getDebtors`, `getClientHistory`, `getClientBalance`, and the
  service-detail block). These currently *work* — both branches agree — which
  is exactly why they are worth removing before they drift the way the
  repayment one did.

A good first test of the guard: run it against the commit *before*
`7d2bd697` and confirm it flags all three fixed instances.

---

## 5. Explicitly out of scope

- **Whether a module is reachable over REST at all** — that is
  `WEB_PARITY_ROADMAP.md`'s job. This plan assumes the route exists and asks
  whether it behaves identically.
- **Rewriting Zod to reject unknown keys** (`.strict()`). It would have caught
  class A loudly, but it changes validation behaviour on 158 routes at once
  and would reject payloads that legitimately carry extra fields today. If it
  is ever wanted, it belongs in its own plan with its own blast-radius
  measurement — not smuggled in here.
