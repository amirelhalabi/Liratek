import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores(["dist", "dist-electron", "release", "coverage", "build"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      // Allow any in specific cases - warn instead of error
      "@typescript-eslint/no-explicit-any": "warn",
      // Allow unused vars starting with underscore
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // Allow require in specific files (electron main process)
      "@typescript-eslint/no-require-imports": "warn",
      // Allow empty catch blocks (common pattern for error suppression)
      "no-empty": ["error", { allowEmptyCatch: true }],
      // Disable react-hooks immutability rule (too strict for function hoisting)
      "react-hooks/immutability": "off",
      // Warn instead of error for set-state-in-effect (valid patterns exist)
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  // Disable strict rules for test files and mocks
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/__tests__/**", "__mocks__/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unsafe-function-type": "off",
    },
  },
  // Allow context + hook exports together (common React pattern)
  {
    files: ["**/*Context.tsx", "**/context/**/*.tsx"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
]);
