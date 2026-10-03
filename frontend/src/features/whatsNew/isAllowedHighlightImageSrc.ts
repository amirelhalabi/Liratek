/**
 * Rendering-safety whitelist (CLAUDE.md rule 19-adjacent + owner decisions
 * 2026-10-03): a Highlight image `src` must be a plain relative path under
 * `whats-new/` — no URI scheme (http:, https:, data:, //…) and no `..`
 * escape. A release-notes typo (or a compromised/careless edit of a .md
 * file) can therefore never make the "What's new" modal load an external
 * URL. The build script (scripts/build-release-notes.cjs
 * `isAllowedImageSrc`) enforces the identical rule at build time — this is
 * the runtime belt-and-suspenders copy, since the modal must never trust
 * data merely because it shipped.
 *
 * Kept in its own module (not HighlightCards.tsx) so that file stays
 * component-only — react-refresh/only-export-components.
 */
const ALLOWED_IMAGE_SRC_RE = /^whats-new\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

export function isAllowedHighlightImageSrc(src: string | undefined | null): src is string {
  return typeof src === "string" && !src.includes("..") && ALLOWED_IMAGE_SRC_RE.test(src);
}
