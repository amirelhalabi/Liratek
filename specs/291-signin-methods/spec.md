# Feature Specification: Sign-in methods for users who joined with Google

**Feature Branch**: `291-signin-methods` (work directly on local `main`, owner preference)

**Created**: 2026-10-08

**Status**: Draft

**Input**: User description: "--number 291 Sign-in methods for users who joined with Google (web only). Every user has a username; staff who joined with Google have no usable password today, and disconnecting Google can lock them out. Owner decisions 2026-10-08 (revised plan "C-lite", aligned with Slack/Atlassian/GitHub): (1) Forgot password always sends a link naming the username; for a user with no password it reads "Set a password for <username>" instead of reset; Google stays connected. (2) Signed-in users with no password can set one from Settings. (3) A user cannot disconnect their own Google while they have no password; show a "Set a password" action. (4) When an admin disconnects Google from a user with no password, the confirm warns and the user is automatically emailed a "Set a password" link. (5) Settings → Users shows each user's sign-in methods: Password, Google, or both. (6) Password rule: any non-letter/non-digit counts as a special character (Chrome-generated passwords pass), defined once in core and used by the frontend. (7) Reset-password page uses the show/hide eye input on both fields. (8) Shop sign-in username field gets a hint "Not your email — use your username", and typing an @ shows "Use your username, or Continue with Google". Needs a way to know whether a user has a password (e.g. password_set_at). Found during LIRA-288 production checks."

**Ticket**: LIRA-291 (web app only; found during the LIRA-288 production checks on 2026-10-08).

## Background

Every LiraTek user has a **username**. How they sign in is separate from that:

- **Password**: the username plus a password.
- **Google**: a Google account connected to that user (LIRA-280, LIRA-288).

Shop owners always choose a password, even when they create the shop with Google. Staff who accept an invite with **Join with Google** (LIRA-288) get **no usable password**. Today the system cannot tell those users apart from users who have one. Two problems follow:

1. A Google-only staff member can disconnect Google from their own Settings and be left with no way to sign in. An admin can do the same to them, with no warning.
2. "Forgot password" works for them, but the email and page say "reset", which reads as if they had a password and forgot it.

During the checks the owner also hit three smaller problems:

- The new-password page refused Chrome's suggested passwords. Only `@$!%*?&` count as special characters, and Chrome uses others such as `-`, `_`, `.` and `:`.
- The new-password page has no show/hide control.
- The owner typed an email into the shop sign-in page's username field and got "Invalid username or password".

How other services handle this (Slack, Atlassian, GitHub):

- A user created with Google may **add** a password later, by email link or from settings.
- Removing your last way to sign in is refused until another way exists.

This feature adopts that model.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A Google-only user can never lock themselves out (Priority: P1)

Rami joined CornerTech with **Join with Google** and has no password. In Settings he tries to disconnect Google.

The system refuses: "Set a password first, so you can still sign in." A **Set a password** action sits right there. He sets one while still signed in. After that, Disconnect works, and he signs in with his username and password.

**Why this priority**: This is the only path in the feature that can leave a real user with no way into their shop. It already exists in production.

**Note (owner decision 2026-10-08, during implementation):** Settings is admin-only, so staff reach Sign-in methods through a new **My account** page (`/account`, every signed-in user, linked from the top bar on the web). On the web, Settings' Signed-in Devices tab moved there too.

**Independent Test**:
1. Create a Google-only staff user.
2. Try Disconnect: it is refused.
3. Set a password from Settings, then disconnect.
4. Sign in with the username and the new password.

**Acceptance Scenarios**:

1. **Given** a signed-in user with Google connected and no password, **When** they choose Disconnect Google, **Then** nothing is disconnected. They see "Set a password first, so you can still sign in." with a **Set a password** action.
2. **Given** the same user, **When** they set a valid password from Settings, **Then** the password works for sign-in at once, Google stays connected, and they receive a notice email that a password was added to their account.
3. **Given** a user who has a password and Google connected, **When** they disconnect Google, **Then** it succeeds as it does today.
4. **Given** a user with no password, **When** something calls the disconnect operation directly (not only through the page), **Then** the server refuses it too.

---

### User Story 2 - An admin disconnecting Google cannot strand a staff member (Priority: P1)

An admin of CornerTech disconnects Rami's Google in Settings → Users. Rami has no password.

The confirm step warns: "Rami has no password. We'll email him a link to set one." When the admin confirms, Google is disconnected and Rami gets an email titled "Set a password for `rami`". He opens it, sets a password and signs in.

**Why this priority**: This is the same lockout, caused by someone else. The owner hit exactly this case in step C of the LIRA-288 checks.

**Independent Test**:
1. As admin, disconnect a Google-only staff user.
2. Check the warning appears.
3. Check exactly one "Set a password" email is queued for that user's confirmed email.
4. Open the link, set a password, and sign in.

**Acceptance Scenarios**:

1. **Given** a staff user with Google connected and no password, **When** the admin opens Disconnect, **Then** the confirm step says the user has no password and will be emailed a link to set one.
2. **Given** the admin confirms, **When** the disconnect completes, **Then** one "Set a password for <username>" email is queued to the user's confirmed email.
3. **Given** a staff user who has a password, **When** the admin disconnects Google, **Then** there is no extra warning and no email (unchanged).
4. **Given** a staff user with no password **and** no confirmed email, or email sending is off, **When** the admin opens Disconnect, **Then** the confirm step says the user will not be able to sign in until a password is set. It also says the admin can set a password for them in Settings → Users → Set Password. The admin may still proceed.

---

### User Story 3 - "Forgot password" tells a Google user they are adding a password (Priority: P2)

Rami has no password. On the shop's sign-in page he clicks **Forgot password** and enters his email.

The email says "Set a password for `rami`". The page it opens says "Set a password for **rami** at CornerTech". He chooses a password, and Google stays connected. From then on he can sign in either way.

**Why this priority**: It already works, but the wording misleads people, and it is the fallback for every case above.

**Independent Test**: Request Forgot password for a Google-only user. Check the email subject and body, then the page heading, then that both sign-in methods work afterwards.

**Acceptance Scenarios**:

1. **Given** a user with no password, **When** a reset is requested for their email, **Then** the email and the page say "Set a password for <username>", not "reset".
2. **Given** a user with a password, **When** a reset is requested, **Then** the email and the page say "Reset your password for <username>" (the username is now named).
3. **Given** a Google-only user sets a password through the link, **When** they sign in afterwards, **Then** both the password and Google work.

---

### User Story 4 - Admins can see how each person signs in (Priority: P2)

In Settings → Users, each user shows a sign-in method: **Password**, **Google**, or **Password + Google**.

**Why this priority**: Admins need this to understand the warning in Story 2 and to support their staff. On its own it is not a fix.

**Independent Test**: Seed one user of each kind. Check the Users list shows the right label for each.

**Acceptance Scenarios**:

1. **Given** users with password only, Google only, and both, **When** an admin opens Settings → Users, **Then** each row shows the matching label.
2. **Given** a user sets a password or connects or disconnects Google, **When** the admin reloads the list, **Then** the label reflects the change.

---

### User Story 5 - Browser-suggested passwords are accepted (Priority: P2)

On any page where a password is chosen, a browser-generated password such as `xY7-pq_Rt.9mZ` is accepted.

The page has a show/hide control on each password field, like the sign-in page. The browser can still offer to generate and save the password.

**Why this priority**: The owner was blocked by this during the checks. It affects everyone who sets a password.

**Independent Test**: Enter a password that has no character from `@$!%*?&` but has another symbol. Check it is accepted in the page and by the server. Toggle show/hide on both fields.

**Acceptance Scenarios**:

1. **Given** a password with upper and lower case letters, a digit, at least 8 characters, and any symbol that is not a letter or digit, **When** it is submitted on any password-setting page, **Then** the page and the server both accept it.
2. **Given** a password with only letters and digits, **When** it is submitted, **Then** it is refused with "Password must contain a symbol (for example - _ . @ ! #)".
3. **Given** the new-password page, **When** the user clicks the eye control on either field, **Then** that field toggles between hidden and visible.
4. **Given** the new-password page, **When** the browser offers a generated password, **Then** it can fill both fields and save it as a new password.

---

### User Story 6 - The shop sign-in page explains what goes in the username field (Priority: P3)

On a shop's own sign-in page, the username field shows the hint "Not your email — use the username your admin gave you". If the person types an `@`, the page shows "Use your username, or Continue with Google".

**Why this priority**: This is a guidance message only, to prevent the confusion seen in the checks.

**Independent Test**: Open a shop's sign-in page, type a value containing `@`, and check the message.

**Acceptance Scenarios**:

1. **Given** the shop sign-in page, **When** it loads, **Then** the username field shows the hint.
2. **Given** the user types a value containing `@`, **When** the field updates, **Then** the message "Use your username, or Continue with Google" is shown, and submitting is still allowed.
3. **Given** the www sign-in page (which already accepts an email), **Then** it is unchanged.

### Edge Cases

- **Existing users.** Every user who existed before this feature is treated as having a password, **except** users known to have joined with Google and never set one. This is the safe direction for the disconnect guard only if those users are identified, so the plan must show how they are found. In production on 2026-10-08 the only such user already set a password during the checks.
- **Super admin and desktop users** always have passwords. Nothing changes for them.
- **Setting a password while one exists.** "Set a password" is offered only to users with no password. Users who have one keep the existing change-password flow, which asks for the current password.
- **A user whose shop is suspended or lapsed** cannot reach Settings. Forgot password behaves as it does today for such shops.
- **Two reset requests.** The second link replaces the first, as today.
- **The admin disconnects their own Google.** The same rule as Story 1 applies: an admin with no password cannot disconnect themselves. Owners always have passwords, so this only affects promoted staff.
- **Email sending is off.** The admin warning in Story 2 says the user will not get an email. The user's own Disconnect in Story 1 is unaffected, because it needs no email.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST record, for each user, whether they have a usable password.
- **FR-002**: The system MUST mark a password as set whenever one is chosen: at shop creation, at invite acceptance with a password, by reset link, by change password, by "Set a password" from Settings, and by an admin setting it (Settings → Users → Set Password).
- **FR-003**: A user created through Join with Google MUST be recorded as having no password.
- **FR-004**: The system MUST refuse to disconnect a user's last remaining sign-in method. This applies on the page and on the server, for the user's own disconnect.
- **FR-005**: Signed-in users with no password MUST be able to set one from Settings without entering a current password. This uses the same password rule as everywhere else.
- **FR-006**: When a password is set by "Set a password" from Settings, the system MUST send the user a notice email that a password was added to their account, if they have a confirmed email.
- **FR-007**: When an admin disconnects Google from a user with no password, the system MUST warn the admin before confirming. If the user has a confirmed email and email is on, it MUST queue exactly one "Set a password for <username>" email.
- **FR-008**: The forgot-password email and page MUST name the username. They MUST say "Set a password" for users with no password, and "Reset your password" for users with one.
- **FR-009**: Setting a password through any path MUST NOT disconnect Google.
- **FR-010**: Settings → Users MUST show each user's sign-in method: Password, Google, or Password + Google.
- **FR-011**: The password rule MUST be defined once and used by both the pages and the server. It MUST count any character that is not a letter or digit as a symbol. The other parts of the rule are unchanged: minimum length, upper case, lower case and a digit.
- **FR-012**: Every password-setting page MUST offer a show/hide control on each password field, and MUST let the browser generate and save a new password.
- **FR-013**: The shop sign-in page MUST show the username hint, and MUST show the "Use your username, or Continue with Google" message when the input contains `@`.
- **FR-014**: The web app only. The desktop app's password rule follows FR-011, because the rule is shared. No other desktop change.
- **FR-015**: Every refusal MUST use the existing response format (`success:false` with a code and a message).
- **FR-016**: Each user-visible change MUST have a release-note line and a "What users will notice" line in the ticket.

### Key Entities

- **User sign-in state**: per user, whether a usable password exists, plus whether a Google account is connected (already recorded). Together these give the sign-in method shown to admins and used by the disconnect rule.
- **Set-a-password email**: the existing reset email, worded for users with no password. It is sent on request and automatically after an admin disconnect.
- **Password-added notice**: a short email telling the user that a password was added to their account, with a pointer to contact their admin if they did not do it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Neither the user nor an admin can leave a user with zero sign-in methods. The only exception is an admin who has seen the warning that no email can be sent. This is verified for every combination of password / Google / email-on / email-off.
- **SC-002**: A Google-only user whose Google is disconnected by an admin can be signed in with a password within 5 minutes, using only the email they receive.
- **SC-003**: 100% of reset and set-password emails and pages name the username.
- **SC-004**: Browser-generated passwords from Chrome are accepted on every password-setting page, on the first try.
- **SC-005**: Admins can tell each user's sign-in method from the Users list without opening anything else.
- **SC-006**: Repeating the owner's LIRA-288 check C produces no confusing message: join with Google, admin disconnect, then sign in with the password.

## Assumptions

- The password rule's other parts (minimum 8 characters, upper case, lower case, digit) stay as they are. Only the symbol part widens.
- "Set a password" from Settings needs only an active session, matching Atlassian and GitHub settings. The notice email (FR-006) is the safeguard against a stolen session. A stricter re-check (for example, signing in with Google again first) is out of scope.
- Owners keep always having a password (owner decision 2026-10-07). Nothing here makes Google-only owners possible.
- Accepting an email in the shop sign-in username field is out of scope (owner preference 2026-10-08). The hint is the fix.
- The www identifier-first sign-in (LIRA-287) already accepts email and is unchanged.
- The existing forgot-password limits, expiry and one-use rules apply to set-password links unchanged.
