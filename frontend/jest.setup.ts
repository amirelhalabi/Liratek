import "@testing-library/jest-dom";

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
