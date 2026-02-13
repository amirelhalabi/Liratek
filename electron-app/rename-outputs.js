// Rename compiled outputs to proper extensions
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, "dist");

// Rename main.js to main.mjs (ESM)
try {
  const mainJs = path.join(distDir, "main.js");
  const mainMjs = path.join(distDir, "main.mjs");
  if (fs.existsSync(mainJs)) {
    fs.renameSync(mainJs, mainMjs);
    console.log("✓ Renamed main.js -> main.mjs");
  }
} catch (err) {
  console.log("main.js rename:", err.message);
}

// Rename preload.js to preload.cjs (CommonJS)
try {
  const preloadJs = path.join(distDir, "preload.js");
  const preloadCjs = path.join(distDir, "preload.cjs");
  if (fs.existsSync(preloadJs)) {
    fs.renameSync(preloadJs, preloadCjs);
    console.log("✓ Renamed preload.js -> preload.cjs");
  }
} catch (err) {
  console.log("preload.js rename:", err.message);
}

// Rename all other .js files in subdirectories to .mjs
function renameRecursive(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      renameRecursive(fullPath);
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".js") &&
      entry.name !== "preload.js"
    ) {
      const newPath = fullPath.replace(/\.js$/, ".mjs");
      try {
        fs.renameSync(fullPath, newPath);
      } catch (err) {
        // Ignore errors
      }
    }
  }
}

try {
  renameRecursive(distDir);
  console.log("✓ Renamed subdirectory .js files to .mjs");
} catch (err) {
  console.log("Subdirectory rename:", err.message);
}
