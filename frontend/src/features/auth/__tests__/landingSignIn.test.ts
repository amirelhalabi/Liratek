/** @jest-environment jsdom */
/**
 * The marketing landing page (landing/, liratek.shop) speaks the same words
 * as the app (LIRA-287): "Sign in" — never "Shop login" / "login page" —
 * paired with "Create your shop". Its header carries BOTH: a quiet "Sign in"
 * link to www's sign-in page and a highlighted "Create your shop" button to
 * www's sign-up page, then the language toggle (owner addition 2026-10-07).
 * Arabic: "تسجيل الدخول" / "أنشئ متجرك".
 *
 * The landing page is static files with no build, so this reads them as
 * text and parses the HTML with the DOM.
 */

import fs from "node:fs";
import path from "node:path";

const LANDING = path.resolve(__dirname, "../../../../../landing");
const html = fs.readFileSync(path.join(LANDING, "index.html"), "utf8");
const mainJs = fs.readFileSync(path.join(LANDING, "main.js"), "utf8");
const doc = new DOMParser().parseFromString(html, "text/html");

/** The AR table entry for `key`, as written in main.js. */
function arabic(key: string): string | undefined {
  const match = new RegExp(`"${key.replace(".", "\\.")}":\\s*"([^"]*)"`).exec(
    mainJs,
  );
  return match?.[1];
}

describe("landing page header", () => {
  const nav = doc.querySelector("header .topnav")!;

  it("has a quiet 'Sign in' link to www's sign-in page", () => {
    const signIn = nav.querySelector('a[data-i18n="nav.login"]')!;
    expect(signIn.textContent?.trim()).toBe("Sign in");
    expect(signIn.getAttribute("href")).toBe("https://www.liratek.shop/#/login");
    expect(signIn.classList.contains("btn-primary")).toBe(false);
  });

  it("has a highlighted 'Create your shop' button to www's sign-up page", () => {
    const create = nav.querySelector("a.nav-cta")!;
    expect(create.getAttribute("href")).toBe(
      "https://www.liratek.shop/#/signup",
    );
    expect(create.classList.contains("btn-primary")).toBe(true);
    expect(create.querySelector('[data-i18n="nav.signup"]')?.textContent).toBe(
      "Create your shop",
    );
    // A shorter label for phone widths.
    expect(
      create.querySelector('[data-i18n="nav.signupShort"]')?.textContent,
    ).toBe("Create shop");
  });

  it("orders them: Sign in, Create your shop, then the language toggle", () => {
    const order = Array.from(nav.children).map((el) =>
      el.matches('a[data-i18n="nav.login"]')
        ? "signin"
        : el.matches("a.nav-cta")
          ? "create"
          : el.id === "lang-toggle"
            ? "lang"
            : "other",
    );
    expect(order).toEqual(["signin", "create", "lang"]);
  });

  it("has the Arabic labels", () => {
    expect(arabic("nav.login")).toBe("تسجيل الدخول");
    expect(arabic("nav.signup")).toBe("أنشئ متجرك");
    expect(arabic("nav.signupShort")).toBe("أنشئ متجرك");
  });
});

describe("landing page wording", () => {
  it("never says 'Shop login' or 'login page'", () => {
    const text = doc.body.textContent ?? "";
    expect(text).not.toMatch(/shop login/i);
    expect(text).not.toMatch(/login page/i);
    expect(text).not.toMatch(/\blog ?in\b/i);
  });

  it("keeps the in-page 'Create your shop' link and the 'Already a LiraTek shop?' box", () => {
    expect(doc.querySelector('[data-i18n="cta.signup"]')).not.toBeNull();
    expect(doc.querySelector('[data-i18n="login.title"]')?.textContent).toBe(
      "Already a LiraTek shop?",
    );
  });
});
