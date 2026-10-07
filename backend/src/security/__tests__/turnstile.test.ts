/**
 * Cloudflare Turnstile server-side verification (LIRA-267, T050).
 *
 * `fetch` is injected, so nothing here touches the network. The result is a
 * tri-state rather than T050's boolean: the route must tell "the visitor
 * failed the check" (rejected) apart from "we could not ask Cloudflare"
 * (unavailable) — contracts/api.md gives them different messages. Both
 * fail closed.
 */

import {
  TURNSTILE_TIMEOUT_MS,
  TURNSTILE_VERIFY_URL,
  isTurnstileConfigured,
  verifyTurnstile,
  type TurnstileFetch,
} from "../turnstile.js";

const SECRET = "0x-test-secret";

interface Call {
  url: string;
  method: string;
  body: Record<string, string>;
  signal: AbortSignal;
}

function fakeFetch(
  respond: () => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>,
): { fetchImpl: TurnstileFetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl: TurnstileFetch = async (url, init) => {
    calls.push({
      url,
      method: init.method,
      body: Object.fromEntries(init.body.entries()),
      signal: init.signal,
    });
    return respond();
  };
  return { fetchImpl, calls };
}

function jsonResponse(body: unknown, status = 200) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

describe("verifyTurnstile", () => {
  it("POSTs secret, response and remoteip as form data to siteverify, with a 5s timeout", async () => {
    const { fetchImpl, calls } = fakeFetch(jsonResponse({ success: true }));
    await verifyTurnstile("tok-123", "203.0.113.9", { secret: SECRET, fetchImpl });
    expect(TURNSTILE_VERIFY_URL).toBe(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    );
    expect(TURNSTILE_TIMEOUT_MS).toBe(5000);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(TURNSTILE_VERIFY_URL);
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.body).toEqual({
      secret: SECRET,
      response: "tok-123",
      remoteip: "203.0.113.9",
    });
    expect(calls[0]!.signal).toBeInstanceOf(AbortSignal);
  });

  it("omits remoteip when the IP is unknown", async () => {
    const { fetchImpl, calls } = fakeFetch(jsonResponse({ success: true }));
    await verifyTurnstile("tok", undefined, { secret: SECRET, fetchImpl });
    expect(calls[0]!.body).toEqual({ secret: SECRET, response: "tok" });
  });

  it("passed only when Cloudflare says success: true", async () => {
    const { fetchImpl } = fakeFetch(jsonResponse({ success: true }));
    await expect(
      verifyTurnstile("tok", "1.2.3.4", { secret: SECRET, fetchImpl }),
    ).resolves.toBe("passed");
  });

  it("rejected when Cloudflare refuses the visitor's token", async () => {
    const { fetchImpl } = fakeFetch(
      jsonResponse({ success: false, "error-codes": ["invalid-input-response"] }),
    );
    await expect(
      verifyTurnstile("bad", "1.2.3.4", { secret: SECRET, fetchImpl }),
    ).resolves.toBe("rejected");
  });

  it("rejected for a truthy-but-not-true success value", async () => {
    const { fetchImpl } = fakeFetch(jsonResponse({ success: "true" }));
    await expect(
      verifyTurnstile("tok", "1.2.3.4", { secret: SECRET, fetchImpl }),
    ).resolves.toBe("rejected");
  });

  it("unavailable when OUR secret is wrong (not the visitor's fault)", async () => {
    const { fetchImpl } = fakeFetch(
      jsonResponse({ success: false, "error-codes": ["invalid-input-secret"] }),
    );
    await expect(
      verifyTurnstile("tok", "1.2.3.4", { secret: SECRET, fetchImpl }),
    ).resolves.toBe("unavailable");
  });

  it("unavailable on a non-2xx response", async () => {
    const { fetchImpl } = fakeFetch(jsonResponse({ success: true }, 503));
    await expect(
      verifyTurnstile("tok", "1.2.3.4", { secret: SECRET, fetchImpl }),
    ).resolves.toBe("unavailable");
  });

  it("unavailable when fetch throws (network down)", async () => {
    const fetchImpl: TurnstileFetch = async () => {
      throw new TypeError("fetch failed");
    };
    await expect(
      verifyTurnstile("tok", "1.2.3.4", { secret: SECRET, fetchImpl }),
    ).resolves.toBe("unavailable");
  });

  it("unavailable when the body is not JSON", async () => {
    const { fetchImpl } = fakeFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      },
    }));
    await expect(
      verifyTurnstile("tok", "1.2.3.4", { secret: SECRET, fetchImpl }),
    ).resolves.toBe("unavailable");
  });

  it("unavailable when Cloudflare does not answer before the timeout (the request is aborted)", async () => {
    let aborted = false;
    const fetchImpl: TurnstileFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          aborted = true;
          reject(init.signal.reason ?? new Error("aborted"));
        });
      });
    await expect(
      verifyTurnstile("tok", "1.2.3.4", { secret: SECRET, fetchImpl, timeoutMs: 20 }),
    ).resolves.toBe("unavailable");
    expect(aborted).toBe(true);
  });

  it("unavailable without calling Cloudflare when no secret is configured", async () => {
    const { fetchImpl, calls } = fakeFetch(jsonResponse({ success: true }));
    await expect(
      verifyTurnstile("tok", "1.2.3.4", { secret: "", fetchImpl }),
    ).resolves.toBe("unavailable");
    expect(calls).toHaveLength(0);
  });
});

describe("isTurnstileConfigured", () => {
  it("is true only when both the site key and the secret are set", () => {
    expect(isTurnstileConfigured("site", "secret")).toBe(true);
    expect(isTurnstileConfigured("site", undefined)).toBe(false);
    expect(isTurnstileConfigured(undefined, "secret")).toBe(false);
    expect(isTurnstileConfigured("", "")).toBe(false);
  });
});
