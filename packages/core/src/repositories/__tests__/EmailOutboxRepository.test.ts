/**
 * EmailOutboxRepository (LIRA-267) — the durable, idempotent email outbox.
 *
 * Real in-memory database built from create_db.sql + runMigrations, injected
 * through `__LIRATEK_TEST_DB__`, because the guarantees under test ARE the
 * SQL: the UNIQUE idempotency key, the conditional `status='pending'` claim,
 * and the CHECK on status.
 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "../../db/migrations/index.js";
import { EmailOutboxRepository } from "../EmailOutboxRepository.js";

type TestGlobal = typeof globalThis & {
  __LIRATEK_TEST_DB__?: Database.Database;
};

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../electron-app/create_db.sql"),
  "utf8",
);

const T0 = "2026-10-07T10:00:00.000Z";
const GIVE_UP = "2026-10-10T10:00:00.000Z";

let db: Database.Database;
let repo: EmailOutboxRepository;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(CREATE_DB_SQL);
  runMigrations(db);
  (globalThis as TestGlobal).__LIRATEK_TEST_DB__ = db;
  repo = new EmailOutboxRepository();
});

afterEach(() => {
  delete (globalThis as TestGlobal).__LIRATEK_TEST_DB__;
  db.close();
});

function enqueueInvite(key = "signup-invite:1") {
  return repo.enqueue({
    idempotencyKey: key,
    template: "signup-invite",
    toEmail: "owner@example.com",
    data: { inviteUrl: "https://www.liratek.shop/signup?token=SECRET", shopName: "Corner" },
    now: T0,
    giveUpAt: GIVE_UP,
  });
}

function rowCount(): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM email_outbox`).get() as { n: number }).n;
}

describe("enqueue", () => {
  it("inserts a pending row due now, with the data serialised", () => {
    const row = enqueueInvite();
    expect(row.status).toBe("pending");
    expect(row.attempts).toBe(0);
    expect(row.next_attempt_at).toBe(T0);
    expect(row.give_up_at).toBe(GIVE_UP);
    expect(row.created_at).toBe(T0);
    expect(JSON.parse(row.data_json)).toEqual({
      inviteUrl: "https://www.liratek.shop/signup?token=SECRET",
      shopName: "Corner",
    });
  });

  it("returns the EXISTING row and inserts nothing on a duplicate key", () => {
    const first = enqueueInvite();
    const second = repo.enqueue({
      idempotencyKey: "signup-invite:1",
      template: "other",
      toEmail: "someone-else@example.com",
      data: {},
      now: "2026-10-07T11:00:00.000Z",
      giveUpAt: GIVE_UP,
    });
    expect(second.id).toBe(first.id);
    expect(second.to_email).toBe("owner@example.com");
    expect(rowCount()).toBe(1);
  });
});

describe("findDue", () => {
  it("returns pending rows whose next_attempt_at has arrived, oldest first, up to the limit", () => {
    const a = enqueueInvite("k-a");
    const b = enqueueInvite("k-b");
    repo.markRetry(b.id, "temporary", "2026-10-07T10:10:00.000Z", T0);
    const c = enqueueInvite("k-c");
    repo.claim(c.id, T0);

    expect(repo.findDue(T0, 10).map((r) => r.id)).toEqual([a.id]);
    expect(repo.findDue("2026-10-07T10:10:00.000Z", 10).map((r) => r.id)).toEqual([a.id, b.id]);
    expect(repo.findDue("2026-10-07T10:10:00.000Z", 1)).toHaveLength(1);
  });
});

describe("claim", () => {
  it("moves pending -> sending exactly once", () => {
    const row = enqueueInvite();
    expect(repo.claim(row.id, T0)).toBe(true);
    expect(repo.claim(row.id, T0)).toBe(false);
    const after = repo.findById(row.id)!;
    expect(after.status).toBe("sending");
    expect(after.locked_at).toBe(T0);
  });

  it("will not claim an accepted or failed row", () => {
    const a = enqueueInvite("k-a");
    repo.claim(a.id, T0);
    repo.markAccepted(a.id, "msg-1", T0);
    expect(repo.claim(a.id, T0)).toBe(false);

    const f = enqueueInvite("k-f");
    repo.claim(f.id, T0);
    repo.markFailed(f.id, "permanent", T0);
    expect(repo.claim(f.id, T0)).toBe(false);
  });
});

describe("mark*", () => {
  it("markAccepted records the provider id, sent_at, attempts and clears the lock", () => {
    const row = enqueueInvite();
    repo.claim(row.id, T0);
    repo.markAccepted(row.id, "provider-123", "2026-10-07T10:00:05.000Z");
    const after = repo.findById(row.id)!;
    expect(after.status).toBe("accepted");
    expect(after.provider_message_id).toBe("provider-123");
    expect(after.sent_at).toBe("2026-10-07T10:00:05.000Z");
    expect(after.locked_at).toBeNull();
    expect(after.attempts).toBe(1);
  });

  it("markRetry returns the row to pending at the next attempt time", () => {
    const row = enqueueInvite();
    repo.claim(row.id, T0);
    repo.markRetry(row.id, "ETIMEDOUT", "2026-10-07T10:10:00.000Z", T0, 2);
    const after = repo.findById(row.id)!;
    expect(after.status).toBe("pending");
    expect(after.next_attempt_at).toBe("2026-10-07T10:10:00.000Z");
    expect(after.last_error).toBe("ETIMEDOUT");
    expect(after.locked_at).toBeNull();
    expect(after.attempts).toBe(2);
  });

  it("markFailed cuts last_error to 1000 characters", () => {
    const row = enqueueInvite();
    repo.claim(row.id, T0);
    repo.markFailed(row.id, "x".repeat(5000), T0);
    const after = repo.findById(row.id)!;
    expect(after.status).toBe("failed");
    expect(after.last_error).toHaveLength(1000);
  });
});

describe("recoverStuck", () => {
  it("returns rows stuck in sending longer than the threshold to pending, and leaves fresh ones", () => {
    const old = enqueueInvite("k-old");
    const fresh = enqueueInvite("k-fresh");
    repo.claim(old.id, "2026-10-07T10:00:00.000Z");
    repo.claim(fresh.id, "2026-10-07T10:08:00.000Z");

    const recovered = repo.recoverStuck("2026-10-07T10:11:00.000Z", 10 * 60 * 1000);
    expect(recovered).toBe(1);
    expect(repo.findById(old.id)!.status).toBe("pending");
    expect(repo.findById(old.id)!.locked_at).toBeNull();
    expect(repo.findById(fresh.id)!.status).toBe("sending");
  });
});

describe("scrubSecret", () => {
  it("removes exactly one key from data_json", () => {
    const row = enqueueInvite();
    expect(repo.scrubSecret(row.id, "inviteUrl")).toBe(true);
    expect(JSON.parse(repo.findById(row.id)!.data_json)).toEqual({ shopName: "Corner" });
  });

  it("is a no-op for a missing key or row", () => {
    const row = enqueueInvite();
    expect(repo.scrubSecret(row.id, "nope")).toBe(false);
    expect(repo.scrubSecret(99999, "inviteUrl")).toBe(false);
    expect(JSON.parse(repo.findById(row.id)!.data_json)).toHaveProperty("inviteUrl");
  });
});
