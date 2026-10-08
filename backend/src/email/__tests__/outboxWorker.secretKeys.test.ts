/**
 * Every emailed link is a bearer secret (an invite, a password reset, an
 * email verification). Once a row reaches a final status the worker must
 * remove it from `email_outbox.data_json`, for EVERY template — not only the
 * LIRA-267 sign-up invite the worker was first written for.
 *
 * Iterates the template registry with the preview samples, so a template
 * added later is covered without editing this file (preview.test.ts already
 * fails a template that has no sample).
 */

import fs from "node:fs";
import path from "node:path";
import type DatabaseCtor from "better-sqlite3";
import { EmailOutboxRepository } from "@liratek/core";
import { runOutboxOnce, type OutboxWorkerDeps } from "../outboxWorker.js";
import { FakeEmailTransport } from "../transports/fake.js";
import { PermanentEmailError } from "../EmailTransport.js";
import { EMAIL_PREVIEW_SAMPLES } from "../preview.js";
import { getEmailTemplate, listEmailTemplateNames } from "../templates/index.js";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const RealDatabase =
  require("better-sqlite3/lib/index.js") as typeof DatabaseCtor;

const T0 = "2026-10-07T10:00:00.000Z";
const GIVE_UP = "2026-10-10T10:00:00.000Z";
/** Every preview sample's link carries this in place of a real token. */
const TOKEN_MARKER = "PREVIEW_ONLY_not_a_real_token";

let db: InstanceType<typeof DatabaseCtor>;
let outbox: EmailOutboxRepository;
let transport: FakeEmailTransport;

beforeEach(() => {
  db = new RealDatabase(":memory:");
  db.exec(
    fs.readFileSync(
      path.join(__dirname, "../../../../electron-app/create_db.sql"),
      "utf8",
    ),
  );
  (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  outbox = new EmailOutboxRepository();
  transport = new FakeEmailTransport();
});

afterEach(() => {
  db.close();
});

function deps(): OutboxWorkerDeps {
  return {
    outbox,
    transport,
    from: "LiraTek <mail@liratek.test>",
    sleep: async () => {},
    secrets: [],
  };
}

function enqueue(template: string) {
  const data = EMAIL_PREVIEW_SAMPLES[template]!;
  return outbox.enqueue({
    idempotencyKey: `${template}:1`,
    template,
    toEmail: "someone@example.com",
    data,
    now: T0,
    giveUpAt: GIVE_UP,
  });
}

// LIRA-291: a notice with no link (`password-added`) declares
// `secretKeys: []` and is exempt — but it must then carry no secret at all.
const allNames = listEmailTemplateNames();
const names = allNames.filter((n) => getEmailTemplate(n).secretKeys.length > 0);
const linkless = allNames.filter((n) => getEmailTemplate(n).secretKeys.length === 0);

describe("outbox worker scrubs every template's link", () => {
  it("covers every registered template", () => {
    expect(names).toEqual(
      expect.arrayContaining([
        "signup-invite",
        "user-invite",
        "verify-email",
        "password-reset",
      ]),
    );
    for (const name of names) {
      expect(JSON.stringify(EMAIL_PREVIEW_SAMPLES[name])).toContain(TOKEN_MARKER);
    }
  });

  it("a template that declares no secret keys carries no link in its sample", () => {
    for (const name of linkless) {
      const sample = JSON.stringify(EMAIL_PREVIEW_SAMPLES[name]);
      expect(sample).not.toContain(TOKEN_MARKER);
      expect(sample).not.toMatch(/https?:\/\//);
    }
  });

  it.each(names)("%s: the link is gone after the email is accepted", async (name) => {
    const row = enqueue(name);
    await runOutboxOnce(T0, deps());
    const after = outbox.findById(row.id)!;
    expect(after.status).toBe("accepted");
    expect(after.data_json).not.toContain(TOKEN_MARKER);
  });

  it.each(names)("%s: the link is gone after the email fails", async (name) => {
    const row = enqueue(name);
    transport.scriptOutcomes(new PermanentEmailError("mailbox does not exist"));
    await runOutboxOnce(T0, deps());
    const after = outbox.findById(row.id)!;
    expect(after.status).toBe("failed");
    expect(after.data_json).not.toContain(TOKEN_MARKER);
  });
});
