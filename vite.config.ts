import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Shared package aliases
      "@liratek/shared": path.resolve(__dirname, "./packages/shared/src/index.ts"),
      "@shared": path.resolve(__dirname, "./packages/shared/src"),
      // General @/ alias - this will match all @/... imports
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
