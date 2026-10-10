import { z } from "zod";
import { signupEmailSchema } from "./signupInvitation.js";

/**
 * Phone app sign-in (LIRA-289, contracts/mobile-api.md). Browser-safe (zod
 * only), shared by the backend route and the Expo app's request types.
 *
 * `shop` is deliberately NOT checked with the tenant-slug rules: an unknown or
 * malformed shop must get the same generic refusal as a wrong password
 * (FR-028), not a validation error that says "this is not a shop".
 */
const shopAddressSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Enter your shop address.")
  .max(63);

const deviceNameSchema = z.string().trim().max(100).optional();

export const mobileLoginSchema = z.object({
  shop: shopAddressSchema,
  username: z.string().trim().min(1, "Enter your username."),
  password: z.string().min(1, "Enter your password."),
  deviceName: deviceNameSchema,
});

export const mobileGoogleSchema = z.object({
  idToken: z.string().min(1),
  nonce: z.string().min(1),
  deviceName: deviceNameSchema,
});

export const mobileSignupLinkSchema = z.object({
  email: signupEmailSchema,
});

export type MobileLoginInput = z.input<typeof mobileLoginSchema>;
export type MobileGoogleInput = z.input<typeof mobileGoogleSchema>;
export type MobileSignupLinkInput = z.input<typeof mobileSignupLinkSchema>;

/** Refusal codes the phone shows a message for (contracts/mobile-api.md). */
export const MOBILE_AUTH_ERRORS = [
  "INVALID_CREDENTIALS",
  "ADMIN_ONLY",
  "GOOGLE_NOT_CONNECTED",
  "MULTIPLE_SHOPS",
  "INVALID_GOOGLE_TOKEN",
] as const;
export type MobileAuthError = (typeof MOBILE_AUTH_ERRORS)[number];
