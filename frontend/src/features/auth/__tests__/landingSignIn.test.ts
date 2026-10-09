/** @jest-environment jsdom */
/**
 * The marketing landing page (landing/, liratek.shop) speaks the same words
 * as the app (LIRA-287): "Sign in" — never "Shop login" / "login page" —
 * paired with "Create your shop". Its header carries BOTH: a quiet "Sign in"
 * link to www's sign-in page and a highlighted "Create your shop" button to
 * www's sign-up page, then the language switch (owner addition 2026-10-07).
 * Arabic: "تسجيل الدخول" / "أنشئ متجرك".
 *
 * Since 2026-10-09 the Arabic version is its own page (landing/ar.html,
 * served at /ar) instead of a script that rewrote the English page, so
 * search engines can index it. The language switch is a link between the two.
 *
 * The landing page is static files with no build, so this reads them as
 * text and parses the HTML with the DOM.
 */

import fs from "node:fs";
import path from "node:path";

const LANDING = path.resolve(__dirname, "../../../../../landing");
function parse(file: string): Document {
  const html = fs.readFileSync(path.join(LANDING, file), "utf8");
  return new DOMParser().parseFromString(html, "text/html");
}

const doc = parse("index.html");
const arDoc = parse("ar.html");

/** The Arabic page's text for the element carrying `data-i18n="key"`. */
function arabic(key: string): string | undefined {
  return arDoc.querySelector(`[data-i18n="${key}"]`)?.textContent ?? undefined;
}

describe("landing page header", () => {
  const nav = doc.querySelector("header .topnav")!;

  it("has a quiet 'Sign in' link to www's sign-in page", () => {
    const signIn = nav.querySelector('a[data-i18n="nav.login"]')!;
    expect(signIn.textContent?.trim()).toBe("Sign in");
    expect(signIn.getAttribute("href")).toBe(
      "https://www.liratek.shop/#/login",
    );
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

  it.each([
    ["index.html", doc],
    ["ar.html", arDoc],
  ])(
    "%s orders them: Sign in, Create your shop, then the language switch",
    (_file, page) => {
      const order = Array.from(
        page.querySelector("header .topnav")!.children,
      ).map((el) =>
        el.matches('a[data-i18n="nav.login"]')
          ? "signin"
          : el.matches("a.nav-cta")
            ? "create"
            : el.id === "lang-toggle"
              ? "lang"
              : "other",
      );
      expect(order).toEqual(["signin", "create", "lang"]);
    },
  );

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

describe("English and Arabic pages", () => {
  it("are separate pages that link to each other", () => {
    expect(doc.documentElement.lang).toBe("en");
    expect(arDoc.documentElement.lang).toBe("ar");
    expect(arDoc.documentElement.dir).toBe("rtl");
    expect(doc.getElementById("lang-toggle")?.getAttribute("href")).toBe("/ar");
    expect(arDoc.getElementById("lang-toggle")?.getAttribute("href")).toBe("/");
  });

  // Two hand-kept copies of one page: catch a section, button or link added
  // to one language and forgotten in the other.
  it("carry the same text slots and the same outgoing links", () => {
    const keys = (d: Document) =>
      Array.from(d.querySelectorAll("[data-i18n]")).map((el) =>
        el.getAttribute("data-i18n"),
      );
    expect(keys(arDoc)).toEqual(keys(doc));

    const links = (d: Document) =>
      Array.from(
        d.querySelectorAll("main a, header a.btn, header a.nav-signin"),
      )
        .map((a) => a.getAttribute("href")!.replace("/wa?lang=ar", "/wa"))
        .filter((href) => href !== "/" && href !== "/ar");
    expect(links(arDoc)).toEqual(links(doc));
  });

  it("send Arabic visitors' WhatsApp message in Arabic", () => {
    const wa = Array.from(arDoc.querySelectorAll('a[href^="/wa"]'));
    expect(wa.length).toBeGreaterThan(0);
    wa.forEach((a) => expect(a.getAttribute("href")).toBe("/wa?lang=ar"));
  });

  it.each([
    ["index.html", doc, "https://liratek.shop/"],
    ["ar.html", arDoc, "https://liratek.shop/ar"],
  ])(
    "%s has one h1, its canonical, and both hreflang alternates",
    (_f, page, url) => {
      expect(page.querySelectorAll("h1")).toHaveLength(1);
      expect(
        page.querySelector('link[rel="canonical"]')?.getAttribute("href"),
      ).toBe(url);
      const alt = (lang: string) =>
        page
          .querySelector(`link[rel="alternate"][hreflang="${lang}"]`)
          ?.getAttribute("href");
      expect(alt("en")).toBe("https://liratek.shop/");
      expect(alt("ar")).toBe("https://liratek.shop/ar");
      expect(alt("x-default")).toBe("https://liratek.shop/");
    },
  );
});
