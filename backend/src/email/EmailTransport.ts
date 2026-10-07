/**
 * The one seam between LiraTek and whatever actually sends email (LIRA-267,
 * research R6). The outbox worker only ever talks to this interface, so every
 * piece except the final hop is testable with the `fake` and `file`
 * transports.
 *
 * Error contract — the worker's retry policy depends on it:
 *   - `PermanentEmailError`: retrying cannot help (bad address, rejected
 *     credentials, transport not configured). The row goes to `failed`.
 *   - anything else, including `TransientEmailError`: may succeed later
 *     (network, timeout, provider 4xx/429). The row is retried.
 */

/** Identifies the outbox row a message belongs to. */
export interface EmailMessageTag {
  template: string;
  outboxId: number;
  /** Stable per logical email; a provider that supports idempotency keys
   * (Resend) receives it so a crash-and-resend is deduplicated. */
  idempotencyKey: string;
}

export interface EmailMessage {
  to: string;
  from: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  tag: EmailMessageTag;
}

export interface EmailSendResult {
  /** The provider's id for the accepted message, when it gives one. */
  providerMessageId: string | null;
}

export interface EmailTransport {
  /** `disabled` | `file` | `fake` | `smtp` | `resend` — for logs. */
  readonly name: string;
  /** Resolves once the provider ACCEPTED the message (not delivered). */
  send(message: EmailMessage): Promise<EmailSendResult>;
  /**
   * Optional: checks the provider will let us in (connect + log in) without
   * sending anything. Run once at startup by the outbox worker. Rejects with
   * `EmailAuthError` when the credentials are refused; any other rejection
   * is treated as transient. Only transports that log in implement it.
   */
  verify?(): Promise<void>;
}

/** May succeed if tried again later. */
export class TransientEmailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransientEmailError";
  }
}

/** Will fail the same way however often it is retried. */
export class PermanentEmailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentEmailError";
  }
}

/** The provider refused our login (wrong user or password). Permanent: no
 * email can be sent until an operator fixes the secrets. */
export class EmailAuthError extends PermanentEmailError {
  constructor(message: string) {
    super(message);
    this.name = "EmailAuthError";
  }
}
