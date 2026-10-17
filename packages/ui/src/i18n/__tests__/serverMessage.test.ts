/**
 * LIRA-331 T018: translateServerError (contracts/error-envelope.md rule 6).
 * A known messageKey is translated with its params formatted on the client;
 * anything else falls back to the server's English `error`.
 */
import i18next from "i18next";
import { translateServerError } from "../serverMessage";

const i18n = i18next.createInstance();
void i18n.init({
  lng: "ar",
  fallbackLng: "en",
  initAsync: false,
  interpolation: { escapeValue: false },
  resources: {
    en: { server: { "refund.notEnough": "Cannot refund {{requested}} - only {{available}} available" } },
    ar: { server: { "refund.notEnough": "لا يمكن إرجاع {{requested}} - المتوفر {{available}} فقط" } },
  },
});
// A throwaway instance with its own keys (the app's typed keys do not apply).
const t = i18n.t.bind(i18n) as unknown as (
  key: string,
  options?: Record<string, unknown>,
) => string;

describe("translateServerError", () => {
  it("translates a known key, formatting numeric params en-US", () => {
    expect(
      translateServerError(
        {
          error: "Cannot refund 1500 - only 3 available",
          messageKey: "refund.notEnough",
          messageParams: { requested: 1500, available: 3 },
        },
        t,
      ),
    ).toBe("لا يمكن إرجاع 1,500 - المتوفر 3 فقط");
  });

  it("falls back to the English error for an unknown key", () => {
    expect(
      translateServerError({ error: "Old server text", messageKey: "nope.missing" }, t),
    ).toBe("Old server text");
  });

  it("falls back to the English error when there is no key", () => {
    expect(translateServerError({ error: "Plain refusal" }, t)).toBe("Plain refusal");
  });

  it("gives a generic text when there is nothing at all", () => {
    expect(translateServerError({}, t, "Fallback")).toBe("Fallback");
  });
});
