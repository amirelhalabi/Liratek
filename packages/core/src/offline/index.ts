/**
 * LIRA-306 offline desktop fallback — the BROWSER-SAFE barrel.
 *
 * Only pure modules (no Node built-in, no `getDatabase`, no tenant context)
 * may be exported here: `browser.ts` re-exports this file, so anything added
 * lands in the Vercel bundle (rule 29, guarded by
 * `browserEntryIsNodeFree.guard.test.ts`). Server-only pieces (replay
 * engine, bindings, merge processor) are exported from `index.ts` directly.
 */
export * from "./idRange.js";
export * from "./channelPolicy.js";
export * from "./reviewKinds.js";
export * from "./idPositions.js";
export * from "./schemaShape.js";
export * from "./tables.js";
export * from "./canonicalJson.js";
