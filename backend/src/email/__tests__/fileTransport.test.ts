/**
 * The `file` transport (LIRA-267, T016): dev, local preview and the web e2e
 * read emails from disk, so the file names and contents are a contract —
 * the e2e polls for `signup-invite-*.json` and reads the link from the
 * `.html`.
 *
 * Real filesystem in a fresh temp directory per test.
 */

import { jest } from "@jest/globals";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createFileTransport } from "../transports/file.js";
import type { EmailMessage } from "../EmailTransport.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "liratek-file-transport-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const MESSAGE: EmailMessage = {
  to: "owner@example.com",
  from: "LiraTek <mail@liratek.test>",
  replyTo: "help@liratek.test",
  subject: "You're invited to open your shop on LiraTek",
  html: '<a href="https://www.liratek.test/signup?invite=abc">Open</a>',
  text: "Open https://www.liratek.test/signup?invite=abc",
  tag: { template: "signup-invite", outboxId: 42, idempotencyKey: "signup-invite:7" },
};

describe("file transport", () => {
  it("writes <template>-<outboxId>.html, .txt and .json and returns file:<path>", async () => {
    const transport = createFileTransport(dir);

    const result = await transport.send(MESSAGE);

    const base = path.join(dir, "signup-invite-42");
    expect(fs.readFileSync(`${base}.html`, "utf8")).toBe(MESSAGE.html);
    expect(fs.readFileSync(`${base}.txt`, "utf8")).toBe(MESSAGE.text);
    expect(JSON.parse(fs.readFileSync(`${base}.json`, "utf8"))).toEqual({
      subject: MESSAGE.subject,
      to: MESSAGE.to,
      from: MESSAGE.from,
      replyTo: MESSAGE.replyTo,
      idempotencyKey: "signup-invite:7",
    });
    expect(result.providerMessageId).toBe(`file:${base}.json`);
    expect(transport.name).toBe("file");
  });

  it("creates the directory when it does not exist yet", async () => {
    const nested = path.join(dir, "a", "b");
    await createFileTransport(nested).send(MESSAGE);
    expect(fs.existsSync(path.join(nested, "signup-invite-42.json"))).toBe(true);
  });

  it("writes the .json LAST, so a poller that sees it can read the .html", async () => {
    const order: string[] = [];
    const spy = jest
      .spyOn(fs.promises, "writeFile")
      .mockImplementation(async (file) => {
        order.push(path.extname(String(file)));
      });
    await createFileTransport(dir).send(MESSAGE);
    spy.mockRestore();
    expect(order[order.length - 1]).toBe(".json");
  });
});
