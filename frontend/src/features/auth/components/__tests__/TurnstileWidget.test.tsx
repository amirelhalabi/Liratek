/** @jest-environment jsdom */
/**
 * TurnstileWidget (LIRA-267 US4) — the Cloudflare bot check on the "email me
 * a sign-up link" form.
 *
 *   1. The Cloudflare script is added to the page ONCE, however many widgets
 *      mount (a remount after a refused token must not stack scripts).
 *   2. It renders EXPLICITLY with the site key the server sent, and its
 *      callbacks reach onSuccess / onExpire.
 *   3. Unmounting removes the widget, so a remount starts a fresh challenge —
 *      Turnstile tokens are single-use.
 */

import { render, act } from "@testing-library/react";
import {
  TURNSTILE_SCRIPT_URL,
  __resetTurnstileLoaderForTests,
} from "../turnstileLoader";
import { TurnstileWidget } from "../TurnstileWidget";

interface RenderOpts {
  sitekey: string;
  callback: (token: string) => void;
  "expired-callback": () => void;
  "error-callback": () => void;
}

const renderSpy = jest.fn<string, [HTMLElement, RenderOpts]>();
const removeSpy = jest.fn<void, [string]>();

function scripts() {
  return Array.from(document.querySelectorAll("script")).filter(
    (s) => s.src === TURNSTILE_SCRIPT_URL,
  );
}

function loadScript() {
  window.turnstile = { render: renderSpy, remove: removeSpy, reset: jest.fn() };
  act(() => {
    scripts()[0]!.dispatchEvent(new Event("load"));
  });
}

beforeEach(() => {
  renderSpy.mockReset();
  removeSpy.mockReset();
  renderSpy.mockReturnValue("widget-1");
  document.head.innerHTML = "";
  delete window.turnstile;
  __resetTurnstileLoaderForTests();
});

it("adds the Cloudflare script once for any number of widgets", () => {
  const a = render(<TurnstileWidget siteKey="k" onSuccess={jest.fn()} onExpire={jest.fn()} />);
  render(<TurnstileWidget siteKey="k" onSuccess={jest.fn()} onExpire={jest.fn()} />);
  expect(scripts()).toHaveLength(1);
  a.unmount();
  render(<TurnstileWidget siteKey="k" onSuccess={jest.fn()} onExpire={jest.fn()} />);
  expect(scripts()).toHaveLength(1);
});

it("renders explicitly with the site key and forwards the callbacks", () => {
  const onSuccess = jest.fn();
  const onExpire = jest.fn();
  render(<TurnstileWidget siteKey="site-123" onSuccess={onSuccess} onExpire={onExpire} />);
  expect(renderSpy).not.toHaveBeenCalled();

  loadScript();
  expect(renderSpy).toHaveBeenCalledTimes(1);
  const opts = renderSpy.mock.calls[0]![1];
  expect(opts.sitekey).toBe("site-123");

  opts.callback("tok");
  expect(onSuccess).toHaveBeenCalledWith("tok");
  opts["expired-callback"]();
  opts["error-callback"]();
  expect(onExpire).toHaveBeenCalledTimes(2);
});

it("renders immediately when the script is already loaded, and removes the widget on unmount", () => {
  window.turnstile = { render: renderSpy, remove: removeSpy, reset: jest.fn() };
  const { unmount } = render(
    <TurnstileWidget siteKey="k" onSuccess={jest.fn()} onExpire={jest.fn()} />,
  );
  expect(renderSpy).toHaveBeenCalledTimes(1);
  unmount();
  expect(removeSpy).toHaveBeenCalledWith("widget-1");
});
