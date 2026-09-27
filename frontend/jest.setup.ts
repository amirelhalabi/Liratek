import "@testing-library/jest-dom";
import { TextEncoder, TextDecoder } from "util";

// Polyfill TextEncoder/TextDecoder for jsdom (needed by jsPDF / iobuffer)
if (typeof globalThis.TextEncoder === "undefined") {
  Object.assign(globalThis, { TextEncoder, TextDecoder });
}

// Polyfill ResizeObserver for jsdom — @headlessui/react's `anchor` prop
// (used by the shared <Select>, LIRA-120) drives floating-ui's positioning
// via ResizeObserver, which jsdom does not implement. Without this, any
// test that actually opens/selects on the REAL Select (not a mocked one)
// throws "ResizeObserver is not defined" the moment the option list
// commits a selection — a real gotcha, not specific to one test file.
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverStub {
    observe() {
      /* no-op: jsdom has no layout engine to observe */
    }
    unobserve() {
      /* no-op */
    }
    disconnect() {
      /* no-op */
    }
  }
  Object.assign(globalThis, { ResizeObserver: ResizeObserverStub });
}

// `__APP_VERSION__` is a Vite `define` (vite.config.ts) — esbuild textually
// substitutes it with the root package.json version at build time, so it
// never exists as a real identifier in the shipped bundle. Jest has no such
// substitution step, so any component that reads it (Sidebar's version
// label) needs an actual global to resolve against, the same way the
// ResizeObserver stub above exists only for tests.
if (typeof (globalThis as { __APP_VERSION__?: string }).__APP_VERSION__ === "undefined") {
  Object.assign(globalThis, { __APP_VERSION__: "0.0.0-test" });
}

// Reduce noisy console.error output during tests.
// Tests should assert on error states rather than rely on console output.
const originalConsoleError = console.error;

beforeEach(() => {
  console.error = (..._args: unknown[]) => {
    // silenced
  };
});

afterEach(() => {
  console.error = originalConsoleError;
});
