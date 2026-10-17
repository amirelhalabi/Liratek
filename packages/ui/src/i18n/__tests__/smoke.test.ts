/**
 * LIRA-331 T002: proves packages/ui tests run under the frontend jest config
 * (roots include ../packages/ui/src) and that i18next / react-i18next load
 * under ts-jest's CommonJS build.
 */
import i18next from "i18next";
import { initReactI18next } from "react-i18next";

describe("packages/ui i18n smoke", () => {
  it("loads i18next and react-i18next and translates synchronously", () => {
    const instance = i18next.createInstance();
    void instance.use(initReactI18next).init({
      lng: "en",
      initAsync: false,
      resources: { en: { common: { hello: "Hello" } } },
      defaultNS: "common",
    });
    // The app augments i18next with typed keys; this throwaway instance has its own.
    const t = instance.t as unknown as (key: string) => string;
    expect(t("hello")).toBe("Hello");
  });
});
