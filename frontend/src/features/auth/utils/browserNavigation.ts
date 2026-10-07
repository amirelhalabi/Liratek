/**
 * Full-page navigations the Google sign-in flow needs (LIRA-280). Kept in one
 * tiny module so tests can replace them — jsdom cannot leave the page.
 *
 * These are deliberately NOT router navigations: Google's consent screen, the
 * www start URL and another shop's subdomain are other origins, and after a
 * hand-off the app must boot again so AuthProvider picks up the new session.
 */

/** This page's hostname (which login page to show depends on it). */
export function currentHostname(): string {
  return window.location.hostname;
}

/** Leave this page for another URL (another origin, or Google). */
export function navigateAway(url: string): void {
  window.location.assign(url);
}

/**
 * Leave this page by POSTing a form (top-level navigation). Used to start
 * Google linking: the link ticket travels in the body, so it never appears
 * in a URL, an access log or the browser history.
 */
export function submitPostForm(
  url: string,
  fields: Record<string, string>,
): void {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = url;
  form.style.display = "none";
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}

/** Restart the app at its home route (after a hand-off stored a session). */
export function reloadAtHome(): void {
  window.history.replaceState(null, "", `${window.location.pathname}#/`);
  window.location.reload();
}

/** The hash route's own query (`#/login?sso=x` -> `sso=x`). */
export function hashQuery(): URLSearchParams {
  const hash = window.location.hash;
  const at = hash.indexOf("?");
  return new URLSearchParams(at >= 0 ? hash.slice(at + 1) : "");
}

/** Drops one parameter from the hash route's query, without navigating, so
 * a one-time token never lingers in the address bar or history. */
export function removeHashParam(name: string): void {
  const hash = window.location.hash;
  const at = hash.indexOf("?");
  if (at < 0) return;
  const params = new URLSearchParams(hash.slice(at + 1));
  if (!params.has(name)) return;
  params.delete(name);
  const rest = params.toString();
  const route = hash.slice(0, at);
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}${route}${rest ? `?${rest}` : ""}`,
  );
}

/** This page's cookies as the browser hands them to script (LIRA-287:
 * remembered shops). Here so tests can replace it — jsdom on localhost
 * cannot hold a cookie for another domain. */
export function readCookies(): string {
  return document.cookie;
}

/** Sets one cookie from a full `name=value; Domain=…; …` string. */
export function writeCookie(cookie: string): void {
  document.cookie = cookie;
}
