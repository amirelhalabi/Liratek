/**
 * In-memory transport for unit tests (LIRA-267). Records every message it
 * accepts, and can be scripted to throw on upcoming sends so the worker's
 * error handling can be driven deterministically.
 */

import type {
  EmailMessage,
  EmailSendResult,
  EmailTransport,
} from "../EmailTransport.js";

export class FakeEmailTransport implements EmailTransport {
  readonly name = "fake";
  /** Every message that was accepted, in order. */
  readonly sent: EmailMessage[] = [];
  /** Every call to send(), accepted or not. */
  calls = 0;
  private script: Array<Error | null> = [];

  /**
   * Queues outcomes for the next sends: an Error is thrown, `null` succeeds.
   * Once the script runs out, every send succeeds.
   */
  scriptOutcomes(...outcomes: Array<Error | null>): this {
    this.script.push(...outcomes);
    return this;
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    this.calls += 1;
    const next = this.script.shift();
    if (next) throw next;
    this.sent.push(message);
    return { providerMessageId: `fake-${this.sent.length}` };
  }
}
