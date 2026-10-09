/**
 * LIRA-295 (owner decision 2026-10-09): the web app has NO UI scale — the
 * browser's own zoom (Ctrl/⌘ + / −) does it properly. CSS `zoom` on <html>
 * multiplied every viewport-height size (h-screen, max-h-[90vh]) by the scale,
 * so at 125% the bottom of each page and modal fell below the window and the
 * `h-screen overflow-hidden` shell would not scroll to it. Desktop keeps the
 * setting through Electron's real zoom factor.
 *
 * Asserted through spies, not getPropertyValue: jsdom's CSSStyleDeclaration
 * silently drops the non-standard `zoom` property, so reading it back is ""
 * whether or not the code set it — a first version of this test passed
 * against the unfixed code for exactly that reason.
 */
import { applyUiScale } from "../uiScale";

type ApiWindow = {
  api?: { display?: { setZoomFactor?: (n: number) => void } };
};

let setProperty: jest.SpyInstance;
let removeProperty: jest.SpyInstance;

beforeEach(() => {
  setProperty = jest.spyOn(document.documentElement.style, "setProperty");
  removeProperty = jest.spyOn(document.documentElement.style, "removeProperty");
});

afterEach(() => {
  jest.restoreAllMocks();
  delete (window as unknown as ApiWindow).api;
});

it("web: never applies CSS zoom, whatever scale is asked for", () => {
  applyUiScale(1.25);
  expect(setProperty).not.toHaveBeenCalledWith("zoom", expect.anything());
});

it("web: clears a CSS zoom left by an older build", () => {
  applyUiScale(1.25);
  expect(removeProperty).toHaveBeenCalledWith("zoom");
});

it("desktop: still sets Electron's zoom factor, and no CSS zoom", () => {
  const setZoomFactor = jest.fn();
  (window as unknown as ApiWindow).api = { display: { setZoomFactor } };
  applyUiScale(1.25);
  expect(setZoomFactor).toHaveBeenCalledWith(1.25);
  expect(setProperty).not.toHaveBeenCalledWith("zoom", expect.anything());
});
