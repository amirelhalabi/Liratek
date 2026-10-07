/**
 * LIRA-282 — `getLoadErrorMessage`: a page that failed to LOAD shows its own
 * generic message, except when the server rate-limited the request (HTTP
 * 429), where the server's message tells the cashier what to do.
 */
import { getLoadErrorMessage } from "../apiErrorMessage";

const FALLBACK = "Failed to load data. Tap refresh to retry.";
const RATE_LIMIT_MESSAGE =
  "Too many requests — please wait a minute and try again.";

describe("getLoadErrorMessage", () => {
  it("returns the server message for a thrown 429 ApiError", () => {
    expect(
      getLoadErrorMessage(
        { status: 429, message: RATE_LIMIT_MESSAGE },
        FALLBACK,
      ),
    ).toBe(RATE_LIMIT_MESSAGE);
  });

  it("still says to wait when a 429 arrives without a usable message", () => {
    expect(getLoadErrorMessage({ status: 429, message: "" }, FALLBACK)).toBe(
      RATE_LIMIT_MESSAGE,
    );
  });

  it("keeps the fallback for any other failure", () => {
    expect(
      getLoadErrorMessage({ status: 500, message: "boom" }, FALLBACK),
    ).toBe(FALLBACK);
    expect(getLoadErrorMessage(new Error("network"), FALLBACK)).toBe(FALLBACK);
    expect(getLoadErrorMessage(undefined, FALLBACK)).toBe(FALLBACK);
  });
});
