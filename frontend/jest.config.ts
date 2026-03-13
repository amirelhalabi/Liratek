import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "jsdom",
  roots: ["<rootDir>/src"],
  testRegex: "(/__tests__/.*|(\\.|/)(test|spec))\\.tsx?$",
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json"],
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  // Limit workers to avoid excessive memory usage (~1.2GB per worker)
  maxWorkers: "50%",
  workerIdleMemoryLimit: "512MB",
  transform: {
    "^.+\\.(ts|tsx)$": [
      "ts-jest",
      {
        tsconfig: "<rootDir>/tsconfig.jest.json",
      },
    ],
  },
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "^@shared/(.*)$": "<rootDir>/../packages/shared/src/$1",
    "^@liratek/core$": "<rootDir>/../packages/core/src/index.ts",
    "^@liratek/ui$": "<rootDir>/../packages/ui/src/index.ts",
  },
};

export default config;
