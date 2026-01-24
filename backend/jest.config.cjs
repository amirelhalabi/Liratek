/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  globals: {
    'ts-jest': {
      diagnostics: false,
    },
  },
  roots: ['<rootDir>/src'],
  testRegex: '(/__tests__/.*|(\\.|/)(test|spec))\\.tsx?$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    // Ensure repository imports like "../connection.js" resolve consistently in tests
    '^\\.\\./connection$': '<rootDir>/src/database/connection.ts',
    '^better-sqlite3$': '<rootDir>/src/__mocks__/better-sqlite3.ts',
    '^electron$': '<rootDir>/src/__mocks__/electron.ts',
  },
};
