/**
 * LIRA-332 US5 — the phone and a refused write after the free trial ended.
 *
 * The server answers HTTP 200 `{ success:false, code:"TRIAL_ENDED", error:
 * "<sentence>" }`, with the code at the TOP level. The client must surface
 * the CODE (as it does for every other refusal) so screens can show the
 * shop-owner wording from one place, `auth/messages.ts`.
 *
 * Failing-first: run before client.ts read the top-level code, the result
 * was the sentence itself, and the mapping case had no TRIAL_ENDED entry.
 */

jest.mock("@/auth/tokenStore", () => ({
  getToken: async () => "tok",
  setToken: async () => undefined,
  getShop: async () => null,
}));

import { request } from "../client";
import { TRIAL_ENDED, actionErrorMessage } from "@/auth/messages";

const realFetch = global.fetch;

function respond(body: unknown, status = 200) {
  global.fetch = jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch;
}

afterEach(() => {
  global.fetch = realFetch;
});

describe("TRIAL_ENDED on the phone", () => {
  it("a refused write yields the code, not the sentence", async () => {
    respond({
      success: false,
      code: "TRIAL_ENDED",
      error: "Your free trial has ended. Contact LiraTek on WhatsApp to activate.",
    });
    await expect(request("POST", "/api/services/transactions", { body: {} })).resolves.toEqual({
      success: false,
      error: TRIAL_ENDED,
    });
  });

  it("other refusals keep today's behaviour", async () => {
    respond({ success: false, error: "Phone already used" });
    await expect(request("POST", "/api/clients", { body: {} })).resolves.toEqual({
      success: false,
      error: "Phone already used",
    });
    respond({ success: false, error: { code: "VALIDATION_ERROR", message: "bad" } });
    await expect(request("POST", "/api/clients", { body: {} })).resolves.toEqual({
      success: false,
      error: "VALIDATION_ERROR",
    });
  });

  it("the code maps to the shop-owner wording (FR-011)", () => {
    expect(actionErrorMessage(TRIAL_ENDED)).toBe(
      "Your free trial has ended. Contact LiraTek on WhatsApp to activate.",
    );
    expect(actionErrorMessage("Phone already used")).toBe("Phone already used");
  });
});
