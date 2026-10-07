/**
 * Every email template, by the name stored in `email_outbox.template`.
 */

import type { EmailTemplate } from "../renderTemplate.js";
import { signupInviteTemplate } from "./signupInvite.js";
// One anchor per feature (SELF_SERVE_SIGNUP_AND_GOOGLE_PLAN.md
// "Contracts"); add your import / registry entry under YOUR anchor only.
// [auth-B] imports: userInviteTemplate, verifyEmailTemplate
import { userInviteTemplate } from "./userInvite.js";
import { verifyEmailTemplate } from "./verifyEmail.js";

// [auth-C] imports: passwordResetTemplate
import { passwordResetTemplate } from "./passwordReset.js";

const TEMPLATES: Readonly<Record<string, EmailTemplate>> = {
  [signupInviteTemplate.name]: signupInviteTemplate,
  // [auth-B] entries: "user-invite", "verify-email"
  [userInviteTemplate.name]: userInviteTemplate,
  [verifyEmailTemplate.name]: verifyEmailTemplate,

  // [auth-C] entries: "password-reset"
  [passwordResetTemplate.name]: passwordResetTemplate,
};

/** Throws for an unknown name: a row naming a template that does not exist
 * can never be sent, so the worker fails it rather than retrying. */
export function getEmailTemplate(name: string): EmailTemplate {
  const template = Object.prototype.hasOwnProperty.call(TEMPLATES, name)
    ? TEMPLATES[name]
    : undefined;
  if (!template) throw new Error(`Unknown email template "${name}"`);
  return template;
}

export function listEmailTemplateNames(): string[] {
  return Object.keys(TEMPLATES);
}
