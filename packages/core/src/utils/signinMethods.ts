/**
 * LIRA-291 — the ONE wording for how a user signs in (rule 14), shown in
 * Settings → Users. Pure, no imports: safe for the browser bundle (rule 29).
 *
 * A user's sign-in method is whether they have a usable password
 * (`users.has_password`, v202) plus whether a Google account is connected.
 * "None" is only possible right after an admin disconnected Google from a
 * user with no password (the admin was warned; a set-password link was
 * emailed when possible).
 */
export type SigninMethodLabel =
  | "Password"
  | "Google"
  | "Password + Google"
  | "None";

export function signinMethodLabel(input: {
  hasPassword: boolean;
  google: boolean;
}): SigninMethodLabel {
  if (input.hasPassword && input.google) return "Password + Google";
  if (input.hasPassword) return "Password";
  if (input.google) return "Google";
  return "None";
}
