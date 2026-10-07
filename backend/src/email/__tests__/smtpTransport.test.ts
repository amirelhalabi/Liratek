/**
 * The `smtp` transport (LIRA-267, T040): Spacemail via nodemailer.
 *
 * nodemailer is mocked — no network. What matters is the contract with the
 * outbox worker: what is handed to nodemailer, what comes back as the
 * provider id, and above all which failures are PERMANENT (the row goes to
 * `failed`) and which are TRANSIENT (the row is retried).
 */

import { jest } from "@jest/globals";

type SendMailFn = (options: Record<string, unknown>) => Promise<{ messageId: string }>;

const mockSendMail = jest.fn<SendMailFn>();
const mockCreateTransport = jest.fn((_options: Record<string, unknown>) => ({
  sendMail: mockSendMail,
}));

// Lazy indirection: the factory runs when smtp.ts first requires nodemailer,
// before the `const`s above would be initialised if referenced directly.
jest.mock("nodemailer", () => ({
  __esModule: true,
  default: {
    createTransport: (options: Record<string, unknown>) =>
      mockCreateTransport(options),
  },
}));

import { createSmtpTransport, type SmtpConfig } from "../transports/smtp.js";
import {
  PermanentEmailError,
  TransientEmailError,
  type EmailMessage,
} from "../EmailTransport.js";

const CONFIG: SmtpConfig = {
  host: "mail.spacemail.test",
  port: 465,
  user: "mail@liratek.test",
  pass: "s3cret-mailbox-pass",
};

const MESSAGE: EmailMessage = {
  to: "owner@example.com",
  from: "LiraTek <mail@liratek.test>",
  replyTo: "help@liratek.test",
  subject: "You're invited",
  html: "<p>Open</p>",
  text: "Open",
  tag: { template: "signup-invite", outboxId: 7, idempotencyKey: "signup-invite:7" },
};

/** An error shaped like the ones nodemailer rejects with. */
function smtpError(
  message: string,
  fields: { code?: string; responseCode?: number; response?: string },
): Error {
  return Object.assign(new Error(message), fields);
}

beforeEach(() => {
  mockSendMail.mockReset();
  mockCreateTransport.mockClear();
});

describe("smtp transport — configuration", () => {
  it("port 465 -> implicit TLS (secure: true), auth from config, no pool, bounded timeouts", () => {
    const transport = createSmtpTransport(CONFIG);
    expect(transport.name).toBe("smtp");
    expect(mockCreateTransport).toHaveBeenCalledTimes(1);
    const options = mockCreateTransport.mock.calls[0]![0];
    expect(options).toMatchObject({
      host: "mail.spacemail.test",
      port: 465,
      secure: true,
      auth: { user: "mail@liratek.test", pass: "s3cret-mailbox-pass" },
      pool: false,
    });
    for (const key of ["connectionTimeout", "greetingTimeout", "socketTimeout"]) {
      const value = options[key] as number;
      expect(value).toBeGreaterThanOrEqual(10_000);
      expect(value).toBeLessThanOrEqual(30_000);
    }
  });

  it("port 587 -> STARTTLS (secure: false) and TLS is REQUIRED, never plaintext auth", () => {
    createSmtpTransport({ ...CONFIG, port: 587 });
    expect(mockCreateTransport.mock.calls[0]![0]).toMatchObject({
      port: 587,
      secure: false,
      requireTLS: true,
    });
  });
});

describe("smtp transport — send", () => {
  it("hands from/to/replyTo/subject/html/text to sendMail and returns info.messageId", async () => {
    mockSendMail.mockResolvedValue({ messageId: "<abc@spacemail>" });
    const result = await createSmtpTransport(CONFIG).send(MESSAGE);
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: MESSAGE.from,
        to: MESSAGE.to,
        replyTo: MESSAGE.replyTo,
        subject: MESSAGE.subject,
        html: MESSAGE.html,
        text: MESSAGE.text,
      }),
    );
    expect(result).toEqual({ providerMessageId: "<abc@spacemail>" });
  });

  it("omits replyTo when the message has none", async () => {
    mockSendMail.mockResolvedValue({ messageId: "<x>" });
    const { replyTo: _omit, ...noReply } = MESSAGE;
    await createSmtpTransport(CONFIG).send(noReply);
    expect(mockSendMail.mock.calls[0]![0]).not.toHaveProperty("replyTo");
  });
});

describe("smtp transport — error classification", () => {
  async function sendFailingWith(error: Error): Promise<unknown> {
    mockSendMail.mockRejectedValue(error);
    return createSmtpTransport(CONFIG)
      .send(MESSAGE)
      .then(
        () => {
          throw new Error("expected send to reject");
        },
        (rejected: unknown) => rejected,
      );
  }

  it.each([550, 551, 552, 553, 554])(
    "responseCode %i (5xx) -> PermanentEmailError carrying the server's reply",
    async (responseCode) => {
      const error = await sendFailingWith(
        smtpError("Can't send mail", {
          code: "EENVELOPE",
          responseCode,
          response: `${responseCode} 5.1.1 mailbox unavailable`,
        }),
      );
      expect(error).toBeInstanceOf(PermanentEmailError);
      expect((error as Error).message).toContain(String(responseCode));
      expect((error as Error).message).toContain("mailbox unavailable");
    },
  );

  it.each([421, 450, 451, 452])(
    "responseCode %i (4xx) -> TransientEmailError",
    async (responseCode) => {
      const error = await sendFailingWith(
        smtpError("try later", { code: "EENVELOPE", responseCode }),
      );
      expect(error).toBeInstanceOf(TransientEmailError);
    },
  );

  it.each(["ECONNECTION", "ETIMEDOUT", "ESOCKET", "ECONNREFUSED", "EDNS"])(
    "network error %s with no responseCode -> TransientEmailError",
    async (code) => {
      const error = await sendFailingWith(smtpError(`network: ${code}`, { code }));
      expect(error).toBeInstanceOf(TransientEmailError);
    },
  );

  it("an error with no code and no responseCode -> TransientEmailError", async () => {
    expect(await sendFailingWith(new Error("something odd"))).toBeInstanceOf(
      TransientEmailError,
    );
  });

  it("a non-Error rejection -> TransientEmailError", async () => {
    mockSendMail.mockRejectedValue("boom");
    await expect(createSmtpTransport(CONFIG).send(MESSAGE)).rejects.toBeInstanceOf(
      TransientEmailError,
    );
  });

  it.each([
    ["EAUTH with 535", { code: "EAUTH", responseCode: 535 }],
    ["EAUTH without a responseCode", { code: "EAUTH" }],
    ["a bare 535", { responseCode: 535 }],
  ])(
    "auth failure (%s) -> PermanentEmailError naming SMTP_USER/SMTP_PASS, never the password",
    async (_label, fields) => {
      const error = await sendFailingWith(
        smtpError(`Invalid login: 535 Authentication failed for ${CONFIG.pass}`, {
          ...fields,
          response: `535 5.7.8 Authentication failed ${CONFIG.pass}`,
        }),
      );
      expect(error).toBeInstanceOf(PermanentEmailError);
      expect((error as Error).message).toMatch(/SMTP login failed/);
      expect((error as Error).message).toMatch(/SMTP_USER\/SMTP_PASS/);
      expect((error as Error).message).not.toContain(CONFIG.pass);
    },
  );

  it("a TEMPORARY auth failure (EAUTH with 454) -> TransientEmailError", async () => {
    const error = await sendFailingWith(
      smtpError("Temporary authentication failure", {
        code: "EAUTH",
        responseCode: 454,
      }),
    );
    expect(error).toBeInstanceOf(TransientEmailError);
  });
});
