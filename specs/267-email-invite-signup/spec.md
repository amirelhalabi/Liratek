# Feature Specification: Email Invites for Sign-up

**Feature Branch**: `267-email-invite-signup`

**Created**: 2026-10-07

**Status**: Draft

**Input**: User description: "Email invites for sign-up: platform super-admin sends personal single-use, expiring invite links by email from mail@liratek.shop, replacing the shared SIGNUP_INVITE_CODE (kept as transition fallback). New shops get a verified tenants.contact_email. Built-in backend mail module with SQLite email_outbox, retries, idempotency, repo-stored HTML+text templates with local preview, pluggable transport (Spacemail SMTP or Resend, decided later; fake transport for tests). Web-only. Phase 2 self-serve request link is out of scope until Turnstile lands. Full design: docs/plans/todo_plans/EMAIL_INVITE_SIGNUP_PLAN.md"

**Ticket**: LIRA-267 · **Design notes**: `docs/plans/todo_plans/EMAIL_INVITE_SIGNUP_PLAN.md`

## Clarifications

### Session 2026-10-07

- Q: Web-only exception to the "works on desktop and web" rule? → A: Approved by the owner.
- Q: How is the invite link kept so a failed email can be retried? → A: It stays in the queued email until the email is accepted or finally fails, then it is erased (FR-004).
- Q: How should the app send email? → A: Spacemail SMTP, using `mail@liratek.shop`. A transactional provider can be added later.
- Q: How long is an invite link valid? → A: 72 hours.
- Q: What happens to the shared invite code? → A: It is deleted from the code at launch, after a real invite email has been verified in production. The admin "Add shop" action is the fallback.
- Q: Which languages? → A: English only.
- Q: Can the person change the email on the sign-up page? → A: No, it is locked.
- Q: Can an address that already has a shop be invited again? → A: No. One shop per contact email, enforced by the database. A second pending invite to the same address is allowed.
- Q: Should the admin "Add shop" form ask for an email? → A: Yes, as an optional and unverified field.
- Q: Should a welcome email be sent after sign-up? → A: Not in this feature.
- Q: Should people be able to sign up by themselves? → A: Yes. The sign-up page asks only for an email. The link then opens the full form with the email locked, and submitting creates an active shop (owner, 2026-10-07). This reverses the earlier "admin invites only" assumption.
- Q: How is self-serve sign-up protected from abuse? → A: Rate limits plus Cloudflare Turnstile.
- Q: Where does the admin "Send invite" feature live? → A: On the super-admin Tenants page, not a separate page.
- Q: What is the login-page link called? → A: "Sign up", replacing "Create your shop". It is shown whenever self-serve sign-up is available.
- Q: Should there be a test for the sender's address? → A: No (owner).
- Q: What is the retry policy? → A: Two attempts in a row, then a 10-minute pause, repeated until the invite expires (owner, 2026-10-07).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Platform owner invites a new shop by email (Priority: P1)

The platform owner wants to let a specific person open a LiraTek shop on the web app. Today the owner has to pass on one shared invite code, and anyone who learns it can open any number of shops. With this feature the owner types the person's email address on the platform admin page and presses **Send invite**. The person receives an email from `mail@liratek.shop` with a personal link. Opening the link takes them to the sign-up page with their email already filled in. They choose a shop name, username and password, and their shop is created.

**Why this priority**: This is the core value. It replaces a shared secret with a personal invitation the owner controls, and it gives every new shop a verified email address.

**Independent Test**: The owner sends an invite to a test inbox and opens the link. The person completes sign-up and logs in to the new shop. The shop record shows the invited email address as its contact email.

**Acceptance Scenarios**:

1. **Given** email sending is configured, **When** the owner enters a valid email and presses Send invite, **Then** the invite appears in the list as "pending" and an email with a personal sign-up link is queued for delivery.
2. **Given** a pending invite, **When** the invited person opens the link, **Then** the sign-up page shows their email, which they cannot edit, and does not ask for an invite code.
3. **Given** the person has opened a valid link, **When** they submit the sign-up form, **Then** their shop is created, its contact email is the invited email, and the invite shows as "used".
4. **Given** an invite that has already been used, **When** anyone opens the link again, **Then** sign-up is refused with a message to ask the owner for a new invite.

---

### User Story 4 - Anyone requests a sign-up link by email (Priority: P1)

A shop owner who heard about LiraTek clicks **Sign up** on the login page. The sign-up page asks only for their email address, behind an invisible "are you human" check. They receive the same kind of personal link an admin invite would send. Opening it shows the sign-up form with their email locked: shop name, username and password. Submitting creates their shop, and they can log in straight away.

**Why this priority**: This is how new shops arrive without the owner's involvement. It reuses the invite link, the email and the sign-up form from User Story 1, and adds only the request form and abuse protection.

**Independent Test**: Click Sign up on the login page, enter an email, open the link from the email, complete the form, then log in.

**Acceptance Scenarios**:

1. **Given** the login page, **When** a visitor clicks Sign up, **Then** they see a page asking only for their email address.
2. **Given** a valid email and a passed human check, **When** they submit, **Then** they see "Check your inbox", and an invite email is queued.
3. **Given** an email that already belongs to a shop, or that is over its per-email limit, or the daily cap is reached, **When** they submit, **Then** they see the same "Check your inbox" message, and no email is sent.
4. **Given** one visitor sends more than 5 requests in an hour, **When** they submit again, **Then** they see "Too many requests, please try again later". That message does not depend on the email entered, so it reveals nothing about it.
5. **Given** the human check fails or is missing, **When** they submit, **Then** the request is refused and nothing is queued.
6. **Given** the link from that email, **When** they complete the form, **Then** the shop is created and active, its contact email is theirs, and they can log in.

---

### User Story 2 - Owner manages sent invites (Priority: P2)

The owner can see every invite they sent. For each one they see the email, when it was sent, its status (pending, used, expired or revoked) and whether the email was accepted for delivery. They can revoke a pending invite, for example if it went to the wrong address, and they can send a fresh invite to the same address.

**Why this priority**: Without this, a mistyped address or a lost email leaves the owner stuck. It is not required to deliver the first invite.

**Independent Test**: Send two invites, revoke one, and let one expire (or simulate expiry). The list shows the correct status for each. The revoked link no longer works.

**Acceptance Scenarios**:

1. **Given** a pending invite, **When** the owner revokes it, **Then** its status becomes "revoked" and its link is refused.
2. **Given** an invite whose email could not be sent after all retries, **When** the owner views the list, **Then** that invite is clearly marked as "email failed", with the reason.
3. **Given** an expired or revoked invite, **When** the owner sends a new invite to the same address, **Then** a new link is issued and the old one stays unusable.
4. **Given** an address that is already a shop's contact email, **When** the owner tries to invite it, **Then** the invite is refused and names the existing shop.

---

### User Story 3 - Emails are reliable, branded and previewable (Priority: P3)

Invite emails carry the LiraTek look and arrive in both rich and plain-text form. A temporary sending problem does not lose an email; the system tries again. A crash or restart never sends the same email twice. The owner or a developer can preview any email design on their own computer before it is sent to anyone.

**Why this priority**: This makes the feature trustworthy in daily use. The first invite can work without polish, but not for long.

**Independent Test**: Simulate a temporary sending failure, then recovery, and confirm exactly one email goes out. Run the preview and check the design in a browser.

**Acceptance Scenarios**:

1. **Given** the mail provider is briefly unavailable, **When** an invite is sent, **Then** the system retries on a schedule and delivers exactly one email once the provider recovers.
2. **Given** the provider rejects the email permanently (for example, an invalid address), **When** the send is attempted, **Then** the email is marked failed with the reason. The invite stays pending, so the owner can revoke it and invite a corrected address.
3. **Given** the provider keeps failing temporarily, **When** the invite reaches its expiry, **Then** retrying stops, the email is marked failed with the last error, and the invite shows as expired.
4. **Given** the service restarts while an email is being sent, **When** it comes back, **Then** the recipient does not receive a duplicate.
5. **Given** a shop name hint containing HTML or script text, **When** the email is rendered, **Then** that text appears as plain text and is not interpreted.

---

### Edge Cases

- **Email sending not configured:** the invite form says email is not set up, and no invite is created. Before launch, the shared invite code still works. After launch, the admin "Add shop" action is the fallback.
- **Invalid or unknown link, or an expired, used or revoked link:** sign-up is refused with the same generic message in every case, so nobody can tell which links ever existed.
- **Two sign-ups racing on one link:** exactly one succeeds and the other is refused.
- **Shop creation fails partway, for example because the shop address is taken:** the invite stays unused so the person can try again with another name.
- **Address casing and spaces:** the owner types the address with different capital letters or extra spaces. The address is trimmed and compared without regard to case.
- **Address already has a shop:** the owner invites an address that is already a shop's contact email. The invite is refused. The database also enforces this, so two sign-ups cannot race past it. A second pending invite to the same address is allowed.
- **Human check service unavailable:** Turnstile verification fails closed. The request is refused with "Please try again in a few minutes" and nothing is queued. Admin invites keep working as the fallback.
- **Link copied or forwarded to someone else:** the link works once, for whoever uses it first, and the shop records the invited email. This is the accepted risk of a link-based invite.
- **Sign-up page opened without an invite link:** when self-serve is on, the page shows the email request form (FR-026). When self-serve is off, it says "Sign-up is not available right now" and shows no form.

## Requirements *(mandatory)*

### Functional Requirements

**Invites**

- **FR-001**: Only platform administrators MUST be able to send invites from the admin screen, list invites and revoke them. Self-requested links (FR-025) are the only other way an invite is created.
- **FR-002**: Creating an invite MUST require a valid email address. A shop name hint MAY be given.
- **FR-003**: Each invite MUST produce a unique, unguessable, single-use link that expires 72 hours after it is created.
- **FR-004**: The invite record MUST store only a one-way fingerprint of the link token, never the token itself. The queued email may hold the link only until the provider accepts the email or it finally fails. After that, the system MUST erase the link from the queued email. (Added during planning: an email can only be retried if the link is still available.)
- **FR-005**: Creating an invite and queuing its email MUST happen together. Either both are recorded or neither is.
- **FR-006**: The owner MUST be able to revoke a pending invite. A revoked invite's link MUST be refused.
- **FR-007**: The invite list MUST show, for each invite: email, created time, expiry time, status (pending, used, expired or revoked) and email delivery state (queued, accepted by provider, or failed with reason).

**Sign-up with an invite**

- **FR-008**: Opening a valid invite link MUST show the sign-up form with the invited email filled in and not editable, and with no invite-code field.
- **FR-009**: Sign-up MUST be refused, with one generic message, for a link that is unknown, expired, used or revoked.
- **FR-010**: A successful sign-up MUST record the invited email as the new shop's contact email and mark the invite used. If a crash happens between creating the shop and marking the invite, it MUST NOT be possible to create a second shop from that invite. FR-013a guarantees this. When the system later finds that the invite's shop already exists, it MUST mark the invite used.
- **FR-011**: If shop creation fails, the invite MUST remain unused.
- **FR-012**: When two sign-ups use the same link at the same time, at most one shop MUST be created.
- **FR-013**: At launch, the shared invite code MUST be removed from the product entirely, including the field, the check and the setting. After launch, the only ways to create a shop are an email link (admin-sent or self-requested) or the platform admin's "Add shop" action. The removal ships only after a real invite email has been verified in production (see SC-006).
- **FR-013a**: No two shops MUST share a contact email. Comparison is case-insensitive. Inviting an address that already belongs to a shop MUST be refused with a clear message.
- **FR-013b**: The platform admin's existing "Add shop" form MUST offer an optional contact email field. It is unverified, and it is subject to FR-013a.

**Email sending**

- **FR-014**: All emails MUST be sent from a `liratek.shop` address, with `mail@liratek.shop` as the default.
- **FR-015**: Every email MUST be queued durably before sending, and sent after the request that created it has completed.
- **FR-016**: Each queued email MUST carry a unique key, so that a retry or restart never delivers it twice.
- **FR-017**: Each send round MUST try twice in a row. If both attempts fail temporarily, the next round MUST start 10 minutes later. Rounds continue until the email is accepted, a permanent failure occurs (for example, a rejected address), or the invite expires. When an invite email gives up, its give-up time is the invite's expiry. The last error MUST be kept when the email finally fails.
- **FR-018**: "Sent" MUST mean only "accepted by the mail provider" and MUST be labelled that way. The system MUST NOT claim the email was delivered to the inbox.
- **FR-019**: When email sending is not configured, the system MUST send nothing and MUST say so clearly in the invite form. Before launch, the shared invite code keeps working. After launch, the platform admin's "Add shop" action is the only way to create a shop until email is fixed.
- **FR-020**: The mail provider MUST be replaceable without changing invite or sign-up behaviour. Automated tests MUST use a stand-in that sends nothing.

**Templates**

- **FR-021**: Email designs MUST be stored with the product source, versioned like code. Each email MUST have a rich (HTML) and a plain-text version.
- **FR-022**: Every value inserted into an email MUST be escaped, so user-entered text is shown as text and never run as markup.
- **FR-023**: A developer or the owner MUST be able to render any email design with sample data and view it locally, without sending anything.

**Scope**

- **FR-024**: This feature applies to the web app only. The desktop app has no sign-up and is unaffected.

**Self-serve sign-up**

- **FR-025**: The web login page MUST show a **Sign up** link, replacing "Create your shop", whenever self-serve sign-up is available. Self-serve is available when email sending and the human check are both configured.
- **FR-026**: The sign-up page opened without an invite link MUST ask only for an email address and MUST run the Cloudflare Turnstile human check.
- **FR-027**: A request that passes the human check and the limits MUST create an invite marked as self-requested, with the same 72-hour, single-use link and the same email design as an admin invite.
- **FR-028**: Every request that passes the human check MUST get the same response ("If this address can be used, we've emailed a link"). This applies whether the email was sent, the address already has a shop, the per-email limit was hit, or the daily cap was reached, so the form cannot reveal which addresses have shops. The per-visitor IP limit is the one exception. It may answer "Too many requests, please try again later" because that answer does not depend on the email.
- **FR-029**: Self-serve requests MUST be limited per visitor IP (5 per hour) and per email address (3 per hour). There MUST also be a platform-wide daily cap (50 per day by default, configurable). When the daily cap is reached, requests stop sending email and the owner is alerted in the logs.
- **FR-030**: When the human check is not configured, self-serve sign-up MUST be switched off. That means the Sign up link is hidden, and requests are refused. Admin invites keep working.
- **FR-031**: Admin invites MUST be sent and listed from the existing super-admin Tenants page, not from a separate page. The list MUST show whether each invite was sent by an admin or self-requested.

### Key Entities *(include if feature involves data)*

- **Sign-up invite**:
  - Represents a personal invitation to create one shop.
  - Attributes: invited email, source (admin or self-requested), optional shop name hint, the platform admin who sent it (empty when self-requested), expiry time, used time, the shop created from it, revoked time.
  - It belongs to the platform, not to any shop.
- **Queued email**:
  - Represents one email the system has to send.
  - Attributes: unique key, design name, recipient, the values to fill in, state (queued, sending, accepted, failed), number of attempts, next attempt time, last error, provider reference.
  - It belongs to the platform.
  - It is linked to the invite it announces, through the invite's identity in its unique key.
- **Shop (existing)**:
  - Gains a contact email, which is filled from the invite when the shop is created this way.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The owner can invite a new shop in under 1 minute from opening the admin page, without sharing any code by hand.
- **SC-002**: An invited person can go from opening the email to logged in to their new shop in under 3 minutes.
- **SC-003**: 100% of shops created through an invite have a contact email on record.
- **SC-004**: Zero duplicate emails across restart and retry tests. Zero lost emails when the provider has a temporary outage of up to 1 hour.
- **SC-005**: No invite link can be used to create more than one shop. No link works after 72 hours.
- **SC-006**: A test invite email to a major webmail provider lands in the inbox, not spam, and passes all three sender-authentication checks (SPF, DKIM, DMARC).
- **SC-007**: After launch, no path creates a shop without either a valid invite or a platform-admin action.

## Assumptions

- **Self-serve is in scope, protected by Turnstile and rate limits** (FR-025 to FR-030). It ships before or with launch. Owner approval of each new shop (`OPEN_PUBLIC_SIGNUP_PLAN.md` §3.2) is not part of this feature.
- **No email when the address already has a shop.** For now, a self-serve request for an address that already has a shop sends nothing. A "you already have a shop" reminder email is a possible later addition.
- **Owner setup for Turnstile.** The owner creates a Turnstile widget in Cloudflare for `www.liratek.shop` and supplies its site key and secret key.
- **72-hour expiry.** This is a default chosen to cover a weekend. It is not a stated requirement.
- **Mailbox setup is a manual step for the owner.** The owner creates the `mail@liratek.shop` mailbox on Spaceship and adds its DNS records in Cloudflare by hand. DNS stays on Cloudflare, because shop web addresses are created there automatically.
- **Spacemail SMTP is the chosen mail provider.** Whether the server can reach Spacemail's SMTP port must be tested early. If it cannot, a transactional provider such as Resend is the fallback.
- **Single language.** Emails are in English for now; other languages are a later addition.
- **Out of scope:**
  - Password-reset emails. They would need user emails, which do not exist yet.
  - Delivery and bounce tracking beyond "accepted by provider".
  - A welcome email after sign-up (owner decision).
- **Web-only, an exception to Constitution §I** ("one core, two transports"). The owner approved this on 2026-10-07.
- **Shared plan names must match.** The shop contact email field matches the name used in `OPEN_PUBLIC_SIGNUP_PLAN.md` §3.3. `SUBSCRIPTION_MANAGEMENT_PLAN.md` will be updated to use the same field.
