/**
 * `file` transport (LIRA-267, research R6): writes each email to disk instead
 * of sending it. Used for local development, the preview script and the web
 * e2e, which polls the directory and reads the invite link from the `.html`.
 *
 * Per message, in `dir`:
 *   <template>-<outboxId>.html   the HTML body
 *   <template>-<outboxId>.txt    the text body
 *   <template>-<outboxId>.json   { subject, to, from, replyTo, idempotencyKey }
 *
 * The `.json` is written LAST: a poller that waits for it can rely on the
 * other two already being complete.
 */

import fs from "node:fs";
import path from "node:path";
import type {
  EmailMessage,
  EmailSendResult,
  EmailTransport,
} from "../EmailTransport.js";

export function createFileTransport(dir: string): EmailTransport {
  return {
    name: "file",
    async send(message: EmailMessage): Promise<EmailSendResult> {
      await fs.promises.mkdir(dir, { recursive: true });
      const base = path.join(
        dir,
        `${message.tag.template}-${message.tag.outboxId}`,
      );
      await fs.promises.writeFile(`${base}.html`, message.html, "utf8");
      await fs.promises.writeFile(`${base}.txt`, message.text, "utf8");
      await fs.promises.writeFile(
        `${base}.json`,
        JSON.stringify(
          {
            subject: message.subject,
            to: message.to,
            from: message.from,
            replyTo: message.replyTo ?? null,
            idempotencyKey: message.tag.idempotencyKey,
          },
          null,
          2,
        ),
        "utf8",
      );
      return { providerMessageId: `file:${base}.json` };
    },
  };
}
