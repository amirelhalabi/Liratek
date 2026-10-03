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

/** Minimal PNG header (signature + IHDR length/type + width/height) — enough
 * for the dimension reader, which only looks at the first 24 bytes. */
function makePngHeader(width, height) {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write("IHDR", 12, "ascii");
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

function highlightFixture(pngBytes, file = "shot.png") {
  const dir = makeTempReleaseNotesDir({
    "v1.33.0.md": [
      "## ✨ Highlights",
      "### Faster checkout",
      "One tap checkout.",
      `![Checkout](whats-new/1.33.0/${file})`,
    ].join("\n"),
  });
  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), "liratek-public-"));
  fs.mkdirSync(path.join(publicDir, "whats-new", "1.33.0"), { recursive: true });
  fs.writeFileSync(path.join(publicDir, "whats-new", "1.33.0", file), pngBytes);
  return { dir, publicDir };
}

test("highlight images: a landscape PNG passes", () => {
  const { dir, publicDir } = highlightFixture(makePngHeader(1280, 720));
  const entries = mod.buildReleaseNotes(dir);
  assert.deepEqual(mod.validateHighlightImages(entries, publicDir), []);
});

test("highlight images: a portrait PNG fails, naming the file", () => {
  const { dir, publicDir } = highlightFixture(makePngHeader(720, 1280), "tall.png");
  const entries = mod.buildReleaseNotes(dir);
  const problems = mod.validateHighlightImages(entries, publicDir);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /tall\.png/);
  assert.match(problems[0], /landscape/);
});

test("highlight images: a square PNG fails (height >= width)", () => {
  const { dir, publicDir } = highlightFixture(makePngHeader(500, 500), "sq.png");
  const problems = mod.validateHighlightImages(mod.buildReleaseNotes(dir), publicDir);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /sq\.png/);
});

test("highlight images: runCheck and runBuild both fail on a portrait PNG", () => {
  const { dir, publicDir } = highlightFixture(makePngHeader(720, 1280), "tall.png");
  const outputPath = path.join(dir, "out.json");

  process.exitCode = 0;
  assert.equal(mod.runCheck({ releaseNotesDir: dir, outputPath, publicDir }), false);
  assert.equal(process.exitCode, 1);

  process.exitCode = 0;
  mod.runBuild({ releaseNotesDir: dir, outputPath, publicDir });
  assert.equal(process.exitCode, 1);
  assert.equal(fs.existsSync(outputPath), false, "nothing is written on failure");
  process.exitCode = 0;
});

test("highlight images: a non-PNG file is rejected", () => {
  const { dir, publicDir } = highlightFixture("not-a-png", "bad.png");
  const problems = mod.validateHighlightImages(mod.buildReleaseNotes(dir), publicDir);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /bad\.png/);
});

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

// --- Highlights (owner decisions 2026-10-03) --------------------------

test("buildReleaseNotes parses a ## Highlights section into entries[].highlights, and strips it from body", () => {
  const dir = makeTempReleaseNotesDir({
    "v1.33.0.md": [
      "## ✨ Highlights",
      "",
      "### Faster checkout",
      "Checkout now takes one tap instead of three.",
      "![Checkout screen](whats-new/1.33.0/checkout.png)",
      "",
      "### Dark mode",
      "The whole app now supports dark mode.",
      "",
      "## 💸 OMT / Whish & suppliers",
      "- A normal grouped bullet, unaffected by the section above.",
    ].join("\n"),
  });
  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), "liratek-public-"));
  fs.mkdirSync(path.join(publicDir, "whats-new", "1.33.0"), { recursive: true });
  fs.writeFileSync(
    path.join(publicDir, "whats-new", "1.33.0", "checkout.png"),
    makePngHeader(1280, 720),
  );

  const entries = mod.buildReleaseNotes(dir);
  const entry = entries[0];

  assert.equal(entry.highlights.length, 2);
  assert.equal(entry.highlights[0].title, "Faster checkout");
  assert.equal(
    entry.highlights[0].summary,
    "Checkout now takes one tap instead of three.",
  );
  assert.deepEqual(entry.highlights[0].image, {
    alt: "Checkout screen",
    src: "whats-new/1.33.0/checkout.png",
  });
  assert.equal(entry.highlights[1].title, "Dark mode");
  assert.equal(entry.highlights[1].image, undefined);

  // Highlights section must be gone from body; the normal section survives.
  assert.ok(!entry.body.includes("Highlights"));
  assert.ok(!entry.body.includes("Faster checkout"));
  assert.ok(entry.body.includes("A normal grouped bullet"));

  assert.deepEqual(mod.validateHighlightImages(entries, publicDir), []);
});

test("a version with no Highlights section gets no `highlights` key at all (backward compatible)", () => {
  const dir = makeTempReleaseNotesDir({
    "v1.0.0.md": "## Area\n- a plain old release note\n",
  });
  const entries = mod.buildReleaseNotes(dir);
  assert.equal("highlights" in entries[0], false);
  assert.ok(entries[0].body.includes("a plain old release note"));
});

test("validateHighlightImages reports a missing image file", () => {
  const dir = makeTempReleaseNotesDir({
    "v1.33.0.md": [
      "## ✨ Highlights",
      "### Faster checkout",
      "One tap checkout.",
      "![Checkout](whats-new/1.33.0/missing.png)",
    ].join("\n"),
  });
  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), "liratek-public-"));

  const entries = mod.buildReleaseNotes(dir);
  const problems = mod.validateHighlightImages(entries, publicDir);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /missing\.png/);
});

test("validateHighlightImages rejects an image path that is not under whats-new/ (e.g. an external URL)", () => {
  const dir = makeTempReleaseNotesDir({
    "v1.33.0.md": [
      "## ✨ Highlights",
      "### Faster checkout",
      "One tap checkout.",
      "![Checkout](https://evil.example.com/x.png)",
    ].join("\n"),
  });
  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), "liratek-public-"));

  const entries = mod.buildReleaseNotes(dir);
  const problems = mod.validateHighlightImages(entries, publicDir);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /not (under|allowed)/i);
});

test("runCheck fails when a Highlights image file referenced by the markdown does not exist", () => {
  const dir = makeTempReleaseNotesDir({
    "v1.33.0.md": [
      "## ✨ Highlights",
      "### Faster checkout",
      "One tap checkout.",
      "![Checkout](whats-new/1.33.0/missing.png)",
    ].join("\n"),
  });
  const outputPath = path.join(dir, "out.json");
  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), "liratek-public-"));

  process.exitCode = 0;
  const ok = mod.runCheck({ releaseNotesDir: dir, outputPath, publicDir });
  assert.equal(ok, false);
  assert.equal(process.exitCode, 1);
  process.exitCode = 0;
});

test("markdownToWhatsApp converts Highlights into '• *Title*: sentence' lines and drops the image", () => {
  const md = [
    "## ✨ Highlights",
    "",
    "### Faster checkout",
    "Checkout now takes one tap.",
    "![Checkout screen](whats-new/1.33.0/checkout.png)",
    "",
    "### Dark mode",
    "The whole app now supports **dark mode**.",
    "",
    "## 💸 OMT / Whish & suppliers",
    "- A normal grouped bullet.",
  ].join("\n");

  const out = mod.markdownToWhatsApp(md);

  assert.ok(!out.includes("whats-new/"), "image line must be dropped");
  assert.ok(!out.includes("!["), "no raw image markdown must survive");
  assert.ok(out.includes("• *Faster checkout*: Checkout now takes one tap."));
  assert.ok(
    out.includes("• *Dark mode*: The whole app now supports *dark mode*."),
  );
  assert.ok(out.includes("• A normal grouped bullet."));
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
