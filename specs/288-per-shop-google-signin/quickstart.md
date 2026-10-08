# Quickstart: validate LIRA-288

## Automated

Write every test first and run it to see it fail before implementing (rule 17).

| Area | Proof |
|---|---|
| Rule | Linking the same Google account in shop B while it is linked in shop A succeeds. A second user in shop A is refused. Relinking the same user changes nothing. Google sign-up is allowed when the account is linked elsewhere. |
| Directory sync | Each writer in research R3 results in exactly the expected rows: set or confirm an email, clear an email, link or unlink Google, deactivate or reactivate, role change to or from super admin. Shop suspended: the row is kept but not returned. Shop deleted: the rows are gone. |
| Readers | www email code, www Google and the www forgot-password fan-out all return directory results. In **per-tenant mode**, with users in separate files, they return the same shops as in shared mode. |
| Repair | The CLI dry run reports planted drift (a missing, extra and stale row), exiting 1. `--write` fixes it, and a second run exits 0. |
| Migration v200 | The back-fill creates the expected rows from a seeded shared database. `down()` drops the table. Schema equivalence is OK. |
| Join with Google | Matching email: user created, email confirmed, Google linked, signed in. Mismatch: refused and the invite still usable. Already linked in this shop: refused. Lapsed shop: refused. Username taken: refused. A password login for a Google-only user fails until a reset. |
| Admin | The Users list shows the Google email. An admin disconnects it, and that user's Google sign-in on the shop fails while their password works. A non-admin gets 403. |

## Manual (production after deploy)

1. Run `yarn api ssh console -C "node dist/scripts/signinDirectoryCli.js"`. **Expected:** zero differences (SC-005).
2. The owner's Gmail, linked in cornertech and test: on www, Continue with Google shows both shops; on each shop's address it signs straight in.
3. Invite a second Gmail as staff in test → open the link → enter a username → **Join with Google** → you are signed in as staff. Settings → Users shows "Google connected".
4. Admin disconnects it → that staff member's Continue with Google on test now says no account; their password reset path works.
5. Suspend test as super admin → www no longer lists test for either Gmail. Reactivate → it is listed again.

## Gates

`yarn typecheck`, `yarn lint`, `check:tenant-scoping`, `check:bind-arity`, `check:schema-equivalence`, `build-release-notes --check`, `node scripts/run-tests.mjs`, `yarn build`, and the full web e2e, extended with `lira-web-0NN-join-with-google` (Google stubbed as in the backend tests) and a per-tenant-mode directory test.
