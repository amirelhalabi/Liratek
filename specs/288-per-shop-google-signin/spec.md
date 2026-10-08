# Feature Specification: Google sign-in for every user, scoped per shop

**Feature Branch**: `288-per-shop-google-signin`

**Created**: 2026-10-08

**Status**: Draft

**Input**: User description: "Per-shop Google sign-in for every user (staff included) with a platform sign-in directory. Rule: one Google account = one user per shop (same Gmail allowed in different shops; refused for two users in the same shop). A sign-in directory in the platform database maps verified emails and Google accounts to (shop, user) so www.liratek.shop can list "your shops" (email code, Continue with Google) without searching every shop's database file; kept in sync on email set/verify, Google connect/disconnect, user deactivate, shop suspend/archive; works in shared and per-tenant DB modes. Invite links offer "Join with Google" (create the user and link Google in one step when the Google email matches the invite). Settings → Users shows which users have Google connected and lets an admin disconnect it. Staff can still connect Google themselves from Settings. Web-only. Owner decisions 2026-10-08."

**Ticket**: LIRA-288. Builds on LIRA-267, LIRA-278 to LIRA-281 and LIRA-287, which are live in production.

## Clarifications

### Session 2026-10-08 (owner decisions)

- Q: Can one Google account be used in more than one shop? → A: Yes. **One Google account = one user per shop.** The same Gmail may belong to a cashier in one shop and to the owner of another. It is still refused for two users in the same shop. This replaces the LIRA-280 rule "one Gmail = one shop".
- Q: Where is the "which shops does this email or Google account belong to" knowledge kept? → A: In a sign-in directory in the existing **platform** store, not in a new separate store.
- Q: How does staff get Google sign-in? → A: Three ways:
  - "**Join with Google**" on invite links.
  - Staff **connect Google themselves** in Settings, as today.
  - An admin **sees and can disconnect** staff Google links in Settings → Users.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A person who works in several shops signs in with one Google account (Priority: P1)

Rami is a cashier at CornerTech. He later opens his own shop, "Rami Phones", with the same Gmail.

On cornertech.liratek.shop, "Continue with Google" signs him in as the CornerTech cashier. On ramiphones.liratek.shop it signs him in as the owner. On www.liratek.shop, "Continue with Google", or email plus code, shows "Your shops: CornerTech (as rami), Rami Phones (as owner)" and he picks one.

**Why this priority**: This is the rule change itself. Without it, a person with jobs in two shops is blocked.

**Independent Test**: Link one Google account to a user in shop A and to a different user in shop B. Then:
- Sign in on each shop's own address, and confirm each lands as the right user.
- On www, confirm both shops are listed and each opens correctly.

**Acceptance Scenarios**:

1. **Given** a Google account linked to a user in shop A, **When** a user in shop B connects the same Google account, **Then** it is accepted.
2. **Given** a Google account linked to user X in shop A, **When** another user Y in the same shop A tries to connect it, **Then** it is refused with a clear message.
3. **Given** a Google account linked in shops A and B, **When** the person uses "Continue with Google" on shop A's address, **Then** they are signed in as their shop A user, without being asked to choose.
4. **Given** the same account, **When** they use "Continue with Google" on www, **Then** they see both shops and pick one.
5. **Given** an email confirmed on users in shops A and B, **When** the person uses the email code on www, **Then** both shops are listed with the username in each.

---

### User Story 2 - An invited staff member joins with Google (Priority: P1)

A shop admin invites `rami@gmail.com` as staff. Rami opens the emailed link and clicks "Join with Google". He picks the same Google account. His staff user is created in that shop and linked to Google in one step, with his email confirmed. Next time he signs in with Google on the shop's address.

**Why this priority**: Most staff will join through invites, and this is the easiest way for them to start using Google.

**Independent Test**:
- Invite an address, open the link, choose "Join with Google" with a matching Google account, then sign in with Google. It must work.
- Repeat with a Google account whose email differs from the invited address. It must be refused.

**Acceptance Scenarios**:

1. **Given** a valid invite for `rami@gmail.com`, **When** Rami joins with a Google account whose verified email is `rami@gmail.com`, **Then** his user is created with the invited role and a username he chooses, his email is confirmed, and Google is linked.
2. **Given** the same invite, **When** he picks a Google account with a different email, **Then** joining is refused with "This invite was sent to a different email". The invite stays usable.
3. **Given** the Google account is already linked to another user in the same shop, **When** he tries to join with it, **Then** joining is refused. The invite stays usable.
4. **Given** an invite that is expired, used, or revoked, or a shop that has lapsed, **When** he tries "Join with Google", **Then** the same refusals apply as for the username-and-password path.

---

### User Story 3 - An admin manages staff Google links (Priority: P2)

In Settings → Users, the admin sees a "Google" indicator for each user who has Google connected, with the connected Google email. The admin can disconnect it, for example for a staff member who left. That user can then only sign in with username and password until Google is connected again.

**Why this priority**: Control and offboarding. It is needed once staff can use Google, but it does not block first use.

**Independent Test**:
- Connect Google for a staff user. The admin sees it and disconnects it.
- That user's Google sign-in now fails on the shop's address, and their password still works.

**Acceptance Scenarios**:

1. **Given** a staff user with Google connected, **When** the admin opens Settings → Users, **Then** the user shows "Google connected" with the Google email.
2. **Given** that state, **When** the admin disconnects it and confirms, **Then** the link is removed, and that Google account no longer signs in to this shop. Its links in other shops are unaffected.
3. **Given** a non-admin user, **When** they open Settings → Users, **Then** they cannot disconnect anyone else's Google link.

---

### User Story 4 - www always knows a person's shops, whatever the storage layout (Priority: P2)

Whether all shops share one store (today) or each shop has its own file (planned), www answers "your shops" for an email or a Google account immediately. It never needs to open every shop's data.

**Why this priority**: Without it, www sign-in breaks the day shops move to separate files. Users do not see it until then.

**Independent Test**:
- Run the www email-code and Google sign-in flows against a setup where each shop has its own file. They return the right shops.
- Deactivate a user, suspend a shop, or disconnect Google. Each change is reflected at the next lookup.

**Acceptance Scenarios**:

1. **Given** each shop stored separately, **When** a person uses the email code or Google on www, **Then** all their active shops are listed correctly.
2. **Given** a user is deactivated, **When** their email or Google account is looked up on www, **Then** that shop is no longer listed for them.
3. **Given** a shop is suspended or archived, **When** looked up, **Then** that shop is not listed. If it is reactivated, it is listed again.
4. **Given** an email is changed or unconfirmed, or Google is disconnected, **When** looked up, **Then** the old value no longer leads to that user.

---

### Edge Cases

- **Existing double links:** the owner's Gmail is already linked in cornertech and test from before the old rule. These become simply valid under the new rule, with no action needed.
- **Join with Google but no username yet:** the person still chooses a username, used for password sign-in later and shown to colleagues. A password is optional at join time.
  - **Assumption:** Google-only staff may skip setting a password. They can set one later through "Forgot password", since their email is confirmed.
- **The Google email changes at Google's end:** links are keyed to the Google account's permanent identity, so sign-in keeps working. The displayed Google email updates the next time the person signs in.
- **A person removed from a shop:** after deactivation, Google sign-in on that shop's address is refused, and www stops listing that shop.
- **The same email confirmed on two users in one shop:** not possible, because emails are unique per shop (LIRA-279).
- **Desktop app:** unchanged. It has no Google sign-in and no invites.
- **The sign-in directory is out of date** (for example after a crash between two writes): a repair job rebuilds the directory from the shops' own records. The shop's own records are the source of truth, and the directory is only an index.

## Requirements *(mandatory)*

### Functional Requirements

**Rule**

- **FR-001**: A Google account MUST be linkable to at most one user per shop. It MAY be linked to users in different shops.
- **FR-002**: Linking a Google account already linked to a different user in the same shop MUST be refused with a clear message. Linking it again to the same user MUST succeed without change.
- **FR-003**: Creating a new shop with Google MUST be allowed even if that Google account is linked in other shops. The new shop's admin gets the link.

**Sign-in**

- **FR-004**: "Continue with Google" on a shop's own address MUST sign in the user of *that* shop linked to the Google account, or refuse if none.
- **FR-005**: "Continue with Google" on www MUST list every active shop where the Google account is linked to an active user. The person chooses one, and is then signed in to that shop as that user, through the existing hand-off.
- **FR-006**: The www email-code flow MUST list every active shop where the email is confirmed on an active user (LIRA-287 behaviour, now served by the directory).

**Join with Google (invites)**

- **FR-007**: The invite page MUST offer "Join with Google" next to the username-and-password option.
- **FR-008**: Joining with Google MUST succeed only if the Google account's verified email equals the invited email, ignoring case. It creates the user with the invited role and a chosen username, marks the email confirmed, and links the Google account, all in one step.
- **FR-009**: When joining with Google is refused (email mismatch, account already linked to another user in the shop, invite unusable, shop lapsed), the invite MUST remain usable, unless it was already used, expired or revoked.

**Admin management**

- **FR-010**: Settings → Users MUST show, for each user, whether Google is connected and the connected Google email.
- **FR-011**: A shop admin MUST be able to disconnect any user's Google link in their own shop, after confirming. Non-admins MUST NOT be able to disconnect anyone else's link.
- **FR-012**: Users MUST still be able to connect and disconnect their own Google link in Settings.

**Sign-in directory**

- **FR-013**: The platform MUST keep a sign-in directory that maps each confirmed email and each linked Google account to its (shop, user) pairs. It holds no passwords and no shop business data.
- **FR-014**: The directory MUST be updated whenever:
  - a user's email is set, confirmed or cleared;
  - a Google account is linked or unlinked;
  - a user is deactivated or reactivated;
  - a shop is suspended, archived or reactivated;
  - a user or a shop is deleted.
- **FR-015**: Every www lookup by email or Google account MUST use only the directory, never a scan of shops' data, and MUST give the same answers whether shops share one store or each has its own.
- **FR-016**: The directory MUST be rebuildable from the shops' own records by an operator command. A check MUST report any differences between the directory and those records.
- **FR-017**: The directory MUST be created and back-filled for all existing users and shops when this feature is deployed.

**Scope**

- **FR-018**: Web app only. The desktop app is unchanged.

### Key Entities

- **Sign-in directory entry:**
  - Fields: kind (confirmed email or Google account), value (the email, or the Google account's permanent identity), shop, user, whether it is currently usable (active user and active shop), when it was last updated.
  - Belongs to the platform, not to a shop.
- **User (existing, per shop):** gains nothing new. The email, its confirmation and the Google link stay in the shop's own records, which remain the source of truth.
- **Google link (existing, per shop):** the uniqueness changes from "one per platform" (LIRA-280 rule) to "one per user and one per shop".
- **Invite (existing, per shop):** gains the "join with Google" path. There is no new data beyond what joining creates.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A person linked in two shops reaches each shop with Google in at most 2 clicks on the shop's address, or 3 clicks from www.
- **SC-002**: An invited staff member goes from opening the invite email to being signed in with Google in under 1 minute.
- **SC-003**: After a user is deactivated, a shop is suspended, or Google is disconnected, 100% of subsequent www lookups reflect it, with no stale access.
- **SC-004**: www sign-in lists the same shops for the same person before and after shops are moved to separate storage. Verified on a test set of at least 3 shops and 5 users.
- **SC-005**: The directory consistency check reports zero differences on the production data after back-fill.
- **SC-006**: No Google account can be linked to two users in the same shop. Verified by tests.

## Assumptions

- Google sign-in is already configured and live (LIRA-280). Email codes and confirmed user emails are live (LIRA-279 and LIRA-287).
- The shops' own records stay the source of truth for users, emails and Google links. The directory is an index kept in step with them, plus a repair command.
- **Google-only staff (join without a password):** allowed. They can create a password later through "Forgot password". If the owner prefers that every user has a password, the join page will require one; this is a one-line change.
- The "existing double links" exception (LIRA-280) disappears, because the new rule allows them.
- **Out of scope:**
  - Signing in with an email code alone (still password or Google per shop, as decided in LIRA-287).
  - Account merging across shops.
  - Super admin Google sign-in.
- **Web-only:** an exception to Constitution §I ("one core, two transports"), as with LIRA-267 and LIRA-280. The desktop app has no Google, invites or email.
