import { z } from "zod";
import { signupEmailSchema } from "./signupInvitation.js";
import { SIGNIN_CODE_LENGTH } from "../constants/signinCode.js";

/**
 * "Email me a code" on www (LIRA-287). Browser-safe (zod + a leaf constants
 * module): exported from `index.ts` (validators barrel) and `browser.ts`.
 * The email is trimmed + lowercased at the edge (signupEmailSchema).
 */
export const requestSigninCodeSchema = z.object({
  email: signupEmailSchema,
});

const CODE_PATTERN = new RegExp(`^\\d{${SIGNIN_CODE_LENGTH}}$`);

export const verifySigninCodeSchema = z.object({
  email: signupEmailSchema,
  // Spaces people type or paste between digit groups are dropped first.
  code: z
    .string()
    .transform((value) => value.replace(/\s+/g, ""))
    .pipe(
      z
        .string()
        .regex(CODE_PATTERN, `Enter the ${SIGNIN_CODE_LENGTH}-digit code.`),
    ),
});

export type RequestSigninCodeInput = z.input<typeof requestSigninCodeSchema>;
export type VerifySigninCodeInput = z.input<typeof verifySigninCodeSchema>;
