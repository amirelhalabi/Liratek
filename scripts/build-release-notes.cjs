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
 *     [{ version, body, highlights? }, ...]. Deterministic output —
 *     re-running with the same inputs produces byte-identical JSON. Fails
 *     (exit 1, nothing written) if any Highlights image is missing or not
 *     under whats-new/ — see parseHighlightsSection / validateHighlightImages.
 *
 *   node scripts/build-release-notes.cjs --check
 *     Rebuilds in memory and compares against the file on disk, and
 *     re-validates every Highlights image. Exits 1 with a clear message on
 *     either kind of drift (CI drift guard) — does not write anything.
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
/** Where Highlights images live — Vite serves this at `/`, and the desktop
 * build bundles it, so `whats-new/<version>/<file>.png` works offline too. */
const DEFAULT_PUBLIC_DIR = path.join(ROOT, "frontend", "public");
const UNRELEASED_FILENAME = "UNRELEASED.md";
const VERSION_FILE_RE = /^v(\d+)\.(\d+)\.(\d+)\.md$/;

// --- Highlights (owner decisions 2026-10-03) ----------------------------
//
// An optional "## ✨ Highlights" section at the top of a version file holds
// 3-5 items, each written as:
//   ### <Title>
//   <One short paragraph.>
//   ![<alt>](whats-new/<version>/<file>.png)
// The image line is optional. Everything after the Highlights section (or
// the whole file, if there is none) is the normal grouped bullet list and is
// untouched by any of this.

const SECTION_HEADING_RE = /^##\s+(.*)$/; // exactly "## ", not "###"
const HIGHLIGHT_TITLE_RE = /^###\s+(.*)$/;
const HIGHLIGHT_IMAGE_RE = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/;
/** Only a relative path under whats-new/ — no scheme (http:, data:, //…) and no `..`. */
const ALLOWED_IMAGE_SRC_RE = /^whats-new\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

/** Mirrors normalizeHeadingText in filterReleaseNotesForPlatform.ts: strips a
 * leading emoji (or any non-alphanumeric run) and lowercases, so "✨
 * Highlights", "Highlights" and "  HIGHLIGHTS" all match. Kept as its own
 * copy here (scripts/ is plain Node, frontend/src is a separate build) —
 * CLAUDE.md rule 14 is about one SOURCE of a predicate within a layer, not
 * sharing code across the Node/browser boundary. */
function normalizeHeadingText(text) {
  return text.trim().replace(/^[^A-Za-z0-9]+/, "").trim().toLowerCase();
}

function isAllowedImageSrc(src) {
  return typeof src === "string" && !src.includes("..") && ALLOWED_IMAGE_SRC_RE.test(src);
}

/**
 * Extracts the "## Highlights" section (if present) out of `markdown`.
 * Returns `{ highlights, rest, headingText }`:
 *  - `highlights`: parsed items, in source order, each `{ title, summary }`
 *    plus `image: { alt, src }` when an image line followed the paragraph.
 *  - `rest`: the input with the whole Highlights section (heading included)
 *    removed — this is what becomes the entry's `body`.
 *  - `headingText`: the heading's own text (e.g. "✨ Highlights"), or null
 *    when there was no Highlights section — used only by markdownToWhatsApp.
 */
function parseHighlightsSection(markdown) {
  const lines = markdown.split("\n");

  let startIdx = -1;
  let headingText = null;
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].trim().match(SECTION_HEADING_RE);
    if (match && normalizeHeadingText(match[1]) === "highlights") {
      startIdx = i;
      headingText = match[1].trim();
      break;
    }
  }

  if (startIdx === -1) {
    return { highlights: [], rest: markdown, headingText: null };
  }

  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (SECTION_HEADING_RE.test(lines[i].trim())) {
      endIdx = i;
      break;
    }
  }

  const raw = [];
  let current = null;
  for (const line of lines.slice(startIdx + 1, endIdx)) {
    const trimmed = line.trim();
    if (trimmed === "") continue;

    const title = trimmed.match(HIGHLIGHT_TITLE_RE);
    if (title) {
      current = { title: title[1].trim(), summaryLines: [], image: undefined };
      raw.push(current);
      continue;
    }

    const image = trimmed.match(HIGHLIGHT_IMAGE_RE);
    if (image && current && !current.image) {
      current.image = { alt: image[1], src: image[2] };
      continue;
    }

    if (current) current.summaryLines.push(trimmed);
  }

  const highlights = raw.map((item) => ({
    title: item.title,
    summary: item.summaryLines.join(" "),
    ...(item.image ? { image: item.image } : {}),
  }));

  const rest = [...lines.slice(0, startIdx), ...lines.slice(endIdx)].join("\n");

  return { highlights, rest, headingText };
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Reads width/height from a PNG's IHDR (bytes 16-23, big-endian). Returns
 * null if the file is not a PNG. Only .png is supported for Highlights. */
function readPngDimensions(filePath) {
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(24);
    const read = fs.readSync(fd, buf, 0, 24, 0);
    if (read < 24 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Checks every highlight image referenced by `entries` against `publicDir`:
 * the path must be an allowed `whats-new/…` relative path (never an external
 * URL or a `..` escape — CLAUDE.md rendering-safety rule) AND the file must
 * actually exist on disk AND be a landscape PNG (height < width). Returns a list of human-readable problem strings;
 * empty means everything is fine. Pure / side-effect free.
 */
function validateHighlightImages(entries, publicDir = DEFAULT_PUBLIC_DIR) {
  const problems = [];
  for (const entry of entries) {
    for (const highlight of entry.highlights || []) {
      if (!highlight.image) continue;
      const { src } = highlight.image;
      if (!isAllowedImageSrc(src)) {
        problems.push(
          `v${entry.version} "${highlight.title}": image path "${src}" is not allowed — must be a relative path under whats-new/, no scheme and no "..".`,
        );
        continue;
      }
      const filePath = path.join(publicDir, src);
      if (!fs.existsSync(filePath)) {
        problems.push(
          `v${entry.version} "${highlight.title}": image file not found at ${path.relative(ROOT, filePath)}`,
        );
        continue;
      }
      const dims = readPngDimensions(filePath);
      if (!dims) {
        problems.push(
          `v${entry.version} "${highlight.title}": ${src} is not a readable PNG — highlight images must be .png files.`,
        );
      } else if (dims.height >= dims.width) {
        problems.push(
          `v${entry.version} "${highlight.title}": ${src} is ${dims.width}x${dims.height} — highlight images must be landscape (width greater than height).`,
        );
      }
    }
  }
  return problems;
}

/** HTML comments are instructions/authoring notes, never content. */
function stripHtmlComments(markdown) {
  return markdown.replace(/<!--[\s\S]*?-->/g, "");
}

/**
 * Normalizes CRLF and lone-CR line endings to LF. Must be applied to every
 * markdown (and, for --check, JSON) read from disk: `core.autocrlf=true`
 * checks .md files out with CRLF on Windows, while git stores them (and this
 * repo's .gitattributes pins them) as LF — so a Windows working tree and a
 * Linux CI checkout would otherwise produce different generated JSON from
 * the identical committed content. Applying this at every read point makes
 * the output byte-identical regardless of OS or git line-ending settings.
 */
function normalizeLineEndings(text) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
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
    const raw = normalizeLineEndings(fs.readFileSync(filePath, "utf8"));
    const stripped = stripHtmlComments(raw).trim();
    const { highlights, rest } = parseHighlightsSection(stripped);
    const body = rest.trim();
    return {
      version,
      body,
      ...(highlights.length > 0 ? { highlights } : {}),
    };
  });
}

/** Stable, deterministic formatting so re-runs produce identical bytes. */
function serialize(entries) {
  return `${JSON.stringify(entries, null, 2)}\n`;
}

function runBuild({
  releaseNotesDir = DEFAULT_RELEASE_NOTES_DIR,
  outputPath = DEFAULT_OUTPUT_PATH,
  publicDir = DEFAULT_PUBLIC_DIR,
} = {}) {
  const entries = buildReleaseNotes(releaseNotesDir);

  const imageProblems = validateHighlightImages(entries, publicDir);
  if (imageProblems.length > 0) {
    console.error(
      [
        "release-notes:build FAILED — Highlights image problem(s):",
        ...imageProblems.map((p) => `  - ${p}`),
      ].join("\n"),
    );
    process.exitCode = 1;
    return entries;
  }

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
  publicDir = DEFAULT_PUBLIC_DIR,
} = {}) {
  const entries = buildReleaseNotes(releaseNotesDir);
  const expected = serialize(entries);
  // The JSON file on disk may itself have been checked out with CRLF
  // (autocrlf on Windows), even though it's stored as LF in git — normalize
  // before comparing so --check is line-ending-insensitive on both sides.
  const actual = fs.existsSync(outputPath)
    ? normalizeLineEndings(fs.readFileSync(outputPath, "utf8"))
    : null;

  let ok = true;

  if (actual !== expected) {
    console.error(
      [
        "release-notes:check FAILED — releaseNotes.generated.json is stale versus docs/release-notes/v*.md.",
        `  Expected file: ${path.relative(ROOT, outputPath)}`,
        "  Run `yarn release-notes:build` and commit the result.",
      ].join("\n"),
    );
    ok = false;
  }

  const imageProblems = validateHighlightImages(entries, publicDir);
  if (imageProblems.length > 0) {
    console.error(
      [
        "release-notes:check FAILED — Highlights image problem(s):",
        ...imageProblems.map((p) => `  - ${p}`),
      ].join("\n"),
    );
    ok = false;
  }

  if (!ok) {
    process.exitCode = 1;
    return false;
  }

  console.log("release-notes:check — releaseNotes.generated.json is up to date.");
  return true;
}

function convertBoldToAsterisks(text) {
  return text.replace(/\*\*(.+?)\*\*/g, "*$1*");
}

/** Converts "## "/"- " markdown lines to WhatsApp's own emphasis — the
 * non-Highlights part of markdownToWhatsApp, pulled out so it can also run
 * on the tail of a file that starts with a Highlights section. */
function transformPlainLines(text) {
  return convertBoldToAsterisks(text)
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

/** A Highlights item becomes one line — "• *Title*: sentence" — with its
 * image dropped entirely (WhatsApp messages don't carry local file paths). */
function markdownToWhatsApp(markdown) {
  const withoutComments = stripHtmlComments(
    normalizeLineEndings(markdown),
  ).trim();
  const { highlights, rest, headingText } = parseHighlightsSection(withoutComments);

  if (highlights.length === 0) {
    return transformPlainLines(withoutComments);
  }

  const parts = [`*${headingText}*`, ""];
  for (const highlight of highlights) {
    parts.push(`• *${highlight.title}*: ${convertBoldToAsterisks(highlight.summary)}`);
  }

  const restTrimmed = rest.trim();
  if (restTrimmed.length > 0) {
    parts.push("", transformPlainLines(restTrimmed));
  }

  return parts.join("\n");
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
  DEFAULT_PUBLIC_DIR,
  stripHtmlComments,
  normalizeLineEndings,
  compareSemverDesc,
  listVersionFiles,
  versionFromFilename,
  buildReleaseNotes,
  serialize,
  runBuild,
  runCheck,
  parseHighlightsSection,
  validateHighlightImages,
  readPngDimensions,
  isAllowedImageSrc,
  markdownToWhatsApp,
  resolveNotesFile,
  runWhatsapp,
};
