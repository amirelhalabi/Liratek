/**
 * A deliberately tiny template renderer (LIRA-267, research R7).
 *
 *   {{var}}                 substituted; HTML-escaped in `html` (quotes
 *                           included, so it is safe inside an attribute);
 *                           verbatim in `subject` and `text`.
 *   {{#if var}}…{{/if}}     the block is kept only when `var` is non-empty
 *                           (not undefined, null, "" or false). Not nestable.
 *
 * Nothing else exists: no raw `{{{var}}}`, no loops, no partials. Anything
 * that looks like a tag but is not one of the two forms throws, and so does a
 * referenced variable that is missing or null. Failing loudly is the point —
 * a silently blank link in an invite email is the worst outcome.
 */

export interface EmailTemplate {
  name: string;
  subject: string;
  html: string;
  text: string;
}

export type TemplateValue = string | number | boolean | null | undefined;
export type TemplateVars = Record<string, TemplateValue>;

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const IF_BLOCK = /\{\{#if\s+([A-Za-z0-9_]+)\s*\}\}([\s\S]*?)\{\{\/if\}\}/g;
const VARIABLE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]!);
}

function isPresent(value: TemplateValue): boolean {
  return value !== undefined && value !== null && value !== "" && value !== false;
}

function renderPart(
  source: string,
  vars: TemplateVars,
  escape: boolean,
  where: string,
): string {
  if (source.includes("{{{")) {
    throw new Error(`Template ${where}: raw {{{…}}} output is not supported`);
  }
  const withBlocks = source.replace(IF_BLOCK, (_m, name: string, body: string) =>
    isPresent(vars[name]) ? body : "",
  );
  const substituted = withBlocks.replace(VARIABLE, (_m, name: string) => {
    const value = vars[name];
    if (value === undefined || value === null) {
      throw new Error(`Template ${where}: variable "${name}" is missing`);
    }
    const text = String(value);
    return escape ? escapeHtml(text) : text;
  });
  // Substituted VALUES may legitimately contain "{{" (they are data), so the
  // leftover check runs on the template with values blanked, not the output.
  const leftover = withBlocks.replace(VARIABLE, "");
  if (leftover.includes("{{") || leftover.includes("}}")) {
    throw new Error(`Template ${where}: unsupported tag`);
  }
  return substituted;
}

export function renderTemplate(
  template: EmailTemplate,
  vars: TemplateVars,
): RenderedEmail {
  return {
    subject: renderPart(template.subject, vars, false, `${template.name}.subject`),
    html: renderPart(template.html, vars, true, `${template.name}.html`),
    text: renderPart(template.text, vars, false, `${template.name}.text`),
  };
}
