import { z } from "zod";

/**
 * Authentication validation schemas
 */

export const loginSchema = z.object({
  username: z.string().min(1, "Username is required").max(100),
  password: z.string().min(1, "Password is required"),
  rememberMe: z.boolean().default(false),
});

// LIRA-293: the old `changePasswordSchema` (min 6 characters, never wired)
// is retired. Changing your own password uses `changeOwnPasswordSchema` in
// validators/account.ts, which applies the ONE password rule.

export type LoginInput = z.infer<typeof loginSchema>;
