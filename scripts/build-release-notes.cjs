#!/usr/bin/env node
"use strict";

/**
 * LiraTek release-notes pipeline (plain Node, no dependencies).
 *
 * Source of truth: docs/release-notes/UNRELEASED.md (accumulates notes
 * between releases) + docs/release-notes/vX.Y.Z.md (one file per release,
 * written by `yarn release` — see scripts/release.cjs).
 *
 * Modes:
 *   node scripts/build-release-notes.cjs
 *     Reads every docs/release-notes/v*.md, strips HTML comments, sorts
 *     newest-first by semver, and writes
 *     frontend/src/features/whatsNew/releaseNotes.generated.json as
 *     [{ version, body }, ...]. Deterministic output — re-running with the
 *     same inputs produces byte-identical JSON.
 *
 *   node scripts/build-release-notes.cjs --check
 *     Rebuilds in memory and compares against the file on disk. Exits 1
 *     with a clear message if they differ (CI drift guard) — does not
 *     write anything.
 *
 *   node scripts/build-release-notes.cjs --whatsapp <version|unreleased>
 *     Prints a WhatsApp-formatted copy of one release's notes (or the
 *     pending UNRELEASED.md) to stdout, for pasting into a chat:
 *       "## X"    -> "*X*"
 *       "- item"  -> "• item"
 *       "**b**"   -> "*b*"
 *     Blank lines are preserved.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_RELEASE_NOTES_DIR = path.join(ROOT, "docs", "release-notes");
const DEFAULT_OUTPUT_PATH = path.join(
  ROOT,
  "frontend",
  "src",
  "features",
  "whatsNew",
  "releaseNotes.generated.json",
);
const UNRELEASED_FILENAME = "UNRELEASED.md";
const VERSION_FILE_RE = /^v(\d+)\.(\d+)\.(\d+)\.md$/;

/** HTML comments are instructions/authoring notes, never content. */
function stripHtmlComments(markdown) {
  return markdown.replace(/<!--[\s\S]*?-->/g, "");
}

/**
 * Descending semver comparator (newest first). Deliberately not a generic
 * semver library — this repo only ever writes plain X.Y.Z release-note
 * filenames, so a tiny numeric comparator is the whole job.
 */
function compareSemverDesc(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pb[i] || 0) - (pa[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function listVersionFiles(releaseNotesDir) {
  if (!fs.existsSync(releaseNotesDir)) return [];
  return fs
    .readdirSync(releaseNotesDir)
    .filter((f) => VERSION_FILE_RE.test(f));
}

function versionFromFilename(filename) {
  const match = filename.match(VERSION_FILE_RE);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : null;
}

/** Reads every vX.Y.Z.md in `releaseNotesDir`, newest version first. */
function buildReleaseNotes(releaseNotesDir = DEFAULT_RELEASE_NOTES_DIR) {
  const versions = listVersionFiles(releaseNotesDir)
    .map(versionFromFilename)
    .sort(compareSemverDesc);

  return versions.map((version) => {
    const filePath = path.join(releaseNotesDir, `v${version}.md`);
    const raw = fs.readFileSync(filePath, "utf8");
    const body = stripHtmlComments(raw).trim();
    return { version, body };
  });
}

/** Stable, deterministic formatting so re-runs produce identical bytes. */
function serialize(entries) {
  return `${JSON.stringify(entries, null, 2)}\n`;
}

function runBuild({
  releaseNotesDir = DEFAULT_RELEASE_NOTES_DIR,
  outputPath = DEFAULT_OUTPUT_PATH,
} = {}) {
  const entries = buildReleaseNotes(releaseNotesDir);
  const json = serialize(entries);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, json);
  console.log(
    `release-notes:build — wrote ${entries.length} release version(s) to ${path.relative(ROOT, outputPath)}`,
  );
  return entries;
}

/** Returns true/false; sets process.exitCode = 1 on staleness (never calls process.exit). */
function runCheck({
  releaseNotesDir = DEFAULT_RELEASE_NOTES_DIR,
  outputPath = DEFAULT_OUTPUT_PATH,
} = {}) {
  const expected = serialize(buildReleaseNotes(releaseNotesDir));
  const actual = fs.existsSync(outputPath)
    ? fs.readFileSync(outputPath, "utf8")
    : null;

  if (actual === expected) {
    console.log("release-notes:check — releaseNotes.generated.json is up to date.");
    return true;
  }

  console.error(
    [
      "release-notes:check FAILED — releaseNotes.generated.json is stale versus docs/release-notes/v*.md.",
      `  Expected file: ${path.relative(ROOT, outputPath)}`,
      "  Run `yarn release-notes:build` and commit the result.",
    ].join("\n"),
  );
  process.exitCode = 1;
  return false;
}

function markdownToWhatsApp(markdown) {
  const withoutComments = stripHtmlComments(markdown).trim();
  const boldConverted = withoutComments.replace(/\*\*(.+?)\*\*/g, "*$1*");

  return boldConverted
    .split("\n")
    .map((line) => {
      const heading = line.match(/^(#{1,6})\s+(.*)$/);
      if (heading) return `*${heading[2].trim()}*`;

      const bullet = line.match(/^(\s*)-\s+(.*)$/);
      if (bullet) return `${bullet[1]}• ${bullet[2]}`;

      return line;
    })
    .join("\n");
}

function resolveNotesFile(target, releaseNotesDir = DEFAULT_RELEASE_NOTES_DIR) {
  const normalized = String(target).trim().toLowerCase();
  if (normalized === "unreleased") {
    return path.join(releaseNotesDir, UNRELEASED_FILENAME);
  }
  const version = normalized.replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(
      `Invalid target "${target}" — expected X.Y.Z, vX.Y.Z, or "unreleased".`,
    );
  }
  return path.join(releaseNotesDir, `v${version}.md`);
}

function runWhatsapp(target, releaseNotesDir = DEFAULT_RELEASE_NOTES_DIR) {
  const filePath = resolveNotesFile(target, releaseNotesDir);
  if (!fs.existsSync(filePath)) {
    console.error(
      `No release notes file found: ${path.relative(ROOT, filePath)}`,
    );
    process.exitCode = 1;
    return;
  }
  const raw = fs.readFileSync(filePath, "utf8");
  console.log(markdownToWhatsApp(raw));
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes("--check")) {
    const ok = runCheck();
    process.exit(ok ? 0 : 1);
    return;
  }

  const waIndex = args.indexOf("--whatsapp");
  if (waIndex !== -1) {
    const target = args[waIndex + 1];
    if (!target) {
      console.error(
        "Usage: node scripts/build-release-notes.cjs --whatsapp <version|unreleased>",
      );
      process.exit(1);
      return;
    }
    runWhatsapp(target);
    return;
  }

  runBuild();
}

if (require.main === module) {
  main();
}

module.exports = {
  DEFAULT_RELEASE_NOTES_DIR,
  DEFAULT_OUTPUT_PATH,
  stripHtmlComments,
  compareSemverDesc,
  listVersionFiles,
  versionFromFilename,
  buildReleaseNotes,
  serialize,
  runBuild,
  runCheck,
  markdownToWhatsApp,
  resolveNotesFile,
  runWhatsapp,
};
