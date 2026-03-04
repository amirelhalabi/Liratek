/**
 * Auto-updater token for private GitHub releases.
 *
 * In CI builds, the placeholder below is replaced with a real
 * fine-grained GitHub PAT (read-only Contents scope) before
 * TypeScript compilation.  In local dev builds the token stays
 * empty and the updater falls back to process.env.GH_TOKEN
 * (loaded from electron-app/.env).
 */
export const UPDATE_TOKEN: string = "__UPDATE_TOKEN__";
