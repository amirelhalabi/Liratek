/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testRegex: "(/__tests__/.*|(\\.|/)(test|spec))\\.tsx?$",
  moduleFileExtensions: ["ts", "js", "json"],
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: {
          ...require("./tsconfig.json").compilerOptions,
          esModuleInterop: true,
          // Transpile each file on its own, without type-checking: a cold
          // run drops from ~96s to ~15s. Test files are still type-checked
          // by `yarn typecheck` (tsconfig.json includes src/**/*.ts).
          isolatedModules: true,
          ignoreDeprecations: "6.0",
        },
        useESM: false,
      },
    ],
  },
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  setupFilesAfterEnv: ["<rootDir>/src/jest.setup.ts"],
};
