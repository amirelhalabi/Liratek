/** @jest-environment jsdom */
/**
 * The emailed invite link is `<base>/signup?invite=<token>` (core builds it),
 * but the app routes with a HashRouter: on that URL the router sees an empty
 * hash and `useSearchParams` never sees `invite`, so the person would land on
 * the login page instead of the sign-up form. `normalizeSignupLink()` runs at
 * boot and moves the path + query into the hash.
 */

import { normalizeSignupLink } from "../normalizeSignupLink";

function at(url: string) {
  window.history.replaceState(null, "", url);
}

afterEach(() => at("/"));

it("moves /signup?invite=… into the hash route", () => {
  at("/signup?invite=abc-123_XYZ");
  expect(normalizeSignupLink()).toBe(true);
  expect(window.location.pathname).toBe("/");
  expect(window.location.search).toBe("");
  expect(window.location.hash).toBe("#/signup?invite=abc-123_XYZ");
});

it("accepts a trailing slash", () => {
  at("/signup/?invite=t");
  expect(normalizeSignupLink()).toBe(true);
  expect(window.location.hash).toBe("#/signup?invite=t");
});

it("leaves every other URL alone", () => {
  for (const url of ["/", "/?impersonation_token=x", "/login", "/#/signup?invite=t"]) {
    at(url);
    const before = window.location.href;
    expect(normalizeSignupLink()).toBe(false);
    expect(window.location.href).toBe(before);
  }
});

it("does not override an existing hash route", () => {
  at("/signup?invite=t#/login");
  expect(normalizeSignupLink()).toBe(false);
  expect(window.location.hash).toBe("#/login");
});
