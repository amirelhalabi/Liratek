import "@testing-library/jest-dom";
import { TextEncoder, TextDecoder } from "util";

// Polyfill TextEncoder/TextDecoder for jsdom (needed by jsPDF / iobuffer)
if (typeof globalThis.TextEncoder === "undefined") {
  Object.assign(globalThis, { TextEncoder, TextDecoder });
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
