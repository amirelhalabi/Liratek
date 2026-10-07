/**
 * The email outbox worker (LIRA-267, T024 — the basic path).
 *
 * Real SQLite (the `better-sqlite3/lib/index.js` subpath escapes the
 * moduleNameMapper mock, as wp5_wp6 does) over the real create_db.sql: the
 * send-once guarantee lives in the repository's conditional UPDATEs, which a
 * mock would not exercise. The transport is the scriptable fake; the clock
 * is a fixed ISO string passed in.
 *
 * US3 (T036/T037) extends this file with the two-attempt rounds, crash
 * recovery and secret redaction. The error cases here pin only the minimal
 * safe behaviour the basic worker needs so that no row is ever left stuck in
 * `sending`.
 */

import { jest } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";
import type DatabaseCtor from "better-sqlite3";
import {
  EmailOutboxRepository,
  SIGNUP_INVITE_TEMPLATE,
  SIGNUP_INVITE_URL_KEY,
  type EmailOutboxEntity,
} from "@liratek/core";
import { runOutboxOnce } from "../outboxWorker.js";
import { FakeEmailTransport } from "../transports/fake.js";
import {
  PermanentEmailError,
  TransientEmailError,
} from "../EmailTransport.js";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const RealDatabase =
  require("better-sqlite3/lib/index.js") as typeof DatabaseCtor;

const T0 = "2026-10-07T10:00:00.000Z";
const GIVE_UP = "2026-10-10T10:00:00.000Z";
const URL = "https://www.liratek.test/signup?invite=secret-token";
const TEN_MIN_MS = 10 * 60 * 1000;

function plus(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString();
}

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

function enqueue(
  overrides: Partial<{ key: string; giveUpAt: string; template: string }> = {},
): EmailOutboxEntity {
  return outbox.enqueue({
    idempotencyKey: overrides.key ?? "signup-invite:1",
    template: overrides.template ?? SIGNUP_INVITE_TEMPLATE,
    toEmail: "owner@example.com",
    data: {
      [SIGNUP_INVITE_URL_KEY]: URL,
      shopNameHint: "Cell City",
      expiresAtText: "10 October 2026, 10:00 UTC",
      supportEmail: "help@liratek.test",
    },
    now: T0,
    giveUpAt: overrides.giveUpAt ?? GIVE_UP,
  });
}

function deps() {
  return {
    outbox,
    transport,
    from: "LiraTek <mail@liratek.test>",
    replyTo: "help@liratek.test",
  };
}

function reload(id: number): EmailOutboxEntity {
  return outbox.findById(id)!;
}

describe("runOutboxOnce — basic path", () => {
  it("claims a due row, renders it, sends it once, marks it accepted and scrubs the link", async () => {
    const row = enqueue();

    const summary = await runOutboxOnce(T0, deps());

    expect(transport.sent).toHaveLength(1);
    const message = transport.sent[0]!;
    expect(message.to).toBe("owner@example.com");
    expect(message.from).toBe("LiraTek <mail@liratek.test>");
    expect(message.replyTo).toBe("help@liratek.test");
    expect(message.subject).toBe("You're invited to open your shop on LiraTek");
    expect(message.html).toContain(URL);
    expect(message.text).toContain(URL);
    expect(message.tag).toEqual({
      template: SIGNUP_INVITE_TEMPLATE,
      outboxId: row.id,
      idempotencyKey: "signup-invite:1",
    });

    const after = reload(row.id);
    expect(after.status).toBe("accepted");
    expect(after.attempts).toBe(1);
    expect(after.provider_message_id).toBe("fake-1");
    expect(after.sent_at).toBe(T0);
    expect(after.locked_at).toBeNull();
    const data = JSON.parse(after.data_json) as Record<string, unknown>;
    expect(data).not.toHaveProperty(SIGNUP_INVITE_URL_KEY);
    expect(after.data_json).not.toContain("secret-token");
    expect(summary).toMatchObject({ accepted: 1, retried: 0, failed: 0 });
  });

  it("does not send a row that is not due yet, nor one already accepted", async () => {
    const row = enqueue();
    await runOutboxOnce(plus(T0, -1000), deps());
    expect(transport.calls).toBe(0);

    await runOutboxOnce(T0, deps());
    await runOutboxOnce(plus(T0, 60_000), deps());
    expect(transport.calls).toBe(1);
    expect(reload(row.id).status).toBe("accepted");
  });

  it("two overlapping runs send a row once", async () => {
    enqueue();
    await Promise.all([runOutboxOnce(T0, deps()), runOutboxOnce(T0, deps())]);
    expect(transport.sent).toHaveLength(1);
  });

  it("handles up to 20 rows per run", async () => {
    for (let i = 0; i < 25; i += 1) enqueue({ key: `k-${i}` });
    await runOutboxOnce(T0, deps());
    expect(transport.sent).toHaveLength(20);
    await runOutboxOnce(T0, deps());
    expect(transport.sent).toHaveLength(25);
  });
});

describe("runOutboxOnce — no row is left in 'sending' (minimal error branch)", () => {
  it("a permanent error fails the row and scrubs the link", async () => {
    const row = enqueue();
    transport.scriptOutcomes(new PermanentEmailError("mailbox does not exist"));

    await runOutboxOnce(T0, deps());

    const after = reload(row.id);
    expect(after.status).toBe("failed");
    expect(after.last_error).toContain("mailbox does not exist");
    expect(after.data_json).not.toContain("secret-token");
  });

  it("a transient error returns the row to pending, due again in 10 minutes", async () => {
    const row = enqueue();
    transport.scriptOutcomes(new TransientEmailError("connection reset"));

    await runOutboxOnce(T0, deps());

    const after = reload(row.id);
    expect(after.status).toBe("pending");
    expect(after.next_attempt_at).toBe(plus(T0, TEN_MIN_MS));
    expect(after.last_error).toContain("connection reset");
    // The link must survive: the retry re-renders the email from it.
    expect(after.data_json).toContain("secret-token");
  });

  it("a transient error whose retry would land at or after give_up_at fails the row", async () => {
    const row = enqueue({ giveUpAt: plus(T0, TEN_MIN_MS) });
    transport.scriptOutcomes(new TransientEmailError("timeout"));

    await runOutboxOnce(T0, deps());

    expect(reload(row.id).status).toBe("failed");
    expect(reload(row.id).data_json).not.toContain("secret-token");
  });

  it("a row already past give_up_at is failed without being sent", async () => {
    const row = enqueue({ giveUpAt: plus(T0, 1000) });

    await runOutboxOnce(plus(T0, 2000), deps());

    expect(transport.calls).toBe(0);
    expect(reload(row.id).status).toBe("failed");
    expect(reload(row.id).data_json).not.toContain("secret-token");
  });

  it("a row naming an unknown template is failed, not retried", async () => {
    const row = enqueue({ template: "no-such-template" });
    await runOutboxOnce(T0, deps());
    expect(transport.calls).toBe(0);
    expect(reload(row.id).status).toBe("failed");
  });

  it("one bad row does not stop the others", async () => {
    const bad = enqueue({ key: "bad", template: "no-such-template" });
    const good = enqueue({ key: "good" });
    await runOutboxOnce(T0, deps());
    expect(reload(bad.id).status).toBe("failed");
    expect(reload(good.id).status).toBe("accepted");
  });

  it("a repository failure is logged, never thrown out of the run", async () => {
    jest.spyOn(outbox, "findDue").mockImplementation(() => {
      throw new Error("database is locked");
    });
    await expect(runOutboxOnce(T0, deps())).resolves.toMatchObject({
      accepted: 0,
    });
  });
});
