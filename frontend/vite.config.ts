import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import path from "path";
import { readFileSync } from "fs";

const rootPkg = JSON.parse(
  readFileSync(path.resolve(__dirname, "../package.json"), "utf-8"),
);

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), svgr()],
  define: {
    __APP_VERSION__: JSON.stringify(rootPkg.version),
  },
  // Use relative paths for Electron file:// protocol
  base: "./",
  resolve: {
    alias: {
      // @liratek/core: browser-safe entry (excludes Node.js-only modules)
      "@liratek/core": path.resolve(
        __dirname,
        "../packages/core/src/browser.ts",
      ),
      "@liratek/ui": path.resolve(__dirname, "../packages/ui/src/index.ts"),
      "@shared": path.resolve(__dirname, "../packages/core/src"),
      // General @/ alias - this will match all @/... imports
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    // Pre-transform the heaviest module graphs as soon as the dev server
    // starts. Without this, the FIRST route navigation (dev or e2e) pays a
    // ~10s on-demand compile toll for the shared graph (@liratek/ui source
    // alias, icon barrels, TanStack) — observed as one arbitrary e2e test
    // taking 10s while identical siblings take <1s. Warmup runs concurrently
    // with the Electron boot / setup wizard, so the cost disappears.
    warmup: {
      clientFiles: [
        "./src/main.tsx",
        "./src/app/App.tsx",
        "./src/features/custom-services/pages/CustomServices/index.tsx",
        "./src/features/recharge/pages/Recharge/index.tsx",
        "./src/features/loto/pages/Loto/index.tsx",
        "./src/features/debts/pages/Debts/index.tsx",
        "./src/features/sales/pages/POS/index.tsx",
        "../packages/ui/src/index.ts",
      ],
    },
  },
  build: {
    // Electron loads local files — chunk size warning not relevant for desktop apps
    chunkSizeWarningLimit: 1200,
    minify: "esbuild",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom"],
          ui: ["lucide-react"],
        },
      },
    },
  },
});
