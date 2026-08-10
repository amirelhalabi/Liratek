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
