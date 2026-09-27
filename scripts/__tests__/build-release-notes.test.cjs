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

test("CRLF markdown input produces byte-identical JSON to LF input (line-ending bug)", () => {
  const lfContent = "## Area\n- thing one\n- thing two\n";
  const crlfContent = lfContent.replace(/\n/g, "\r\n");

  const lfDir = makeTempReleaseNotesDir({ "v1.0.0.md": lfContent });
  const crlfDir = makeTempReleaseNotesDir({ "v1.0.0.md": crlfContent });

  const lfJson = mod.serialize(mod.buildReleaseNotes(lfDir));
  const crlfJson = mod.serialize(mod.buildReleaseNotes(crlfDir));

  assert.equal(
    crlfJson,
    lfJson,
    "a CRLF-checked-out .md must build the exact same JSON as an LF one",
  );
  assert.ok(!crlfJson.includes("\r"), "no \\r should survive into the generated JSON");
});

test("--check passes for a JSON built from LF compared against CRLF md, and the reverse", () => {
  const lfContent = "## Area\n- thing\n";
  const crlfContent = lfContent.replace(/\n/g, "\r\n");

  // Case A: JSON was generated from LF md, then the md file itself is a CRLF
  // working-tree checkout (Windows autocrlf) at --check time.
  const dirA = makeTempReleaseNotesDir({ "v1.0.0.md": lfContent });
  const outputPathA = path.join(dirA, "out.json");
  mod.runBuild({ releaseNotesDir: dirA, outputPath: outputPathA });
  fs.writeFileSync(path.join(dirA, "v1.0.0.md"), crlfContent);
  process.exitCode = 0;
  const okA = mod.runCheck({ releaseNotesDir: dirA, outputPath: outputPathA });
  assert.equal(okA, true, "--check must pass: LF-built JSON vs CRLF md on disk");
  assert.notEqual(process.exitCode, 1);
  process.exitCode = 0;

  // Case B: JSON was generated from CRLF md (so its body is normalized to \n
  // internally), then the JSON FILE on disk is itself checked out with CRLF
  // line endings (autocrlf rewriting the committed LF file on Windows).
  const dirB = makeTempReleaseNotesDir({ "v1.0.0.md": crlfContent });
  const outputPathB = path.join(dirB, "out.json");
  mod.runBuild({ releaseNotesDir: dirB, outputPath: outputPathB });
  const jsonWithCrlf = fs
    .readFileSync(outputPathB, "utf8")
    .replace(/\n/g, "\r\n");
  fs.writeFileSync(outputPathB, jsonWithCrlf);
  process.exitCode = 0;
  const okB = mod.runCheck({ releaseNotesDir: dirB, outputPath: outputPathB });
  assert.equal(
    okB,
    true,
    "--check must pass: CRLF-built JSON content vs the JSON file itself checked out as CRLF",
  );
  assert.notEqual(process.exitCode, 1);
  process.exitCode = 0;
});

test("markdownToWhatsApp normalizes CRLF input the same as LF input", () => {
  const lf = "## Area\n\n- **bold** item\n";
  const crlf = lf.replace(/\n/g, "\r\n");
  assert.equal(mod.markdownToWhatsApp(crlf), mod.markdownToWhatsApp(lf));
  assert.ok(!mod.markdownToWhatsApp(crlf).includes("\r"));
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
