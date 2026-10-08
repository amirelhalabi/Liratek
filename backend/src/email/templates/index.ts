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

// LIRA-287: www "email me a code" sign-in
import { signinCodeTemplate } from "./signinCode.js";

// LIRA-291: sign-in methods ("password added" notice, "set a password" link)
import { passwordAddedTemplate } from "./passwordAdded.js";
import { passwordSetTemplate } from "./passwordSet.js";

const TEMPLATES: Readonly<Record<string, EmailTemplate>> = {
  [signupInviteTemplate.name]: signupInviteTemplate,
  // [auth-B] entries: "user-invite", "verify-email"
  [userInviteTemplate.name]: userInviteTemplate,
  [verifyEmailTemplate.name]: verifyEmailTemplate,

  // [auth-C] entries: "password-reset"
  [passwordResetTemplate.name]: passwordResetTemplate,

  // LIRA-287: "signin-code"
  [signinCodeTemplate.name]: signinCodeTemplate,

  // LIRA-291: "password-added", "password-set"
  [passwordAddedTemplate.name]: passwordAddedTemplate,
  [passwordSetTemplate.name]: passwordSetTemplate,
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

/**
 * Every `data` key any template declares as a secret link, derived from the
 * registry so a new template is covered by declaring its `secretKeys`. The
 * worker scrubs the whole set from every final row: removing a key a row
 * does not have is a no-op, and a row whose template is unknown still loses
 * any link it carries.
 */
export function listEmailSecretDataKeys(): string[] {
  const keys = new Set<string>();
  for (const template of Object.values(TEMPLATES)) {
    for (const key of template.secretKeys) keys.add(key);
  }
  return [...keys];
}
