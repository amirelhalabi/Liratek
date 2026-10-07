/**
 * Local email preview (LIRA-267, T039, research R7).
 *
 * Renders a template with built-in sample data into
 * `<tmpdir>/liratek-email-preview/<name>.html` and `.txt`, so a template
 * change can be looked at in a browser without sending anything. The logic
 * is here (importable, tested); `scripts/email-preview.ts` only runs it.
 *
 * The sample shop name is deliberately hostile, so the preview itself shows
 * the escaping at work.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderTemplate, type TemplateVars } from "./renderTemplate.js";
import { getEmailTemplate, listEmailTemplateNames } from "./templates/index.js";

export interface EmailPreviewFiles {
  subject: string;
  htmlPath: string;
  textPath: string;
}

/** Starts a viewer for a file. Injected so tests never open a browser. */
export type PreviewSpawner = (command: string, args: string[]) => void;

/** Built-in sample data, one entry per template name. */
export const EMAIL_PREVIEW_SAMPLES: Readonly<Record<string, TemplateVars>> = {
  "signup-invite": {
    inviteUrl:
      "https://www.liratek.shop/#/signup?invite=PREVIEW_ONLY_not_a_real_token_0123456789",
    shopNameHint: `Cell City <script>alert("hi")</script> & Sons`,
    expiresAtText: "10 October 2026, 09:00 UTC",
    supportEmail: "support@liratek.shop",
  },
};

export function defaultPreviewDir(): string {
  return path.join(os.tmpdir(), "liratek-email-preview");
}

export function writeEmailPreview(
  name: string,
  dir: string = defaultPreviewDir(),
): EmailPreviewFiles {
  const sample = Object.prototype.hasOwnProperty.call(EMAIL_PREVIEW_SAMPLES, name)
    ? EMAIL_PREVIEW_SAMPLES[name]
    : undefined;
  if (!sample) {
    throw new Error(
      `No email template "${name}". Known: ${listEmailTemplateNames().join(", ")}`,
    );
  }
  const rendered = renderTemplate(getEmailTemplate(name), sample);

  fs.mkdirSync(dir, { recursive: true });
  const htmlPath = path.join(dir, `${name}.html`);
  const textPath = path.join(dir, `${name}.txt`);
  fs.writeFileSync(htmlPath, rendered.html, "utf8");
  fs.writeFileSync(
    textPath,
    `Subject: ${rendered.subject}\n\n${rendered.text}`,
    "utf8",
  );
  return { subject: rendered.subject, htmlPath, textPath };
}

function defaultSpawner(command: string, args: string[]): void {
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  // A missing opener (no desktop, no xdg-open) is not an error here.
  child.on("error", () => undefined);
  child.unref();
}

/** Opens the file with `open` (macOS) or `xdg-open`; failures are ignored —
 * the paths are printed anyway. */
export function openPreview(
  filePath: string,
  platform: NodeJS.Platform = process.platform,
  spawner: PreviewSpawner = defaultSpawner,
): void {
  const command = platform === "darwin" ? "open" : "xdg-open";
  try {
    spawner(command, [filePath]);
  } catch {
    // Ignored on purpose: the preview files exist either way.
  }
}
