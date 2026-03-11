#!/usr/bin/env node
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");

try {
  execSync("npx tsc -p tsconfig.json --noEmit", {
    cwd: rootDir,
    stdio: "inherit",
  });
} catch (error) {
  process.exit(error.status || 1);
}
