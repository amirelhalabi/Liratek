import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "jsdom",
  roots: ["<rootDir>/src"],
  testRegex: "(/__tests__/.*|(\\.|/)(test|spec))\\.tsx?$",
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json"],
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  transform: {
    "^.+\\.(ts|tsx)$": [
      "ts-jest",
      { tsconfig: "<rootDir>/tsconfig.jest.json" },
    ],
  },
  moduleNameMapper: {
    // Must precede the generic "^@/(.*)$" alias: viteEnv.ts touches
    // `import.meta`, which ts-jest's CommonJS build cannot compile (TS1343).
    "^@/config/viteEnv$": "<rootDir>/src/config/viteEnv.jest.ts",
    "^@/(.*)$": "<rootDir>/src/$1",
    "^@shared/(.*)$": "<rootDir>/../packages/shared/src/$1",
    // Resolve to the BROWSER entry, the same one vite.config.ts aliases for
    // the real renderer build. The Node entry (src/index.ts) re-exports
    // ./db/dbPath.js and friends at module load, so any frontend test whose
    // import chain reaches @liratek/core died with "Cannot find module
    // './db/dbPath.js'" — which tests had been papering over by mocking the
    // whole package. Pointing at browser.ts makes jest load what the app
    // actually loads (and is the same entry-point split that caused the
    // LIRA-090 renderer crash when a symbol was missing from browser.ts).
    "^@liratek/core$": "<rootDir>/../packages/core/src/browser.ts",
    // Core's sources use ESM-style ".js" specifiers on relative imports, which
    // ts-jest's CommonJS build cannot resolve to the ".ts" files on disk.
    // Same mapper packages/core/jest.config.cjs:20 already uses; needed here
    // now that a frontend module really loads core instead of mocking it.
    "^(\\.{1,2}/.*)\\.js$": "$1",
    "^@liratek/ui$": "<rootDir>/../packages/ui/src/index.ts",
  },
};

export default config;
