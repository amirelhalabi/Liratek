/**
 * The email outbox worker (LIRA-267, research R2).
 *
 * Every 30 seconds it takes up to 20 due rows from `email_outbox` and, for
 * each: claim (pending -> sending, a conditional UPDATE, so a row is sent by
 * one run only) -> render -> transport.send -> markAccepted -> scrub the
 * invite link out of `data_json` (research R3).
 *
 * Mirrors `services/lapseSweep.ts`: a plain unref'd interval, one run at
 * boot, everything inside `runWithoutTenant` (the outbox is platform data),
 * and a failed run is logged, never thrown — mail trouble must never take
 * the API down.
 *
 * Error handling goes through ONE function, `handleSendFailure`. The basic
 * policy here only guarantees no row is ever left in `sending`:
 *   - permanent error (or a row that can never render) -> failed;
 *   - transient error -> pending, due again in 10 minutes, or failed if that
 *     would be at/after give_up_at.
 * US3 (T037) replaces the inside of that function and `sendRound` with the
 * full policy (two back-to-back attempts per round, crash recovery, secret
 * redaction) without touching the rest of this file.
 */

import {
  EMAIL_FROM,
  EMAIL_REPLY_TO,
  SIGNUP_INVITE_URL_KEY,
  emailLogger,
  getEmailOutboxRepository,
  runWithoutTenant,
  type EmailOutboxEntity,
  type EmailOutboxRepository,
} from "@liratek/core";
import {
  PermanentEmailError,
  type EmailTransport,
} from "./EmailTransport.js";
import { createTransport, isEmailConfigured } from "./createTransport.js";
import { renderTemplate, type TemplateVars } from "./renderTemplate.js";
import { getEmailTemplate } from "./templates/index.js";

/** How often due rows are picked up. */
export const EMAIL_OUTBOX_INTERVAL_MS = 30 * 1000;
/** At most this many rows per run. */
export const EMAIL_OUTBOX_BATCH_SIZE = 20;
/** Delay before the next round after a transient failure (research R2). */
export const EMAIL_OUTBOX_RETRY_DELAY_MS = 10 * 60 * 1000;

/** Keys holding a secret that must not outlive a final status (R3). */
const SECRET_DATA_KEYS = [SIGNUP_INVITE_URL_KEY] as const;

export interface OutboxWorkerDeps {
  outbox: EmailOutboxRepository;
  transport: EmailTransport;
  from: string;
  replyTo?: string;
}

export interface OutboxRunSummary {
  accepted: number;
  retried: number;
  failed: number;
  /** Rows another run claimed first. */
  skipped: number;
}

/** The outcome of one round of sending one row. */
type RoundOutcome =
  | { ok: true; providerMessageId: string | null; attemptsMade: number }
  | { ok: false; error: unknown; attemptsMade: number };

let activeTransport: EmailTransport | null = null;
let timer: NodeJS.Timeout | null = null;

function addMs(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString();
}

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function defaultDeps(): OutboxWorkerDeps {
  if (!activeTransport) activeTransport = createTransport();
  return {
    outbox: getEmailOutboxRepository(),
    transport: activeTransport,
    from: EMAIL_FROM,
    replyTo: EMAIL_REPLY_TO,
  };
}

function scrubSecrets(outbox: EmailOutboxRepository, id: number): void {
  for (const key of SECRET_DATA_KEYS) outbox.scrubSecret(id, key);
}

/**
 * One round for one claimed row. Basic path: a single attempt.
 * US3 makes this up to two back-to-back attempts.
 */
async function sendRound(
  row: EmailOutboxEntity,
  deps: OutboxWorkerDeps,
): Promise<RoundOutcome> {
  let rendered: ReturnType<typeof renderTemplate>;
  try {
    rendered = renderTemplate(
      getEmailTemplate(row.template),
      JSON.parse(row.data_json) as TemplateVars,
    );
  } catch (error) {
    // A template or data problem can never fix itself, and nothing reached
    // the provider: permanent, with no attempt counted.
    return {
      ok: false,
      error: new PermanentEmailError(errorText(error)),
      attemptsMade: 0,
    };
  }

  try {
    const result = await deps.transport.send({
      to: row.to_email,
      from: deps.from,
      ...(deps.replyTo ? { replyTo: deps.replyTo } : {}),
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      tag: {
        template: row.template,
        outboxId: row.id,
        idempotencyKey: row.idempotency_key,
      },
    });
    return {
      ok: true,
      providerMessageId: result.providerMessageId,
      attemptsMade: 1,
    };
  } catch (error) {
    return { ok: false, error, attemptsMade: 1 };
  }
}

/**
 * The single place a failed round is turned into a row state.
 * Returns which way the row went.
 */
function handleSendFailure(
  row: EmailOutboxEntity,
  error: unknown,
  attemptsMade: number,
  now: string,
  outbox: EmailOutboxRepository,
): "retried" | "failed" {
  const message = errorText(error);
  const nextAttemptAt = addMs(now, EMAIL_OUTBOX_RETRY_DELAY_MS);
  const giveUp =
    error instanceof PermanentEmailError ||
    Date.parse(nextAttemptAt) >= Date.parse(row.give_up_at);

  if (giveUp) {
    outbox.markFailed(row.id, message, now, attemptsMade);
    scrubSecrets(outbox, row.id);
    emailLogger.warn(
      { outboxId: row.id, template: row.template, error: message },
      "email failed permanently",
    );
    return "failed";
  }

  outbox.markRetry(row.id, message, nextAttemptAt, now, attemptsMade);
  emailLogger.warn(
    { outboxId: row.id, template: row.template, error: message, nextAttemptAt },
    "email send failed, will retry",
  );
  return "retried";
}

async function processRow(
  row: EmailOutboxEntity,
  now: string,
  deps: OutboxWorkerDeps,
  summary: OutboxRunSummary,
): Promise<void> {
  const { outbox } = deps;
  if (!outbox.claim(row.id, now)) {
    summary.skipped += 1;
    return;
  }

  // Past its give-up time (e.g. the invite has expired): never send a link
  // that no longer works.
  if (Date.parse(now) >= Date.parse(row.give_up_at)) {
    outbox.markFailed(row.id, "gave up: past give_up_at", now, 0);
    scrubSecrets(outbox, row.id);
    summary.failed += 1;
    return;
  }

  const outcome = await sendRound(row, deps);
  if (outcome.ok) {
    outbox.markAccepted(row.id, outcome.providerMessageId, now, outcome.attemptsMade);
    scrubSecrets(outbox, row.id);
    emailLogger.info(
      { outboxId: row.id, template: row.template, transport: deps.transport.name },
      "email accepted by provider",
    );
    summary.accepted += 1;
    return;
  }

  summary[handleSendFailure(row, outcome.error, outcome.attemptsMade, now, outbox)] += 1;
}

/**
 * One pass over the due rows. Never throws: a failure is logged and the
 * next interval tries again.
 */
export async function runOutboxOnce(
  now: string = new Date().toISOString(),
  deps?: OutboxWorkerDeps,
): Promise<OutboxRunSummary> {
  const summary: OutboxRunSummary = { accepted: 0, retried: 0, failed: 0, skipped: 0 };
  try {
    await runWithoutTenant(async () => {
      const resolved = deps ?? defaultDeps();
      const due = resolved.outbox.findDue(now, EMAIL_OUTBOX_BATCH_SIZE);
      for (const row of due) {
        try {
          await processRow(row, now, resolved, summary);
        } catch (error) {
          // One bad row must not stop the rest of the batch.
          emailLogger.error({ error, outboxId: row.id }, "email outbox row failed");
        }
      }
    });
  } catch (error) {
    emailLogger.error({ error }, "email outbox run failed");
  }
  return summary;
}

/**
 * Starts the worker: one run now, then every 30 seconds. With
 * `EMAIL_TRANSPORT=disabled` it does not start at all — queued rows stay
 * pending until email is configured (or past give_up_at, when the next
 * enabled run fails them). Throws at boot on an unusable configuration
 * (e.g. smtp before it ships), so the deploy surfaces it.
 */
export function startEmailOutbox(): void {
  if (!isEmailConfigured()) {
    emailLogger.info("email outbox not started: EMAIL_TRANSPORT=disabled");
    return;
  }
  activeTransport = createTransport();
  emailLogger.info({ transport: activeTransport.name }, "email outbox started");

  void runOutboxOnce();

  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    void runOutboxOnce();
  }, EMAIL_OUTBOX_INTERVAL_MS);
  // Never hold the process open on shutdown for a mail timer.
  timer.unref?.();
}

export function stopEmailOutbox(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
