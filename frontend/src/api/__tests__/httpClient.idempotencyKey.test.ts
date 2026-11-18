/**
 * LIRA-401 — `requestJson`'s `idempotencyKey` option becomes the
 * `idempotency-key` header the server's replay guard reads, on writes only.
 *
 * Not proven failing-first (rule 17): written alongside the option (new
 * contract), never run against the code without it.
 */

import { requestJson, IDEMPOTENCY_KEY_HEADER } from "../httpClient";

const realFetch = global.fetch;
let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = jest.fn(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => JSON.stringify({ success: true }),
  }));
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = realFetch;
});

function sentHeaders(): Record<string, string> {
  const init = fetchMock.mock.calls[0][1] as {
    headers: Record<string, string>;
  };
  return init.headers;
}

describe("requestJson idempotencyKey", () => {
  it("sends the idempotency-key header on a POST that carries a key", async () => {
    await requestJson("/api/sales/process", {
      method: "POST",
      body: {},
      idempotencyKey: "web-abc123-xyz",
    });
    expect(IDEMPOTENCY_KEY_HEADER).toBe("idempotency-key");
    expect(sentHeaders()["idempotency-key"]).toBe("web-abc123-xyz");
  });

  it("sends no idempotency-key header on a POST without a key", async () => {
    await requestJson("/api/sales/process", { method: "POST", body: {} });
    expect(sentHeaders()).not.toHaveProperty("idempotency-key");
  });

  it("never sends the header on a GET, even when a key is passed", async () => {
    await requestJson("/api/sales", { idempotencyKey: "web-abc123-xyz" });
    expect(sentHeaders()).not.toHaveProperty("idempotency-key");
  });
});
