/**
 * LIRA-267 — sign-up invitation schemas, the Stage B `signupSchema` (an
 * emailed `inviteToken` is REQUIRED; the shared `inviteCode` is gone) plus the
 * optional `contactEmail` on the admin `createTenantSchema`.
 */

import {
  createSignupInvitationSchema,
  checkSignupInviteSchema,
  requestSignupLinkSchema,
  signupSchema,
  createTenantSchema,
  SIGNUP_INVITE_REQUIRED_MESSAGE,
} from "../index.js";

const BASE_SIGNUP = {
  name: "Corner Shop",
  slug: "corner-shop",
  adminUsername: "owner",
  adminPassword: "Str0ng-Password!",
};

const INVITE_REQUIRED = SIGNUP_INVITE_REQUIRED_MESSAGE;

function issueMessages(result: {
  success: boolean;
  error?: { issues: { message: string }[] };
}): string[] {
  return result.success ? [] : (result.error?.issues ?? []).map((i) => i.message);
}

describe("createSignupInvitationSchema", () => {
  it("trims and lowercases the email", () => {
    const parsed = createSignupInvitationSchema.parse({
      email: "  Owner@Example.COM ",
      shopNameHint: "  Corner Shop  ",
    });
    expect(parsed).toEqual({
      email: "owner@example.com",
      shopNameHint: "Corner Shop",
    });
  });

  it("rejects a non-email and an over-long hint", () => {
    expect(createSignupInvitationSchema.safeParse({ email: "nope" }).success).toBe(false);
    expect(
      createSignupInvitationSchema.safeParse({
        email: "a@b.co",
        shopNameHint: "x".repeat(101),
      }).success,
    ).toBe(false);
  });

  it("rejects an email longer than 254 characters", () => {
    const long = `${"a".repeat(250)}@b.co`;
    expect(createSignupInvitationSchema.safeParse({ email: long }).success).toBe(false);
  });
});

describe("checkSignupInviteSchema", () => {
  it("requires a non-empty token of at most 200 chars", () => {
    expect(checkSignupInviteSchema.safeParse({ token: "abc" }).success).toBe(true);
    expect(checkSignupInviteSchema.safeParse({ token: "" }).success).toBe(false);
    expect(checkSignupInviteSchema.safeParse({ token: "x".repeat(201) }).success).toBe(false);
  });
});

describe("requestSignupLinkSchema", () => {
  it("normalises the email and requires a Turnstile token", () => {
    expect(
      requestSignupLinkSchema.parse({ email: " A@B.CO ", turnstileToken: "t" }),
    ).toEqual({ email: "a@b.co", turnstileToken: "t" });
    expect(requestSignupLinkSchema.safeParse({ email: "a@b.co" }).success).toBe(false);
    expect(
      requestSignupLinkSchema.safeParse({ email: "a@b.co", turnstileToken: "" }).success,
    ).toBe(false);
  });
});

describe("signupSchema — Stage B: an invite token is required, the shared code is gone", () => {
  it("accepts an invite token alone", () => {
    expect(signupSchema.safeParse({ ...BASE_SIGNUP, inviteToken: "tok" }).success).toBe(true);
  });

  // Rule 24: these were the Stage A "invite code alone is accepted" tests,
  // rewritten into guards that the shared-code path cannot come back.
  it("REFUSES an invite code alone — the shared-code path is gone", () => {
    const result = signupSchema.safeParse({ ...BASE_SIGNUP, inviteCode: "let-me-in" });
    expect(result.success).toBe(false);
    expect(issueMessages(result)).toContain(INVITE_REQUIRED);
  });

  it("ignores (strips) an invite code sent beside a token", () => {
    const parsed = signupSchema.parse({
      ...BASE_SIGNUP,
      inviteCode: "let-me-in",
      inviteToken: "tok",
    });
    expect(parsed).not.toHaveProperty("inviteCode");
    expect(parsed.inviteToken).toBe("tok");
  });

  it("has no inviteCode key in its shape at all", () => {
    expect(Object.keys(signupSchema.shape)).not.toContain("inviteCode");
  });

  it("rejects a body with no token", () => {
    const result = signupSchema.safeParse(BASE_SIGNUP);
    expect(result.success).toBe(false);
    expect(issueMessages(result)).toContain(INVITE_REQUIRED);
  });

  it("does not count an empty token as present", () => {
    expect(signupSchema.safeParse({ ...BASE_SIGNUP, inviteToken: "" }).success).toBe(false);
  });

  it("strips any client-sent contactEmail — the server takes it from the invite", () => {
    const parsed = signupSchema.parse({
      ...BASE_SIGNUP,
      inviteToken: "tok",
      contactEmail: "attacker@example.com",
    });
    expect(parsed).not.toHaveProperty("contactEmail");
  });
});

describe("createTenantSchema.contactEmail (admin create)", () => {
  it("is optional", () => {
    expect(createTenantSchema.safeParse(BASE_SIGNUP).success).toBe(true);
  });

  it("is trimmed and lowercased when present", () => {
    const parsed = createTenantSchema.parse({
      ...BASE_SIGNUP,
      contactEmail: "  Owner@Example.COM ",
    });
    expect(parsed.contactEmail).toBe("owner@example.com");
  });

  it("rejects an invalid email", () => {
    expect(
      createTenantSchema.safeParse({ ...BASE_SIGNUP, contactEmail: "nope" }).success,
    ).toBe(false);
  });
});
