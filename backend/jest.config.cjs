/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testRegex: "(/__tests__/.*|(\\.|/)(test|spec))\\.tsx?$",
  moduleFileExtensions: ["ts", "js", "json"],
  // Limit workers to avoid excessive memory usage (~1.2GB per worker)
  maxWorkers: "50%",
  workerIdleMemoryLimit: "512MB",
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: "<rootDir>/tsconfig.json",
        diagnostics: false,
      },
    ],
  },
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
    // Ensure repository imports like "../connection.js" resolve consistently in tests
    "^\\.\\./connection$": "<rootDir>/src/database/connection.ts",
    "^better-sqlite3$": "<rootDir>/src/__mocks__/better-sqlite3.ts",
    "^electron$": "<rootDir>/src/__mocks__/electron.ts",
    // Map @liratek/core to source files for testing
    "^@liratek/core$": "<rootDir>/../packages/core/src/index.ts",
  },
  setupFilesAfterEnv: ["<rootDir>/src/jest.setup.ts"],
  transformIgnorePatterns: ["node_modules/(?!(@liratek/core)/)"],
};
