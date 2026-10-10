/** @type {import('jest').Config} */
// Unit tests for the phone's pure modules (LIRA-300), set up as in
// hetivo-mobile-driver. UI flows are checked by hand (specs/300-…/quickstart.md).
module.exports = {
  preset: "jest-expo",
  testMatch: ["<rootDir>/src/**/__tests__/**/*.test.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    // Same mapping as metro.config.js: one core SOURCE file, with core's
    // ESM `./x.js` specifiers resolved to the `.ts` file.
    "^@liratek/core/(.*)$": "<rootDir>/../packages/core/src/$1",
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|react-navigation|@react-navigation/.*|react-native-svg|lucide-react-native|@tanstack/.*)",
  ],
};
