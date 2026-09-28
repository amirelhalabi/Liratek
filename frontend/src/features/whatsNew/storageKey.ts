/**
 * localStorage key for the "What's new" modal's last-seen version — per
 * owner spec, deliberately namespaced.
 *
 * Deliberately its own module, separate from useWhatsNew.ts: useWhatsNew.ts
 * imports releaseNotes.generated.json as a plain (non-asserted) ESM JSON
 * import, which Vite/Jest resolve fine but Node's own native ESM loader
 * rejects ("needs an import attribute of type: json") — and the Playwright
 * e2e fixtures (tests/e2e-web/fixtures.ts, tests/e2e-electron/fixtures.ts)
 * run under that native loader. Keeping the key here lets the fixtures
 * import the SAME constant the hook uses (CLAUDE.md rule 14: one
 * definition) without pulling in useWhatsNew.ts's JSON import.
 */
export const WHATS_NEW_STORAGE_KEY = "liratek.whatsNew.lastSeenVersion";
