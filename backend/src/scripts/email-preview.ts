#!/usr/bin/env node
/**
 * `yarn workspace @liratek/backend email:preview [template]` (LIRA-267, T039).
 *
 * Renders an email template with built-in sample data (including a hostile
 * shop name, to show the escaping) into <tmpdir>/liratek-email-preview/,
 * prints the file paths, and opens the HTML. Sends nothing. Defaults to every
 * template when no name is given.
 *
 * Writes with process.stdout/stderr, never console.log (backend lint).
 */

import { openPreview, writeEmailPreview } from "../email/preview.js";
import { listEmailTemplateNames } from "../email/templates/index.js";

function main(): number {
  const requested = process.argv[2];
  const names = requested ? [requested] : listEmailTemplateNames();
  try {
    for (const name of names) {
      const files = writeEmailPreview(name);
      process.stdout.write(
        `${name}: "${files.subject}"\n  ${files.htmlPath}\n  ${files.textPath}\n`,
      );
      openPreview(files.htmlPath);
    }
    return 0;
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
}

process.exitCode = main();
