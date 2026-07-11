/**
 * Build-time Vite env access, isolated in its own module.
 *
 * ts-jest compiles with module=CommonJS (tsconfig.jest.json), where the
 * `import.meta` syntax is a compile error (TS1343) in any file a test
 * transitively imports — runtime `typeof import.meta` guards can't help
 * because the error happens at compile time. Jest maps this module to
 * viteEnv.jest.ts (see frontend/jest.config.ts moduleNameMapper), so code
 * that needs Vite env vars must read them through here instead of touching
 * `import.meta` directly.
 */

/**
 * VITE_BACKEND_URL — set by `yarn dev:web` so the web backend can live off
 * the default port when something else (e.g. a Docker container) squats it.
 */
export const viteBackendUrl: string | undefined = import.meta.env
  .VITE_BACKEND_URL as string | undefined;
