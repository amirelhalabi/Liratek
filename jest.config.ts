import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  roots: ["<rootDir>/electron", "<rootDir>/src"], // Look for tests in electron and src folders
  testRegex: "(/__tests__/.*|(.|)(test|spec))\\.tsx?$", // Match .test.ts or .spec.ts files
  // For mocking Electron's ipcMain/ipcRenderer and database
  moduleNameMapper: {
    "^electron$": "<rootDir>/__mocks__/electron.ts",
    "^better-sqlite3$": "<rootDir>/__mocks__/better-sqlite3.ts",
    // Path aliases
    "^@/(.*)$": "<rootDir>/src/$1",
    "^@/components/(.*)$": "<rootDir>/src/components/$1",
    "^@/pages/(.*)$": "<rootDir>/src/pages/$1",
    "^@/contexts/(.*)$": "<rootDir>/src/contexts/$1",
    "^@/utils/(.*)$": "<rootDir>/src/utils/$1",
    "^@/types/(.*)$": "<rootDir>/src/types/$1",
    "^@/config/(.*)$": "<rootDir>/src/config/$1",
    // Shared package aliases
    "^@shared/(.*)$": "<rootDir>/packages/shared/src/$1",
    "^@liratek/shared$": "<rootDir>/packages/shared/src/index.ts",
  },
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  collectCoverage: true,
  coverageDirectory: "<rootDir>/coverage",
  coverageReporters: ["text", "lcov"],
  // coverageThreshold temporarily disabled until we add more tests
  /*coverageThreshold: {
    global: {
      lines: 70,
      statements: 70,
      functions: 60,
      branches: 50,
    },
  },*/
  transform: {
    "^.+\\.(ts|tsx)$": ["ts-jest", { tsconfig: "tsconfig.jest.json" }],
  },
};

export default config;
