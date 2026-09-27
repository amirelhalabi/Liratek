/**
 * Hides the platform-specific release-notes section that doesn't apply to
 * where the app is running (owner decision — the in-app "What's new" window
 * hides the section for the OTHER platform):
 *  - web app     -> hides "## <emoji> Desktop app"
 *  - desktop app -> hides "## <emoji> Web app"
 *
 * A "section" is a "## " heading plus everything up to the next "## "
 * heading (docs/release-notes/UNRELEASED.md convention: "## <emoji> Area").
 * Every other section — and bullets that merely start with "Web app:" /
 * "Desktop app:" inside an unrelated section — is left completely untouched.
 *
 * PLATFORM_SECTION_HEADINGS is the single source of truth for these two
 * heading names (CLAUDE.md rule 14: don't copy-paste a rule predicate).
 */
export const PLATFORM_SECTION_HEADINGS = {
  desktop: "Desktop app",
  web: "Web app",
} as const;

export type ReleaseNotesPlatform = "web" | "desktop";

const HEADING_LINE_RE = /^##\s*(.*)$/;

/**
 * Strips a leading emoji (or any other leading run of non-alphanumeric
 * characters, which covers multi-codepoint emoji + variation selectors) and
 * surrounding whitespace, then lowercases — so "🖥 Desktop app",
 * "🖥️Desktop app", "  DESKTOP APP" and "Desktop app" all normalize the same.
 */
function normalizeHeadingText(text: string): string {
  return text
    .trim()
    .replace(/^[^A-Za-z0-9]+/, "")
    .trim()
    .toLowerCase();
}

/**
 * Removes the one platform-specific section that does not apply to
 * `platform` from a release entry's Markdown body. Pure and side-effect
 * free — safe to unit test directly, and safe to call once per entry
 * (including every "Earlier updates" entry) from the modal.
 */
export function filterReleaseNotesForPlatform(
  markdown: string,
  platform: ReleaseNotesPlatform,
): string {
  const headingToHide =
    platform === "web"
      ? PLATFORM_SECTION_HEADINGS.desktop
      : PLATFORM_SECTION_HEADINGS.web;
  const targetNormalized = normalizeHeadingText(headingToHide);

  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const kept: string[] = [];
  let hiding = false;

  for (const line of lines) {
    const match = line.trim().match(HEADING_LINE_RE);
    if (match) {
      hiding = normalizeHeadingText(match[1]) === targetNormalized;
    }
    if (!hiding) kept.push(line);
  }

  return kept.join("\n");
}
