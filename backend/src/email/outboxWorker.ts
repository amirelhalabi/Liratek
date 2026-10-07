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
 * Retry policy (research R2, US3):
 *   - every run first returns rows stuck in `sending` for more than 10
 *     minutes to `pending` (a crash mid-send), so they are retried;
 *   - a round is up to TWO send attempts back to back, 2 seconds apart;
 *     `attempts` counts every individual try;
 *   - a permanent error (or a row that can never render) -> failed at once;
 *   - two transient errors -> pending, due again in 10 minutes, or failed if
 *     that would be at/after give_up_at;
 *   - configured secret values (SMTP_PASS, RESEND_API_KEY,
 *     TURNSTILE_SECRET_KEY) are redacted from the error text before it is
 *     stored in `last_error` or logged.
 * Failed rounds go through ONE function, `handleSendFailure`.
 */

import {
  EMAIL_FROM,
  EMAIL_REPLY_TO,
  RESEND_API_KEY,
  SIGNUP_INVITE_URL_KEY,
  SMTP_PASS,
  TURNSTILE_SECRET_KEY,
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
/** Send attempts per round. */
export const EMAIL_OUTBOX_ATTEMPTS_PER_ROUND = 2;
/** Pause between the attempts of one round. */
export const EMAIL_OUTBOX_ROUND_PAUSE_MS = 2000;
/** A `sending` row locked longer than this was abandoned by a crash. */
export const EMAIL_OUTBOX_STUCK_AFTER_MS = 10 * 60 * 1000;
/** What a redacted secret is replaced with in stored/logged error text. */
export const REDACTED = "[redacted]";

/** Keys holding a secret that must not outlive a final status (R3). */
const SECRET_DATA_KEYS = [SIGNUP_INVITE_URL_KEY] as const;

export interface OutboxWorkerDeps {
  outbox: EmailOutboxRepository;
  transport: EmailTransport;
  from: string;
  replyTo?: string;
  /** The pause between attempts; injectable so tests never really wait. */
  sleep?: (ms: number) => Promise<void>;
  /** Secret values that must never reach `last_error` or the log.
   * Defaults to the configured SMTP_PASS, RESEND_API_KEY and
   * TURNSTILE_SECRET_KEY. Empty/unset entries are ignored. */
  secrets?: ReadonlyArray<string | undefined>;
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

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Replaces every configured secret value in `text`. A provider error can
 * echo credentials back (e.g. an auth failure quoting the login), and
 * `last_error` is shown to the platform admin. Empty values are skipped:
 * splitting on "" would put the marker between every character.
 */
export function redactSecrets(
  text: string,
  secrets: ReadonlyArray<string | undefined>,
): string {
  let out = text;
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join(REDACTED);
  }
  return out;
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

function configuredSecrets(deps: OutboxWorkerDeps): ReadonlyArray<string | undefined> {
  return deps.secrets ?? [SMTP_PASS, RESEND_API_KEY, TURNSTILE_SECRET_KEY];
}

function scrubSecrets(outbox: EmailOutboxRepository, id: number): void {
  for (const key of SECRET_DATA_KEYS) outbox.scrubSecret(id, key);
}

/**
 * One round for one claimed row: up to two attempts back to back, with a
 * pause between them. A permanent error ends the round at once.
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

  const sleep = deps.sleep ?? defaultSleep;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= EMAIL_OUTBOX_ATTEMPTS_PER_ROUND; attempt += 1) {
    if (attempt > 1) await sleep(EMAIL_OUTBOX_ROUND_PAUSE_MS);
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
        attemptsMade: attempt,
      };
    } catch (error) {
      lastError = error;
      if (error instanceof PermanentEmailError) {
        return { ok: false, error, attemptsMade: attempt };
      }
    }
  }
  return {
    ok: false,
    error: lastError,
    attemptsMade: EMAIL_OUTBOX_ATTEMPTS_PER_ROUND,
  };
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
  deps: OutboxWorkerDeps,
): "retried" | "failed" {
  const { outbox } = deps;
  // Redacted BEFORE it is stored or logged: both are read by people.
  const message = redactSecrets(errorText(error), configuredSecrets(deps));
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

  summary[handleSendFailure(row, outcome.error, outcome.attemptsMade, now, deps)] += 1;
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
      // Crash recovery first, so a row abandoned mid-send is due this run.
      resolved.outbox.recoverStuck(now, EMAIL_OUTBOX_STUCK_AFTER_MS);
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
