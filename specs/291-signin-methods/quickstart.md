# Quickstart: validate LIRA-291

## Automated

Write every test first, and run it to see it fail before implementing (rule 17).

| Area | Proof |
|---|---|
| Flag | A user from `acceptWithGoogle` has `has_password = 0`. Every other create path has `1`. `updatePassword` sets `1`. |
| Migration v202 | Seeded users get these values: Google-joined with no later password → `0`; Google-joined who then reset → `1`; password-invite → `1`; Google-created shop admin → `1`; no audit row → `1`. `users` absent → skipped. `down()` drops the column. Schema equivalence passes. |
| Own disconnect | No password → `SET_PASSWORD_FIRST`, and the identity row is kept. With a password → disconnected. |
| Set initial | No password → set: login works, Google still linked, one `password-added` email queued (none when email is off). Already set → `PASSWORD_ALREADY_SET`. A weak password → validation error. |
| Admin disconnect | No password + confirmed email → unlinked, `passwordLink:"sent"`, one `password-set` email. No email or email off → unlinked, `passwordLink:"not_sent"` with the code. Has a password → no email. |
| Forgot wording | No password → a `password-set` email with the username. Has a password → `password-reset` with the username. `check` returns `hasPassword`. |
| Policy | `xY7-pq_Rt.9mZ` is accepted by core and by every route above. `Abcdefg1` is refused with the new message. The frontend no longer imports `shared/utils/validatePassword`. |
| UI | Settings "Sign-in methods": with no password, Set a password is shown and Disconnect shows the refusal. UsersManager: labels and the conditional confirm text. ResetPassword: eye toggles on both fields and the "Set a password" heading. Login: the hint, and the `@` message. |
| Web e2e | `lira-web-0NN-signin-methods`: admin invite → (Google stubbed via the backend test path, or a seeded `has_password = 0` user) → own Disconnect refused → set a password → Disconnect works → username/password login. Plus the admin disconnect sends a set-password email (outbox row). |

## Manual (production after deploy)

1. In test, the Google-joined staff user `aelhalabi` should show "Password + Google" or "Password", because they reset during the LIRA-288 checks.
2. Invite a new Gmail as staff with Join with Google. Users shows "Google".
3. As that user, Settings → Sign-in methods: Disconnect is refused. Set a password. Disconnect now works. Sign in with the username and password.
4. Join again with another invite. As admin, Disconnect: the warning appears, and a "Set a password for <username>" email arrives. The link sets the password.
5. Sign in on the shop's address with an email in the username field: the hint message shows.

## Gates

- `yarn typecheck`, `yarn lint`
- `check:tenant-scoping`, `check:bind-arity`, `check:schema-equivalence`
- `build-release-notes --check`
- `node scripts/run-tests.mjs`
- `yarn build`
- the full web e2e

Desktop e2e is not run on this Mac. It is left for Windows or CI.
