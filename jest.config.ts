import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  roots: ['<rootDir>/electron', '<rootDir>/src'], // Look for tests in electron and src folders
  testRegex: '(/__tests__/.*|(\.|)(test|spec))\.tsx?$', // Match .test.ts or .spec.ts files
  // For mocking Electron's ipcMain/ipcRenderer and database
  moduleNameMapper: {
    '^electron$': '<rootDir>/__mocks__/electron.ts',
    '^better-sqlite3$': '<rootDir>/__mocks__/better-sqlite3.ts',
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.node.json',
    },
  },
};

export default config;