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
  it("normalises the email; the Turnstile token is OPTIONAL (LIRA-278) but never empty", () => {
    expect(
      requestSignupLinkSchema.parse({ email: " A@B.CO ", turnstileToken: "t" }),
    ).toEqual({ email: "a@b.co", turnstileToken: "t" });
    expect(requestSignupLinkSchema.parse({ email: "a@b.co" })).toEqual({
      email: "a@b.co",
    });
    expect(
      requestSignupLinkSchema.safeParse({ email: "a@b.co", turnstileToken: "" }).success,
    ).toBe(false);
  });

  it("accepts a shop-name hint (trimmed, at most 100) and the anti-bot fields", () => {
    expect(
      requestSignupLinkSchema.parse({
        email: "a@b.co",
        shopNameHint: "  Corner Shop ",
        website: "",
        formElapsedMs: 4200,
      }),
    ).toEqual({
      email: "a@b.co",
      shopNameHint: "Corner Shop",
      website: "",
      formElapsedMs: 4200,
    });
    expect(
      requestSignupLinkSchema.safeParse({
        email: "a@b.co",
        shopNameHint: "x".repeat(101),
      }).success,
    ).toBe(false);
  });

  it("a filled honeypot still PARSES — the route must answer it silently, not with a 400", () => {
    expect(
      requestSignupLinkSchema.safeParse({
        email: "a@b.co",
        website: "http://spam.example",
      }).success,
    ).toBe(true);
    expect(
      requestSignupLinkSchema.safeParse({ email: "a@b.co", website: "x".repeat(201) })
        .success,
    ).toBe(false);
  });

  it("formElapsedMs (time on the form, measured on ONE clock — the browser's) is a non-negative integer, at most a day", () => {
    // Not an epoch timestamp: comparing a browser timestamp with the
    // server's clock would make clock skew silently drop real people
    // (rule 27).
    expect(
      requestSignupLinkSchema.safeParse({ email: "a@b.co", formElapsedMs: -1 }).success,
    ).toBe(false);
    expect(
      requestSignupLinkSchema.safeParse({ email: "a@b.co", formElapsedMs: "123" })
        .success,
    ).toBe(false);
    expect(
      requestSignupLinkSchema.safeParse({ email: "a@b.co", formElapsedMs: 86_400_001 })
        .success,
    ).toBe(false);
    expect(
      requestSignupLinkSchema.parse({ email: "a@b.co", formStartedAt: 1 }),
    ).toEqual({ email: "a@b.co" });
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
