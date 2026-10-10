// Expo SDK 52+ detects the Yarn workspace on its own (watch folders and
// node_modules paths), as in hetivo-mobile-driver.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// `@liratek/core/<module>` maps to a single core SOURCE file
// (packages/core/src/<module>.ts). Never the package entry: core's main is the
// Node build (better-sqlite3), and the browser.ts barrel reaches DOM-only code.
// Import only leaf modules the phone needs (validators, pure utils).
const coreSrc = path.resolve(__dirname, "../packages/core/src");
const CORE_PREFIX = "@liratek/core/";
// `@liratek/ui/<module>` maps to a single PURE file of packages/ui/src (e.g.
// utils/customerAccount). The package itself is DOM-only — never import its
// entry or a component from the phone.
const uiSrc = path.resolve(__dirname, "../packages/ui/src");
const UI_PREFIX = "@liratek/ui/";

// The monorepo root is watched (workspace auto-detection), but other work in
// this repo rebuilds core and re-copies node_modules/@liratek/core while the
// dev server runs, which corrupted Metro's file map ("already exists in the
// file map as a file") and broke every core import. The phone never needs the
// built core copy, any dist output, or the other apps, so keep them out.
const root = path.resolve(__dirname, "..");
const escape = (p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const defaultBlockList = config.resolver.blockList;
config.resolver.blockList = [
  ...(Array.isArray(defaultBlockList) ? defaultBlockList : defaultBlockList ? [defaultBlockList] : []),
  new RegExp(`^${escape(path.join(root, "node_modules/@liratek/core"))}(/.*)?$`),
  new RegExp(`^${escape(path.join(root, "packages/core/dist"))}(/.*)?$`),
  new RegExp(`^${escape(path.join(root, "frontend"))}(/.*)?$`),
  new RegExp(`^${escape(path.join(root, "backend"))}(/.*)?$`),
  new RegExp(`^${escape(path.join(root, "electron-app"))}(/.*)?$`),
  new RegExp(`^${escape(path.join(root, "dist-electron"))}(/.*)?$`),
];

const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = originalResolveRequest ?? context.resolveRequest;
  if (moduleName.startsWith(CORE_PREFIX)) {
    const target = path.join(coreSrc, moduleName.slice(CORE_PREFIX.length));
    return resolve(context, target, platform);
  }
  if (moduleName.startsWith(UI_PREFIX)) {
    return resolve(context, path.join(uiSrc, moduleName.slice(UI_PREFIX.length)), platform);
  }
  // Core is written as ESM TypeScript with `./x.js` specifiers; map them to
  // the `.ts` source when the importer lives in core.
  if (
    context.originModulePath.startsWith(coreSrc) &&
    moduleName.startsWith(".") &&
    moduleName.endsWith(".js")
  ) {
    return resolve(context, moduleName.slice(0, -3), platform);
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;
