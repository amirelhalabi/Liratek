/**
 * filterReleaseNotesForPlatform — written FIRST (rule 17): the module does
 * not exist yet, so this fails red before
 * frontend/src/features/whatsNew/filterReleaseNotesForPlatform.ts is written.
 *
 * Owner decision: the in-app "What's new" window hides the section for the
 * OTHER platform — web hides "## Desktop app", desktop hides "## Web app".
 * A section is the heading plus everything up to the next "## " heading.
 */
import {
  filterReleaseNotesForPlatform,
  PLATFORM_SECTION_HEADINGS,
} from "../filterReleaseNotesForPlatform";

const markdown = [
  "## 👥 Staff, users & login",
  "- Staff can now open the Transactions page.",
  "",
  "## 🖥 Desktop app",
  "- The updater checks for new versions on launch.",
  "- A second desktop-only bullet.",
  "",
  "## 🌐 Web app",
  "- Settings → Users now really works.",
  "",
  "## 📋 Transactions page",
  "- Web app: the Type filter no longer mixes in other types.",
  "- Desktop app: the updater badge clears once installed.",
].join("\n");

describe("filterReleaseNotesForPlatform", () => {
  it("web platform hides the Desktop section and keeps the Web section", () => {
    const result = filterReleaseNotesForPlatform(markdown, "web");
    expect(result).not.toContain("🖥 Desktop app");
    expect(result).not.toContain("The updater checks for new versions");
    expect(result).not.toContain("A second desktop-only bullet.");
    expect(result).toContain("🌐 Web app");
    expect(result).toContain("Settings → Users now really works.");
  });

  it("desktop platform hides the Web section and keeps the Desktop section", () => {
    const result = filterReleaseNotesForPlatform(markdown, "desktop");
    expect(result).not.toContain("🌐 Web app");
    expect(result).not.toContain("Settings → Users now really works.");
    expect(result).toContain("🖥 Desktop app");
    expect(result).toContain("The updater checks for new versions");
    expect(result).toContain("A second desktop-only bullet.");
  });

  it("leaves other sections, including bullets merely starting with 'Web app:'/'Desktop app:', untouched on both platforms", () => {
    const web = filterReleaseNotesForPlatform(markdown, "web");
    const desktop = filterReleaseNotesForPlatform(markdown, "desktop");

    for (const result of [web, desktop]) {
      expect(result).toContain("Staff can now open the Transactions page.");
      expect(result).toContain(
        "Web app: the Type filter no longer mixes in other types.",
      );
      expect(result).toContain(
        "Desktop app: the updater badge clears once installed.",
      );
    }
  });

  it("tolerates emoji and whitespace variants in the heading", () => {
    const variants = [
      "## Desktop app\n- a",
      "##   🖥 Desktop app\n- a",
      "## 🖥️Desktop app\n- a",
      "##  DESKTOP APP \n- a",
      "##🖥Desktop app\n- a",
    ];
    for (const md of variants) {
      expect(filterReleaseNotesForPlatform(md, "web")).not.toContain("- a");
    }
  });

  it("returns an effectively empty string when the only section is filtered out", () => {
    const onlyDesktop = "## 🖥 Desktop app\n- only desktop thing";
    expect(filterReleaseNotesForPlatform(onlyDesktop, "web").trim()).toBe("");
  });

  it("exposes the two heading names as a single shared constant", () => {
    expect(PLATFORM_SECTION_HEADINGS.desktop).toBe("Desktop app");
    expect(PLATFORM_SECTION_HEADINGS.web).toBe("Web app");
  });
});
