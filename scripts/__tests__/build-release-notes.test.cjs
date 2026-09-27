#!/usr/bin/env node
"use strict";

/**
 * Node-native tests (no framework, no new dependency) for
 * scripts/build-release-notes.cjs — rule 17: this file is written and run
 * FIRST, against code that does not exist yet, so it fails red before the
 * script is implemented.
 *
 * Run directly: node scripts/__tests__/build-release-notes.test.cjs
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const mod = require("../build-release-notes.cjs");

function makeTempReleaseNotesDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "liratek-release-notes-"));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

test("compareSemverDesc sorts newest-first, numerically (not lexically)", () => {
  const versions = ["1.2.0", "1.10.0", "1.2.10", "2.0.0", "1.9.9"];
  versions.sort(mod.compareSemverDesc);
  assert.deepEqual(versions, ["2.0.0", "1.10.0", "1.9.9", "1.2.10", "1.2.0"]);
});

test("buildReleaseNotes reads v*.md files, strips HTML comments, sorts newest-first", () => {
  const dir = makeTempReleaseNotesDir({
    "v1.0.0.md": "## Area\n- old thing\n",
    "v1.2.0.md": "<!-- internal note, not content -->\n## Area\n- newer thing\n",
    "v1.10.0.md": "## Area\n- newest thing\n",
    "UNRELEASED.md": "<!-- instructions -->\n## Area\n- not yet released\n",
    "not-a-release.txt": "ignored",
  });

  const entries = mod.buildReleaseNotes(dir);

  assert.deepEqual(
    entries.map((e) => e.version),
    ["1.10.0", "1.2.0", "1.0.0"],
    "UNRELEASED.md and non v*.md files must be excluded, newest version first",
  );
  assert.equal(entries[1].version, "1.2.0");
  assert.ok(
    !entries[1].body.includes("internal note"),
    "HTML comments must be stripped from the body",
  );
  assert.ok(entries[1].body.includes("newer thing"));
});

test("serialize output is stable across repeated calls (idempotent formatting)", () => {
  const dir = makeTempReleaseNotesDir({
    "v1.0.0.md": "## Area\n- thing\n",
  });
  const a = mod.serialize(mod.buildReleaseNotes(dir));
  const b = mod.serialize(mod.buildReleaseNotes(dir));
  assert.equal(a, b);
  assert.equal(a, JSON.parse(a) && a); // valid JSON, sanity
});

test("runCheck passes right after runBuild, and fails once the md changes", () => {
  const dir = makeTempReleaseNotesDir({
    "v1.0.0.md": "## Area\n- thing\n",
  });
  const outputPath = path.join(dir, "out.json");

  mod.runBuild({ releaseNotesDir: dir, outputPath });
  process.exitCode = 0;
  const okBefore = mod.runCheck({ releaseNotesDir: dir, outputPath });
  assert.equal(okBefore, true);
  assert.notEqual(process.exitCode, 1);
  process.exitCode = 0;

  // Now drift the source without rebuilding the JSON.
  fs.writeFileSync(
    path.join(dir, "v1.1.0.md"),
    "## Area\n- a whole new release\n",
  );

  const okAfter = mod.runCheck({ releaseNotesDir: dir, outputPath });
  assert.equal(okAfter, false);
  assert.equal(process.exitCode, 1);
  process.exitCode = 0; // reset so this test file's own exit code stays clean
});

test("runCheck fails when the output file has never been generated", () => {
  const dir = makeTempReleaseNotesDir({
    "v1.0.0.md": "## Area\n- thing\n",
  });
  const outputPath = path.join(dir, "missing.json");

  const ok = mod.runCheck({ releaseNotesDir: dir, outputPath });
  assert.equal(ok, false);
  assert.equal(process.exitCode, 1);
  process.exitCode = 0;
});

test("markdownToWhatsApp: headings, bullets and bold convert; blank lines survive", () => {
  const md = [
    "## 🎉 Area",
    "",
    "A leading paragraph with **bold** text.",
    "",
    "- first item",
    "- **bold** second item",
  ].join("\n");

  const out = mod.markdownToWhatsApp(md);
  const lines = out.split("\n");

  assert.equal(lines[0], "*🎉 Area*");
  assert.equal(lines[1], "");
  assert.equal(lines[2], "A leading paragraph with *bold* text.");
  assert.equal(lines[3], "");
  assert.equal(lines[4], "• first item");
  assert.equal(lines[5], "• *bold* second item");
});

test("markdownToWhatsApp strips HTML comments before converting", () => {
  const out = mod.markdownToWhatsApp("<!-- skip me -->\n## Area\n- item\n");
  assert.ok(!out.includes("skip me"));
  assert.ok(out.includes("*Area*"));
  assert.ok(out.includes("• item"));
});

test("resolveNotesFile: 'unreleased' resolves to UNRELEASED.md, versions resolve to vX.Y.Z.md", () => {
  const dir = "/some/dir";
  assert.equal(
    mod.resolveNotesFile("unreleased", dir),
    path.join(dir, "UNRELEASED.md"),
  );
  assert.equal(
    mod.resolveNotesFile("UNRELEASED", dir),
    path.join(dir, "UNRELEASED.md"),
  );
  assert.equal(
    mod.resolveNotesFile("1.31.0", dir),
    path.join(dir, "v1.31.0.md"),
  );
  assert.equal(
    mod.resolveNotesFile("v1.31.0", dir),
    path.join(dir, "v1.31.0.md"),
  );
  assert.throws(() => mod.resolveNotesFile("not-a-version", dir));
});

test("runWhatsapp prints the converted content of the requested version to stdout", () => {
  const dir = makeTempReleaseNotesDir({
    "v1.0.0.md": "## Area\n- **important** thing\n",
    "UNRELEASED.md": "<!-- instructions -->\n## Area\n- pending thing\n",
  });

  let captured = "";
  const originalLog = console.log;
  console.log = (msg) => {
    captured += `${msg}\n`;
  };
  try {
    mod.runWhatsapp("1.0.0", dir);
  } finally {
    console.log = originalLog;
  }

  assert.ok(captured.includes("*Area*"));
  assert.ok(captured.includes("• *important* thing"));
});
