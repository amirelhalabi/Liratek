/**
 * Feature B's web-only adapter functions (LIRA-279/281, plus the LIRA-276
 * "Send password reset" call): each hits the contract's path and method,
 * sends the body it was given (typed from the core `*Input` types, rule 21),
 * marks the public link routes `auth: false`, and refuses on desktop
 * (`assertWebOnly`) without touching IPC or the network.
 *
 * Bodies are parsed through the core schemas (rule 24), so a field the
 * adapter renamed would fail here.
 */

import {
  acceptUserInvitationSchema,
  checkUserInvitationSchema,
  createUserInvitationSchema,
  setUserEmailSchema,
  verifyUserEmailSchema,
} from "@liratek/core";

const requestJson = jest.fn();
jest.mock("../httpClient", () => ({
  requestJson: (...args: unknown[]) => requestJson(...args),
  setToken: jest.fn(),
  getToken: jest.fn(),
  isImpersonationActive: () => false,
  clearImpersonationSession: jest.fn(),
}));

import * as api from "../backendApi";

type Call = [string, { method?: string; body?: unknown; auth?: boolean } | undefined];

function lastCall(): Call {
  const calls = requestJson.mock.calls as Call[];
  return calls[calls.length - 1]!;
}

beforeEach(() => {
  requestJson.mockReset();
  delete (window as unknown as { api?: unknown }).api;
});

describe("user email", () => {
  it("listUserEmails: GET /api/user-email, unwraps data.users", async () => {
    const users = [{ id: 2, email: "a@b.co", emailVerifiedAt: null }];
    requestJson.mockResolvedValue({ success: true, data: { users } });
    await expect(api.listUserEmails()).resolves.toEqual(users);
    expect(lastCall()[0]).toBe("/api/user-email");
  });

  it("setUserEmail: PUT /api/user-email/:id with the schema's body, returns the envelope", async () => {
    const env = { success: true, data: { email: "a@b.co", emailVerifiedAt: null, verificationSent: true } };
    requestJson.mockResolvedValue(env);
    const input = { email: "a@b.co" };
    await expect(api.setUserEmail(7, input)).resolves.toEqual(env);
    const [path, opts] = lastCall();
    expect(path).toBe("/api/user-email/7");
    expect(opts?.method).toBe("PUT");
    expect(setUserEmailSchema.safeParse(opts?.body).success).toBe(true);
  });

  it("sendUserEmailVerification: POST /api/user-email/:id/send-verification", async () => {
    requestJson.mockResolvedValue({ success: true, data: { sent: true } });
    await api.sendUserEmailVerification(7);
    expect(lastCall()[0]).toBe("/api/user-email/7/send-verification");
    expect(lastCall()[1]?.method).toBe("POST");
  });

  it("verifyUserEmail: public POST /api/user-email/verify, token in the body", async () => {
    requestJson.mockResolvedValue({ success: true, data: { verified: true } });
    await api.verifyUserEmail({ token: "t0k" });
    const [path, opts] = lastCall();
    expect(path).toBe("/api/user-email/verify");
    expect(opts).toMatchObject({ method: "POST", auth: false });
    expect(verifyUserEmailSchema.parse(opts?.body)).toEqual({ token: "t0k" });
  });
});

describe("user invitations", () => {
  it("listUserInvitations: GET /api/user-invitations, unwraps data", async () => {
    const data = { emailConfigured: true, invitations: [] };
    requestJson.mockResolvedValue({ success: true, data });
    await expect(api.listUserInvitations()).resolves.toEqual(data);
    expect(lastCall()[0]).toBe("/api/user-invitations");
  });

  it("createUserInvitation: POST with { email, role }", async () => {
    requestJson.mockResolvedValue({ success: true, data: { invitation: { id: 1 } } });
    await api.createUserInvitation({ email: "x@y.co", role: "staff" });
    const [path, opts] = lastCall();
    expect(path).toBe("/api/user-invitations");
    expect(opts?.method).toBe("POST");
    expect(createUserInvitationSchema.parse(opts?.body)).toEqual({ email: "x@y.co", role: "staff" });
  });

  it("revoke / resend: POST /api/user-invitations/:id/{revoke,resend}", async () => {
    requestJson.mockResolvedValue({ success: true, data: { invitation: { id: 4 } } });
    await api.revokeUserInvitation(4);
    expect(lastCall()[0]).toBe("/api/user-invitations/4/revoke");
    expect(lastCall()[1]?.method).toBe("POST");
    await api.resendUserInvitation(4);
    expect(lastCall()[0]).toBe("/api/user-invitations/4/resend");
    expect(lastCall()[1]?.method).toBe("POST");
  });

  it("check / accept are public POSTs with the token in the body", async () => {
    requestJson.mockResolvedValue({ success: true, data: {} });
    await api.checkUserInvitation({ token: "abc" });
    expect(lastCall()[0]).toBe("/api/user-invitations/check");
    expect(lastCall()[1]).toMatchObject({ method: "POST", auth: false });
    expect(checkUserInvitationSchema.parse(lastCall()[1]?.body)).toEqual({ token: "abc" });

    const input = { token: "abc", username: "newbie", password: "Password1!" };
    await api.acceptUserInvitation(input);
    expect(lastCall()[0]).toBe("/api/user-invitations/accept");
    expect(lastCall()[1]).toMatchObject({ method: "POST", auth: false });
    expect(acceptUserInvitationSchema.parse(lastCall()[1]?.body)).toEqual(input);
  });
});

describe("send password reset (LIRA-276 button -> feature C's endpoint)", () => {
  it("POST /api/password-reset/send/:userId", async () => {
    requestJson.mockResolvedValue({ success: true, data: { sent: true } });
    await api.sendPasswordReset(9);
    expect(lastCall()[0]).toBe("/api/password-reset/send/9");
    expect(lastCall()[1]?.method).toBe("POST");
  });
});

describe("desktop", () => {
  it("every function refuses on desktop without calling the network", async () => {
    (window as unknown as { api?: unknown }).api = {};
    const calls: Array<() => Promise<unknown>> = [
      () => api.listUserEmails(),
      () => api.setUserEmail(1, { email: null }),
      () => api.sendUserEmailVerification(1),
      () => api.verifyUserEmail({ token: "t" }),
      () => api.listUserInvitations(),
      () => api.createUserInvitation({ email: "a@b.co", role: "staff" }),
      () => api.revokeUserInvitation(1),
      () => api.resendUserInvitation(1),
      () => api.checkUserInvitation({ token: "t" }),
      () => api.acceptUserInvitation({ token: "t", username: "abc", password: "Password1!" }),
      () => api.sendPasswordReset(1),
    ];
    for (const call of calls) {
      await expect(call()).rejects.toThrow(/only available in web mode/);
    }
    expect(requestJson).not.toHaveBeenCalled();
  });
});
