// Local testing only: run the local frontend against a live tenant.
//   yarn workspace @liratek/frontend dev:tenant   → http://localhost:5176
// Same-origin /api and /socket.io are proxied to the tenant with the Host
// rewritten, so the backend resolves the tenant from the hostname.
// TENANT_URL picks another tenant (default: the test tenant).
// The data is LIVE: anything you confirm writes real rows.
// Never used by `vite build` (deploys read vite.config.ts only), and
// server.proxy exists only in the dev server.
import { defineConfig, mergeConfig } from "vite";
import base from "./vite.config";

const target = process.env.TENANT_URL ?? "https://test.liratek.shop";
export default mergeConfig(
  base,
  defineConfig({
    server: {
      port: 5176,
      strictPort: true,
      proxy: {
        "/api": { target, changeOrigin: true, secure: true },
        "/health": { target, changeOrigin: true, secure: true },
        "/socket.io": { target, changeOrigin: true, secure: true, ws: true },
      },
    },
  }),
);
