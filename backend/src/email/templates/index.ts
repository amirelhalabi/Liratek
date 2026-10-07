/**
 * Every email template, by the name stored in `email_outbox.template`.
 */

import type { EmailTemplate } from "../renderTemplate.js";
import { signupInviteTemplate } from "./signupInvite.js";

const TEMPLATES: Readonly<Record<string, EmailTemplate>> = {
  [signupInviteTemplate.name]: signupInviteTemplate,
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
