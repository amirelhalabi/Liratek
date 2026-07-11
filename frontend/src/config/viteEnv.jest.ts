/**
 * Jest stand-in for viteEnv.ts — ts-jest's CommonJS build cannot compile the
 * `import.meta` syntax. Wired up via moduleNameMapper in jest.config.ts.
 * Tests that need a backend URL override use the runtime global
 * (`globalThis.__LIRATEK_BACKEND_URL`) instead of build-time env.
 */

export const viteBackendUrl: string | undefined = undefined;
