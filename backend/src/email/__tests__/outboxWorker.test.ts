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
  emailLogger,
  SIGNUP_INVITE_TEMPLATE,
  SIGNUP_INVITE_URL_KEY,
  type EmailOutboxEntity,
} from "@liratek/core";
import {
  EMAIL_OUTBOX_ROUND_PAUSE_MS,
  runOutboxOnce,
  type OutboxWorkerDeps,
} from "../outboxWorker.js";
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
/** Every pause the worker asked for; the test never actually waits. */
let pauses: number[];

const SMTP_PASS_VALUE = "hunter2-smtp-pass";
const RESEND_KEY_VALUE = "re_live_abcdef123456";

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
  pauses = [];
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

function deps(): OutboxWorkerDeps {
  return {
    outbox,
    transport,
    from: "LiraTek <mail@liratek.test>",
    replyTo: "help@liratek.test",
    sleep: async (ms: number) => {
      pauses.push(ms);
    },
    secrets: [SMTP_PASS_VALUE, RESEND_KEY_VALUE, "", undefined],
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
    // US3: a round is two attempts, so both must fail for the row to wait.
    transport.scriptOutcomes(
      new TransientEmailError("connection reset"),
      new TransientEmailError("connection reset"),
    );

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
    transport.scriptOutcomes(
      new TransientEmailError("timeout"),
      new TransientEmailError("timeout"),
    );

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

// =============================================================================
// US3 (T036) — two attempts per round, crash recovery, secret redaction
// =============================================================================

describe("runOutboxOnce — retry policy (US3)", () => {
  it("a transient error then success in one round: accepted, attempts = 2, one 2s pause", async () => {
    const row = enqueue();
    transport.scriptOutcomes(new TransientEmailError("421 try later"));

    const summary = await runOutboxOnce(T0, deps());

    const after = reload(row.id);
    expect(after.status).toBe("accepted");
    expect(after.attempts).toBe(2);
    expect(transport.calls).toBe(2);
    expect(transport.sent).toHaveLength(1);
    expect(pauses).toEqual([EMAIL_OUTBOX_ROUND_PAUSE_MS]);
    expect(EMAIL_OUTBOX_ROUND_PAUSE_MS).toBe(2000);
    expect(after.data_json).not.toContain("secret-token");
    expect(summary).toMatchObject({ accepted: 1, retried: 0, failed: 0 });
  });

  it("two transient errors: pending, next_attempt_at = now + 10m, attempts = 2", async () => {
    const row = enqueue();
    transport.scriptOutcomes(
      new TransientEmailError("timeout 1"),
      new TransientEmailError("timeout 2"),
    );

    const summary = await runOutboxOnce(T0, deps());

    const after = reload(row.id);
    expect(after.status).toBe("pending");
    expect(after.next_attempt_at).toBe(plus(T0, TEN_MIN_MS));
    expect(after.attempts).toBe(2);
    expect(after.last_error).toContain("timeout 2");
    expect(after.locked_at).toBeNull();
    expect(transport.calls).toBe(2);
    expect(summary).toMatchObject({ retried: 1 });
  });

  it("the next round, once due (and not before), makes two more attempts", async () => {
    const row = enqueue();
    transport.scriptOutcomes(
      new TransientEmailError("a"),
      new TransientEmailError("b"),
    );
    await runOutboxOnce(T0, deps());

    // Not due yet: nothing happens.
    await runOutboxOnce(plus(T0, TEN_MIN_MS - 1000), deps());
    expect(transport.calls).toBe(2);

    transport.scriptOutcomes(
      new TransientEmailError("c"),
      new TransientEmailError("d"),
    );
    await runOutboxOnce(plus(T0, TEN_MIN_MS), deps());
    let after = reload(row.id);
    expect(transport.calls).toBe(4);
    expect(after.attempts).toBe(4);
    expect(after.status).toBe("pending");
    expect(after.next_attempt_at).toBe(plus(T0, 2 * TEN_MIN_MS));

    await runOutboxOnce(plus(T0, 2 * TEN_MIN_MS), deps());
    after = reload(row.id);
    expect(after.status).toBe("accepted");
    expect(after.attempts).toBe(5);
    expect(transport.sent).toHaveLength(1);
  });

  it("when now + 10m reaches give_up_at, two transient errors fail the row with last_error and scrub the link", async () => {
    const row = enqueue({ giveUpAt: plus(T0, TEN_MIN_MS + 5000) });
    transport.scriptOutcomes(
      new TransientEmailError("x"),
      new TransientEmailError("still down"),
    );
    // First round: T0 + 10m < give_up_at, so it waits.
    await runOutboxOnce(T0, deps());
    expect(reload(row.id).status).toBe("pending");

    transport.scriptOutcomes(
      new TransientEmailError("y"),
      new TransientEmailError("still down at the end"),
    );
    await runOutboxOnce(plus(T0, TEN_MIN_MS), deps());

    const after = reload(row.id);
    expect(after.status).toBe("failed");
    expect(after.attempts).toBe(4);
    expect(after.last_error).toContain("still down at the end");
    expect(after.data_json).not.toContain("secret-token");
  });

  it("a permanent error fails at once: one attempt, no pause, link scrubbed", async () => {
    const row = enqueue();
    transport.scriptOutcomes(new PermanentEmailError("550 no such user"));

    const summary = await runOutboxOnce(T0, deps());

    const after = reload(row.id);
    expect(after.status).toBe("failed");
    expect(after.attempts).toBe(1);
    expect(transport.calls).toBe(1);
    expect(pauses).toEqual([]);
    expect(after.last_error).toContain("550 no such user");
    expect(JSON.parse(after.data_json)).not.toHaveProperty(
      SIGNUP_INVITE_URL_KEY,
    );
    expect(summary).toMatchObject({ failed: 1 });
  });

  it("a transient then a permanent error in one round fails the row (attempts = 2)", async () => {
    const row = enqueue();
    transport.scriptOutcomes(
      new TransientEmailError("blip"),
      new PermanentEmailError("535 auth rejected"),
    );
    await runOutboxOnce(T0, deps());
    const after = reload(row.id);
    expect(after.status).toBe("failed");
    expect(after.attempts).toBe(2);
    expect(after.last_error).toContain("535 auth rejected");
  });
});

describe("runOutboxOnce — crash recovery (US3)", () => {
  function markStuck(id: number, lockedAt: string): void {
    db.prepare(
      `UPDATE email_outbox SET status = 'sending', locked_at = ? WHERE id = ?`,
    ).run(lockedAt, id);
  }

  it("a row stuck in sending for more than 10 minutes goes back to pending and is sent once", async () => {
    const row = enqueue();
    markStuck(row.id, plus(T0, -(TEN_MIN_MS + 60_000)));

    await runOutboxOnce(T0, deps());
    await runOutboxOnce(plus(T0, 30_000), deps());

    const after = reload(row.id);
    expect(after.status).toBe("accepted");
    expect(transport.calls).toBe(1);
    expect(transport.sent).toHaveLength(1);
  });

  it("a row locked 5 minutes ago is left alone (another run may still be sending it)", async () => {
    const row = enqueue();
    markStuck(row.id, plus(T0, -5 * 60_000));

    await runOutboxOnce(T0, deps());

    const after = reload(row.id);
    expect(after.status).toBe("sending");
    expect(transport.calls).toBe(0);
  });
});

describe("runOutboxOnce — concurrency (US3)", () => {
  it("two runs on the same tick send once, even while the first is paused between attempts", async () => {
    const row = enqueue();
    transport.scriptOutcomes(new TransientEmailError("first try fails"));
    const yielding: OutboxWorkerDeps = {
      ...deps(),
      // A real yield to the event loop, so the second run gets in mid-round.
      sleep: () => new Promise<void>((resolve) => setImmediate(resolve)),
    };

    await Promise.all([
      runOutboxOnce(T0, yielding),
      runOutboxOnce(T0, yielding),
    ]);

    expect(transport.sent).toHaveLength(1);
    expect(transport.calls).toBe(2);
    expect(reload(row.id).status).toBe("accepted");
  });
});

describe("runOutboxOnce — secret redaction (US3)", () => {
  it("last_error and the log never contain a configured secret value", async () => {
    const warn = jest.spyOn(emailLogger, "warn");
    const row = enqueue();
    const leak = `auth failed for user mail with pass ${SMTP_PASS_VALUE} (key ${RESEND_KEY_VALUE})`;
    transport.scriptOutcomes(
      new TransientEmailError(leak),
      new TransientEmailError(leak),
    );

    await runOutboxOnce(T0, deps());

    const after = reload(row.id);
    expect(after.last_error).toContain("auth failed for user mail");
    expect(after.last_error).toContain("[redacted]");
    expect(after.last_error).not.toContain(SMTP_PASS_VALUE);
    expect(after.last_error).not.toContain(RESEND_KEY_VALUE);
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain(SMTP_PASS_VALUE);
    expect(logged).not.toContain(RESEND_KEY_VALUE);
    warn.mockRestore();
  });

  it("an empty or unset secret does not mangle the message", async () => {
    const row = enqueue();
    transport.scriptOutcomes(
      new PermanentEmailError("550 mailbox unavailable"),
    );
    await runOutboxOnce(T0, deps());
    expect(reload(row.id).last_error).toBe(
      "PermanentEmailError: 550 mailbox unavailable",
    );
  });
});
