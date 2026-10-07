/**
 * Account schemas (v196 foundation, SELF_SERVE_SIGNUP_AND_GOOGLE_PLAN.md):
 * user invites, password reset, user email, Google sign-in.
 *
 * Imported through the validators barrel — the same path browser.ts exports,
 * so the frontend and both transports see exactly these definitions.
 */

import {
  createUserInvitationSchema,
  acceptUserInvitationSchema,
  checkUserInvitationSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  checkResetTokenSchema,
  setUserEmailSchema,
  verifyUserEmailSchema,
  googleStartQuerySchema,
  ssoExchangeSchema,
  newPasswordSchema,
} from "../index.js";
import { validatePasswordComplexity } from "../../utils/passwordPolicy.js";

const GOOD_PASSWORD = "Str0ng-Pass!";
const TOKEN = "a".repeat(43);

describe("newPasswordSchema — the user-creation complexity rule, in zod", () => {
  it("accepts exactly what validatePasswordComplexity accepts", () => {
    for (const candidate of [
      GOOD_PASSWORD,
      "short1!A",
      "nouppercase1!",
      "NOLOWERCASE1!",
      "NoNumber!!",
      "NoSpecial123",
      "",
    ]) {
      expect(newPasswordSchema.safeParse(candidate).success).toBe(
        validatePasswordComplexity(candidate).valid,
      );
    }
  });

  it("reports the policy's own messages", () => {
    const result = newPasswordSchema.safeParse("abc");
    expect(result.success).toBe(false);
    const messages = result.success
      ? []
      : result.error.issues.map((i) => i.message);
    expect(messages).toEqual(validatePasswordComplexity("abc").errors);
  });

  it("caps the length", () => {
    expect(newPasswordSchema.safeParse(`Aa1!${"x".repeat(200)}`).success).toBe(
      false,
    );
  });
});

describe("user invitations", () => {
  it("createUserInvitationSchema normalises the email and allows admin|staff only", () => {
    expect(
      createUserInvitationSchema.parse({
        email: " New@Shop.COM ",
        role: "staff",
      }),
    ).toEqual({ email: "new@shop.com", role: "staff" });
    expect(
      createUserInvitationSchema.safeParse({
        email: "a@b.co",
        role: "super_admin",
      }).success,
    ).toBe(false);
    expect(
      createUserInvitationSchema.safeParse({ email: "nope", role: "staff" })
        .success,
    ).toBe(false);
  });

  it("acceptUserInvitationSchema: token + trimmed username (3..100) + strong password", () => {
    expect(
      acceptUserInvitationSchema.parse({
        token: TOKEN,
        username: "  cashier ",
        password: GOOD_PASSWORD,
      }),
    ).toEqual({ token: TOKEN, username: "cashier", password: GOOD_PASSWORD });
    expect(
      acceptUserInvitationSchema.safeParse({
        token: TOKEN,
        username: "ab",
        password: GOOD_PASSWORD,
      }).success,
    ).toBe(false);
    expect(
      acceptUserInvitationSchema.safeParse({
        token: TOKEN,
        username: "cashier",
        password: "weak",
      }).success,
    ).toBe(false);
  });

  it("checkUserInvitationSchema: a non-empty token of at most 200", () => {
    expect(checkUserInvitationSchema.safeParse({ token: TOKEN }).success).toBe(
      true,
    );
    expect(checkUserInvitationSchema.safeParse({ token: "" }).success).toBe(
      false,
    );
    expect(
      checkUserInvitationSchema.safeParse({ token: "x".repeat(201) }).success,
    ).toBe(false);
  });
});

describe("password reset", () => {
  it("forgotPasswordSchema: email, optional shop address validated as a slug", () => {
    expect(forgotPasswordSchema.parse({ email: " A@B.CO " })).toEqual({
      email: "a@b.co",
    });
    expect(
      forgotPasswordSchema.parse({ email: "a@b.co", shop: "corner-shop" }),
    ).toEqual({
      email: "a@b.co",
      shop: "corner-shop",
    });
    expect(
      forgotPasswordSchema.safeParse({ email: "a@b.co", shop: "Bad Slug!" })
        .success,
    ).toBe(false);
  });

  it("resetPasswordSchema: token + strong password", () => {
    expect(
      resetPasswordSchema.safeParse({ token: TOKEN, password: GOOD_PASSWORD })
        .success,
    ).toBe(true);
    expect(
      resetPasswordSchema.safeParse({ token: TOKEN, password: "weak" }).success,
    ).toBe(false);
    expect(
      resetPasswordSchema.safeParse({ token: "", password: GOOD_PASSWORD })
        .success,
    ).toBe(false);
  });

  it("checkResetTokenSchema: a non-empty token", () => {
    expect(checkResetTokenSchema.safeParse({ token: TOKEN }).success).toBe(
      true,
    );
    expect(checkResetTokenSchema.safeParse({}).success).toBe(false);
  });
});

describe("user email", () => {
  it("setUserEmailSchema: an email (normalised) or null to clear it", () => {
    expect(setUserEmailSchema.parse({ email: " Me@Shop.com" })).toEqual({
      email: "me@shop.com",
    });
    expect(setUserEmailSchema.parse({ email: null })).toEqual({ email: null });
    expect(setUserEmailSchema.safeParse({ email: "nope" }).success).toBe(false);
    expect(setUserEmailSchema.safeParse({}).success).toBe(false);
  });

  it("verifyUserEmailSchema: a non-empty token", () => {
    expect(verifyUserEmailSchema.safeParse({ token: TOKEN }).success).toBe(
      true,
    );
    expect(verifyUserEmailSchema.safeParse({ token: "" }).success).toBe(false);
  });
});

describe("Google sign-in", () => {
  it("googleStartQuerySchema: intent login|signup|link, optional shop slug", () => {
    expect(
      googleStartQuerySchema.parse({ intent: "login", shop: "corner-shop" }),
    ).toEqual({
      intent: "login",
      shop: "corner-shop",
    });
    expect(googleStartQuerySchema.parse({ intent: "signup" })).toEqual({
      intent: "signup",
    });
    expect(googleStartQuerySchema.safeParse({ intent: "steal" }).success).toBe(
      false,
    );
    expect(
      googleStartQuerySchema.safeParse({ intent: "login", shop: "../x" })
        .success,
    ).toBe(false);
  });

  it("ssoExchangeSchema: a non-empty token", () => {
    expect(ssoExchangeSchema.safeParse({ token: TOKEN }).success).toBe(true);
    expect(ssoExchangeSchema.safeParse({ token: "" }).success).toBe(false);
  });
});
