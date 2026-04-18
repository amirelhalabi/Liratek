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
