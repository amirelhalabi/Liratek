# Quickstart: Validate Email Invites for Sign-up (LIRA-267)

## 1. Local, without a real mail provider (`file` transport)

1. In `backend/.env`, set:
   ```
   EMAIL_TRANSPORT=file
   EMAIL_FILE_DIR=<scratch dir>/mail
   ```
   Leave `SIGNUP_INVITE_CODE` unset to prove the invite path works on its own.
2. Run `yarn workspace @liratek/backend dev` and `yarn workspace @liratek/frontend dev` (browser, no Electron). Log in as super-admin and open the **Tenants** page. Use **Send invite**.
3. Invite `test@example.com`.
   - **Expected:** the list shows `pending`, and the email status moves from queued to accepted within one worker interval.
   - **Expected:** `<scratch>/mail/` contains `signup-invite-<id>.html`, `.txt` and `.json`.
4. Open the `.html` file and click the link.
   - **Expected:** `/signup?invite=…` shows the email, locked, and there is no invite-code field.
5. Complete sign-up.
   - **Expected:** 201, and the invite shows `used` with the new shop's slug.
   - **Expected:** querying the tenants table shows `contact_email = 'test@example.com'`. To read the database, use Python `sqlite3` on a copy, as CLAUDE.md describes.
6. Open the same link again.
   - **Expected:** the generic "not valid" message.
7. Revoke a second invite, then open its link.
   - **Expected:** the same generic message.

## 1b. Self-serve sign-up, locally

1. In `backend/.env`, add Cloudflare's always-pass test keys.
   - **Likely, based on Cloudflare's Turnstile docs; verify before relying on them:** `TURNSTILE_SITE_KEY=1x00000000000000000000AA` and `TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA`.
   - Keep `EMAIL_TRANSPORT=file`.
2. Log out and open the login page.
   - **Expected:** a **Sign up** link.
3. Click it.
   - **Expected:** only an email field and the Turnstile widget.
4. Enter `self@example.com` and submit.
   - **Expected:** "If this address can be used, we've emailed a link."
   - **Expected:** a `signup-invite-<id>.html` file appears in `EMAIL_FILE_DIR`.
5. Open the link and complete the form.
   - **Expected:** the shop is created, you can log in, and `contact_email = 'self@example.com'`.
6. Submit `self@example.com` again on the Sign up page.
   - **Expected:** the same message, and no new email file, because the address now has a shop.
7. Submit 6 times quickly from the same browser.
   - **Expected:** the 6th gets "Too many requests, please try again later".
8. Remove `TURNSTILE_SECRET_KEY` and restart.
   - **Expected:** the **Sign up** link disappears, and `/signup` says "Sign-up is not available right now".
   - **Expected:** admin **Send invite** still works.

## 2. Email design preview

Run:

```
yarn workspace @liratek/backend email:preview signup-invite
```

**Expected:**
- An HTML file opens in the browser with sample data.
- A shop name hint of `<b>x</b>` appears as literal text.

## 3. Automated tests

These are listed in the order they are written. Each one must be seen failing before its code is written (rule 17).

| What | Where |
| --- | --- |
| Template rendering: escaping, unknown variable throws | `backend/src/email/__tests__/renderTemplate.test.ts` |
| Outbox worker: claim, accepted, transient backoff, permanent error goes to failed, crash recovery from `sending`, link scrubbed after a final status, never sends twice | `backend/src/email/__tests__/outboxWorker.test.ts` (fake transport, real in-memory DB through `__LIRATEK_TEST_DB__`) |
| Repositories: claim race (second claim gets 0 changes), release, derived status | `packages/core/src/repositories/__tests__/SignupInvitationRepository.test.ts` |
| Admin routes: role gate, 409 when mail is off, create writes both rows in one transaction | `backend/src/api/__tests__/signupInvitations.api.test.ts` |
| Sign-up with token: valid, expired, used, revoked, unknown, both/neither fields, provisioning failure releases the invite, `contactEmail` comes from the invite and not the body | extend `backend/src/api/__tests__/signup.api.test.ts` |
| Frontend: `?invite=` locks the email and hides the code field; admin list and revoke | `frontend/src/features/auth/pages/__tests__/Signup.invite.test.tsx`, `frontend/src/features/admin/.../__tests__/` |
| Schema and migration | `yarn check:schema-equivalence` (build core first) |
| Web e2e: invite, read the link from `EMAIL_FILE_DIR`, sign up | `frontend/tests/e2e-web/lira-web-039-email-invite.spec.ts` |

## 4. Gates

Run all of these before calling the work done:

- `yarn lint`
- `yarn typecheck`
- `yarn check:tenant-scoping`
- `yarn check:bind-arity`
- `yarn check:schema-equivalence`
- core, backend and frontend tests
- `yarn build`
- the `browserEntryIsNodeFree` guard

Confirm that each suite actually ran by checking its test count and elapsed time (rule 28).

## 5. Go-live (the owner, once the transport is chosen)

1. Create the Spacemail mailbox and add its records to Cloudflare as **DNS only**. Steps are in `docs/plans/todo_plans/EMAIL_INVITE_SIGNUP_PLAN.md` §4.1.
2. Set the secrets with `yarn api -- secrets set EMAIL_TRANSPORT=… EMAIL_FROM=… <credentials>`, and redeploy with `yarn api:deploy`.
3. Invite a real Gmail address. In Gmail, open **Show original** and check that SPF, DKIM and DMARC all show **PASS** (spec SC-006).
4. Merge Stage B, which deletes the shared invite code from the code (plan step 7). After it deploys, run `yarn api -- secrets unset SIGNUP_INVITE_CODE`.
5. **Check:** opening `/signup` without a link shows the email request form, with no invite-code field. A request carrying `inviteCode` is refused (spec SC-007).
