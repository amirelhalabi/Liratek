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
    "^@liratek/core$": "<rootDir>/../packages/core/src/index.ts",
    "^@liratek/ui$": "<rootDir>/../packages/ui/src/index.ts",
  },
};

export default config;
