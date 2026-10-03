/**
 * One parsed "## ✨ Highlights" item (owner decisions 2026-10-03) — a short
 * headline change with an optional screenshot. `image.src` is always a
 * relative path under `whats-new/` (served from frontend/public and bundled
 * into the desktop build); see isAllowedHighlightImageSrc.ts for the
 * rendering-safety whitelist.
 */
export interface ReleaseNoteHighlight {
  title: string;
  summary: string;
  image?: { src: string; alt: string };
}

/**
 * One entry of frontend/src/features/whatsNew/releaseNotes.generated.json,
 * as written by scripts/build-release-notes.cjs. `body` is the release's
 * Markdown (headings/bullets/bold/paragraphs only — see renderReleaseNotes.tsx
 * for the exact subset), with any HTML comment already stripped and the
 * Highlights section (if any) already extracted into `highlights`. A version
 * with no Highlights section has no `highlights` key at all (backward
 * compatible with every release note written before 2026-10-03).
 */
export interface ReleaseNoteEntry {
  version: string;
  body: string;
  highlights?: ReleaseNoteHighlight[];
}
