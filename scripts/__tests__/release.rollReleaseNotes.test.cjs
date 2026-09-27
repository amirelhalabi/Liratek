#!/usr/bin/env node
"use strict";

/**
 * Node-native tests for scripts/release.cjs's rollReleaseNotes() — the
 * UNRELEASED.md -> vX.Y.Z.md move that must happen before `git add -A` in
 * `yarn release`. Uses injected `unreleasedPath`/`releaseNotesDir`
 * overrides so this NEVER touches the real docs/release-notes/*.md files
 * (those are owned by the parallel doc-authoring work, not this script).
 *
 * Run directly: node scripts/__tests__/release.rollReleaseNotes.test.cjs
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { rollReleaseNotes, extractHeaderComment, bumpVersion } = require("../release.cjs");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "liratek-release-"));
}

const HEADER = [
  "<!--",
  "  LiraTek release notes — UNRELEASED (CLAUDE.md rule 30)",
  "  Some instructions here.",
  "-->",
].join("\n");

test("bumpVersion still does patch/minor/major/exact (unchanged behaviour)", () => {
  assert.equal(bumpVersion("1.2.3", "patch"), "1.2.4");
  assert.equal(bumpVersion("1.2.3", "minor"), "1.3.0");
  assert.equal(bumpVersion("1.2.3", "major"), "2.0.0");
  assert.equal(bumpVersion("1.2.3", "1.9.9"), "1.9.9");
});

test("extractHeaderComment returns the leading HTML comment verbatim", () => {
  const md = `${HEADER}\n\n## Area\n- thing\n`;
  assert.equal(extractHeaderComment(md), HEADER);
});

test("extractHeaderComment returns empty string when there is no leading comment", () => {
  assert.equal(extractHeaderComment("## Area\n- thing\n"), "");
});

test("rollReleaseNotes moves real content into vX.Y.Z.md and resets UNRELEASED.md to just its header", () => {
  const dir = makeTempDir();
  const unreleasedPath = path.join(dir, "UNRELEASED.md");
  fs.writeFileSync(
    unreleasedPath,
    `${HEADER}\n\n## Staff\n- did a thing\n`,
  );

  rollReleaseNotes("1.31.0", { unreleasedPath, releaseNotesDir: dir });

  const versionFile = path.join(dir, "v1.31.0.md");
  assert.ok(fs.existsSync(versionFile), "vX.Y.Z.md must be created");
  const versionContent = fs.readFileSync(versionFile, "utf8");
  assert.ok(versionContent.includes("## Staff"));
  assert.ok(versionContent.includes("- did a thing"));
  assert.ok(
    !versionContent.includes("LiraTek release notes"),
    "the instructional header must not leak into the released file",
  );

  const resetUnreleased = fs.readFileSync(unreleasedPath, "utf8");
  assert.equal(
    resetUnreleased,
    `${HEADER}\n`,
    "UNRELEASED.md must be reset to EXACTLY its original header",
  );
});

test("rollReleaseNotes warns and does nothing when UNRELEASED.md has only the header (no real content)", () => {
  const dir = makeTempDir();
  const unreleasedPath = path.join(dir, "UNRELEASED.md");
  fs.writeFileSync(unreleasedPath, `${HEADER}\n\n   \n`);

  const originalWarn = console.warn;
  let warned = "";
  console.warn = (msg) => {
    warned += msg;
  };
  try {
    rollReleaseNotes("1.31.0", { unreleasedPath, releaseNotesDir: dir });
  } finally {
    console.warn = originalWarn;
  }

  assert.ok(warned.includes("no release notes"));
  assert.ok(
    !fs.existsSync(path.join(dir, "v1.31.0.md")),
    "no version file should be created when there is nothing to move",
  );
  // UNRELEASED.md is left untouched in this branch.
  assert.equal(fs.readFileSync(unreleasedPath, "utf8"), `${HEADER}\n\n   \n`);
});

test("rollReleaseNotes warns and does nothing when UNRELEASED.md does not exist", () => {
  const dir = makeTempDir();
  const unreleasedPath = path.join(dir, "UNRELEASED.md"); // never written

  const originalWarn = console.warn;
  let warned = "";
  console.warn = (msg) => {
    warned += msg;
  };
  try {
    rollReleaseNotes("1.31.0", { unreleasedPath, releaseNotesDir: dir });
  } finally {
    console.warn = originalWarn;
  }

  assert.ok(warned.includes("not found"));
  assert.ok(!fs.existsSync(path.join(dir, "v1.31.0.md")));
});
