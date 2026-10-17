/**
 * LIRA-332 (FR-011) — a write refused because the free trial ended comes
 * back HTTP 200 `{ success:false, code:"TRIAL_ENDED" }` (rule 19c). The
 * client must still hand that envelope to the caller (so the page shows the
 * server's text where it shows errors) AND announce it once on `window`, so
 * the banner switches to "trial ended" at once instead of in 15 minutes.
 *
 * Not proven failing-first (new contract): before TRIAL_ENDED_EVENT existed
 * this file only failed to compile.
 */

import { requestJson, TRIAL_ENDED_EVENT } from "../httpClient";

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

describe("TRIAL_ENDED_EVENT", () => {
  it("is dispatched exactly once for a TRIAL_ENDED body, and the envelope still reaches the caller", async () => {
    const seen = jest.fn();
    window.addEventListener(TRIAL_ENDED_EVENT, seen);
    const body = {
      success: false,
      code: "TRIAL_ENDED",
      error:
        "Your free trial has ended. Contact LiraTek on WhatsApp to activate.",
    };
    respond(body);

    await expect(
      requestJson("/api/sales/process", { method: "POST", body: {} }),
    ).resolves.toEqual(body);
    expect(seen).toHaveBeenCalledTimes(1);
    window.removeEventListener(TRIAL_ENDED_EVENT, seen);
  });

  it("other failures and successes dispatch nothing", async () => {
    const seen = jest.fn();
    window.addEventListener(TRIAL_ENDED_EVENT, seen);
    respond({ success: false, code: "VALIDATION_ERROR", error: "bad" });
    await requestJson("/api/x", { method: "POST", body: {} });
    respond({ success: true, data: [] });
    await requestJson("/api/x");
    respond({ success: false, error: "TRIAL_ENDED" });
    await requestJson("/api/x", { method: "POST", body: {} });
    expect(seen).not.toHaveBeenCalled();
    window.removeEventListener(TRIAL_ENDED_EVENT, seen);
  });
});
