# Session resilience, and seeing your signed-in devices

> **Status: BOTH PARTS SHIPPED 2026-09-10** (`c7adaf52`) — 23 files, 53 tests.
> Part 1: `validateSession` no longer reports a database error as an expired
> session; infrastructure errors propagate to 503, genuine invalidity stays
> 401, and a test pins the null-still-means-401 half so the fix cannot
> overcorrect into failing open. Removing that swallow exposed that
> `auth:restore-session` had DEPENDED on it — a blip at desktop boot was
> skipping the encrypted-file fallback — so each call now separates "threw"
> from "invalid".
> Part 2: the Signed-in Devices panel, own-sessions-only, with the token
> never leaving the server (explicit field list, `is_current` computed
> server-side, revoke scoped to tenant AND user). `getUserSessions`, which
> returned raw bearer tokens and had no callers, was removed rather than left
> beside a near-identically-named safe method.
> The three scope questions in §2 were decided as recommended: own sessions
> only, its own Settings tab, and the current row offering plain Sign out.

> **Written**: 2026-09-10, out of a session spent chasing "I keep getting
> logged out" on `test.liratek.shop`.
> Companions: `NEXT_STEPS_AFTER_FLY_MIGRATION.md` (deployment state),
> `MULTI_TENANT_IMPLEMENTATION_PLAN.md` §3/§5 (the JWT + session model).

Two independent pieces of work that came out of the same investigation.

**Part 1 is a bug** — an infrastructure hiccup is currently reported to the
user as "your session expired", and the client obediently signs them out. It is
small, clearly correct, and should go first.

**Part 2 is a feature** — the owner asked whether one account should be allowed
on two machines at once. It already is, and that turns out to be the right
answer for a shop; what is missing is not a restriction but _visibility_.

Ordered by risk. Part 1 can log a cashier out mid-sale; Part 2 cannot hurt
anyone.

---

## Background: what was actually wrong, and what wasn't

Worth recording, because two plausible theories were investigated and **both
were wrong**, and the next person will otherwise re-investigate them.

| Theory                                                                                 | Verdict                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Concurrent logins are blocked — one account, one machine                               | **False.** `AuthService.login` only calls `createSession`; there is no `deleteByUserId` on the login path, no unique index on `sessions.user_id`, and the live database held **12 simultaneous sessions** for the same user. Two API clients and two browser contexts both stayed authenticated for 8+ minutes of polling |
| The server serves requests before the database is ready, so a deploy logs everyone out | **False.** `getDatabase()` runs synchronously _before_ `httpServer.listen()` (`backend/src/server.ts:242-245`). There is no such window                                                                                                                                                                                   |

What _is_ real is the error handling described in Part 1. It was found while
chasing the above, and it has not been proven to be the cause of any specific
reported logout — it is a latent defect, not a diagnosis. Do not write the
commit message as though it fixes a known incident.

---

## Part 1 — a database error must not read as "session expired" 🔴

### The defect

`packages/core/src/services/AuthService.ts:243-245`:

```ts
} catch (error) {
  return null;
}
```

`null` from `validateSession` has exactly one meaning to its caller: _this
session is not valid_. `authenticateJWT` (`backend/src/middleware/auth.ts`)
turns it into `401 "Session expired"`, the frontend's `requestJson` treats a
401 on a credential it actually sent as the end of the session, discards the
token and fires `UNAUTHORIZED_EVENT`, and `AuthContext` drops the user to the
login screen.

So every one of these becomes "your session expired, please sign in again":

- `SQLITE_BUSY` while another write holds the file (`touchActivity` runs a
  write on **every authenticated request**, so contention is not exotic)
- a disk or I/O error
- a `DatabaseError` thrown from `sessionRepo.validateSession`,
  `touchActivity`, `findByIdGlobal` or the `deleteByToken` inside the branch
- anything a future refactor throws in that call path

There is a second copy of the same mistake in the middleware's promise
rejection handler, which answers `401 "Session validation failed"` — the name
admits it is not an expiry.

The user-visible cost: a transient blip signs out whoever is using the till,
mid-sale, with a message that tells them something untrue about their session.
Worse, it is unfalsifiable from the outside — an operator cannot tell it apart
from a real expiry, so it gets reported as "it randomly logs me out", which is
precisely how this investigation started and why it took as long as it did.

### The fix

Distinguish **"this session is invalid"** from **"I could not check"**. They
are different answers and deserve different status codes:

| Situation                                                           | `validateSession` | HTTP    | Client behaviour                               |
| ------------------------------------------------------------------- | ----------------- | ------- | ---------------------------------------------- |
| No such session row / expired / tenant suspended / user deactivated | `null`            | **401** | Sign out — correct, the session really is over |
| Database threw                                                      | _propagates_      | **503** | Fail the request, keep the session             |

`503` is the honest code: the service is temporarily unable to answer. It also
already does the right thing on the client — `requestJson` only ends a session
on `401`, so a 503 fails one request and leaves the login intact. That wants a
test pinning it rather than being left as an accident.

**Do not** make this fail open. The `null` cases must keep returning `null` and
must keep producing 401; only a _thrown_ error becomes 503. An
"if in doubt, allow" reading of this change would be a security hole.

### Files

| File                                        | Change                                                                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/services/AuthService.ts` | Delete the blanket `catch` in `validateSession`, or narrow it so infrastructure errors propagate. Document why the two outcomes differ      |
| `backend/src/middleware/auth.ts`            | `.then()` keeps `null → 401`. `.catch()` becomes **503** with a distinct body, and logs at `error` (it is a server fault, not a user event) |
| `frontend/src/api/httpClient.ts`            | No production change expected — verify and pin that 503 neither clears the token nor fires `UNAUTHORIZED_EVENT`                             |

Check whether any other caller of `validateSession` relies on the swallow
before removing it — the Socket.IO handshake deliberately does **not** call it
(`backend/src/websocket/io.ts`), so the blast radius should be the HTTP
middleware alone, but confirm rather than assume.

### Proving it (rule 17)

Each of these must fail against the current code:

1. **Backend** — `validateSession` mocked to reject → route answers **503**,
   not 401. Fails today (returns 401).
2. **Backend** — `validateSession` resolves `null` → still **401**. Must pass
   both before and after; this is the guard against fixing it by failing open.
3. **Frontend** — a 503 on an authenticated request leaves `getToken()` intact
   and fires no `UNAUTHORIZED_EVENT`. Extend
   `frontend/src/api/__tests__/httpClient.unauthorized.test.ts`, which already
   has the fetch-sequence harness and the event counters.
4. **Core** — `AuthService.validateSession` propagates a repository throw
   instead of returning `null`, while still returning `null` for a missing
   session row.

### Risk

Low. The only behaviour change is the status code on a path that is currently
lying. The one thing to watch is any client branching on `401` to mean
"retry after re-login" — a 503 will not trigger it, which is the intent.

---

## Part 2 — "Signed-in devices" 🟢

### Why this rather than a restriction

The owner asked whether to (a) block a second machine, or (b) revoke the older
session automatically. Recommendation: **neither — keep multi-session, add
visibility.**

- **Blocking** is actively harmful here. Sessions now idle for 8 hours and
  closing a browser does not end one, so an owner who opened the dashboard on
  their phone at lunch would be locked out of the counter terminal until it
  expired. It manufactures support calls out of a non-problem.
- **Auto-revoking** suits a bank, not a till. A small shop legitimately runs
  one `admin` account on the counter terminal, the back-office laptop and a
  phone. Auto-revocation makes those three fight all day, and the loser is
  whoever is mid-sale.
- **Multi-session is what the model was built for**: every session is its own
  revocable row, already carrying `device_type`, `device_info`, `ip_address`
  and `last_activity_at`.

What is genuinely missing is that a user cannot _see_ where they are signed in,
or end a session they no longer control — a laptop left at home, a shared
terminal. That is the real need behind the question.

### What already exists

| Piece                     | Where                   | Reusable?                          |
| ------------------------- | ----------------------- | ---------------------------------- |
| `getUserSessions(userId)` | `AuthService:273`       | Yes — but see the security note    |
| `logoutAll(userId)`       | `AuthService:262`       | Yes — powers "sign out everywhere" |
| `findActiveByUserId`      | `SessionRepository:372` | Yes, tenant-scoped                 |
| `deleteByUserId`          | `SessionRepository:396` | Yes, tenant-scoped                 |
| Device columns            | `sessions` table        | Already populated at login         |

### The security constraint that shapes the design

`findActiveByUserId` returns `SessionEntity`, which **includes `token`** — the
bearer credential itself. That must never cross the wire. A device list that
leaked it would hand any XSS a set of ready-made sessions, which is strictly
worse than the problem being solved.

So:

- Add a `SafeSession` shape: `{ id, device_type, device_info, ip_address,
created_at, last_activity_at, is_current }`. No token, ever.
- `is_current` is computed **on the server** by comparing against
  `req.user.sessionToken`. The client is never given the material to compute it.
- Revocation is **by `id`**, never by token — the client has no token to send.
  `SessionRepository` has no revoke-by-id today; add one, tenant-scoped and
  additionally scoped to the requesting `user_id`, so an id from another
  tenant or another user cannot be revoked by guessing a number.

### Build order

1. **Core** — `SessionRepository.deleteByIdForUser(id, userId)`, scoped by
   `tenant_id` **and** `user_id`. Add `toSafeSession()`; change
   `AuthService.getUserSessions` to return the safe shape (check callers first).
2. **REST** (`backend/src/api/auth.ts`, all behind `authenticateJWT`):
   - `GET /api/auth/sessions` → the caller's own sessions, `is_current` flagged
   - `DELETE /api/auth/sessions/:id` → revoke one of the caller's own
   - `POST /api/auth/sessions/revoke-others` → `logoutAll` minus the current one
     Audit every revocation (`auditRest`), as `logout` already is.
3. **IPC parity — rule 19.** Desktop shares `sessions` and the same
   repository, so the feature works there; it needs the mirroring handlers.
   `electron-app/handlers/authHandlers.ts` currently exposes only
   `auth:login`, `auth:logout`, `auth:restore-session`,
   `auth:get-current-user` — add `auth:list-sessions`, `auth:revoke-session`,
   `auth:revoke-other-sessions`, with the same roles and the
   `{ success, data?, error? }` envelope.
4. **Adapter** — `ipcOrHttp` fns in `frontend/src/api/backendApi.ts`, exposed
   on `ElectronApiAdapter.ts`, typed in `packages/ui/src/api/types.ts`. Reads
   return the raw shape, writes return the envelope.
5. **UI** — a "Signed-in devices" section in Settings. Each row: device, IP,
   last activity (`parseDbDate` → local), a **This device** badge, and Revoke.
   Plus one "Sign out everywhere else" button. Revoking the current session is
   just logout — either disable it or let it log you out, but decide and say so
   in the UI rather than leaving it ambiguous.

### Scope decisions to make before building

- **Own sessions only, or can an admin manage staff sessions?** Recommend
  **own only** for v1. "Admin ends another user's session" is a different
  permission question and drags in the tenant-admin/staff boundary; it can
  follow once the plumbing exists.
- **Where in Settings?** `UsersManager` is the closest neighbour, but this is
  about the _current_ user, not user administration. A small section of its own
  reads better than bolting it onto Users.
- **Expired rows.** `findActiveByUserId` filters on `expires_at > now`, so the
  list is already live-only. Note that no sweep runs on the web backend, so
  the table grows — out of scope here, worth its own item.

### Proving it

- Repository: `deleteByIdForUser` refuses an id belonging to **another user**
  and to **another tenant** (failing-first — write the tests against a version
  scoped only by id and watch them fail).
- Route: the response body for `GET /sessions` contains **no `token` field**
  for any row. This is the one that matters most; assert on the serialised
  JSON, not on the object.
- `is_current` is true for exactly one row — the caller's.
- `revoke-others` leaves the current session working and kills the rest.
- Web e2e in `frontend/tests/e2e-web/`: sign in twice, revoke the other, assert
  the survivor still loads a page.

### Risk

Low, with one sharp edge: **leaking a session token in the list response** would
be a genuine security regression. That is why the safe shape is step 1 and the
"no token in the JSON" assertion is called out separately.

---

## Not in scope

- Any change to how long sessions last — settled in
  `fix(auth): sessions that end while you are still working` (8h idle, 7d for
  remember-me, both sliding).
- Blocking or auto-revoking concurrent logins — explicitly rejected above.
- A sweep for expired session rows on the web backend. Real (the table only
  grows), unrelated to both parts here.
