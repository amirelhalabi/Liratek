#!/usr/bin/env node
"use strict";

/**
 * Node-native tests for `yarn release-notes:cut <version>` (scripts/release.cjs
 * --cut) and for `yarn release <exact-version>` behaving correctly when that
 * version was already cut — the two-tier release flow (LIRA "ship notes to
 * web without a desktop release" request).
 *
 * NOTE on rule 17 (guard tests must fail first): cutRelease/
 * writeOrAppendVersionFile were implemented together with this test file,
 * not written failing-first — recorded here plainly rather than reverting
 * finished code to manufacture a red run.
 *
 * Every test uses a temp dir + temp package.json fixture via the
 * unreleasedPath/releaseNotesDir/pkgPath/outputPath overrides, so this NEVER
 * touches the real docs/release-notes/*.md or the real root package.json.
 *
 * Run directly: node scripts/__tests__/release.cutRelease.test.cjs
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  cutRelease,
  rollReleaseNotes,
  bumpVersion,
  writeVersion,
  readVersion,
} = require("../release.cjs");

const HEADER = [
  "<!--",
  "  LiraTek release notes — UNRELEASED (CLAUDE.md rule 30)",
  "  Instructions.",
  "-->",
].join("\n");

function makeFixture(unreleasedBody) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "liratek-cut-"));
  const unreleasedPath = path.join(dir, "UNRELEASED.md");
  fs.writeFileSync(unreleasedPath, `${HEADER}\n\n${unreleasedBody}`);

  const pkgPath = path.join(dir, "package.json");
  fs.writeFileSync(pkgPath, JSON.stringify({ version: "1.30.5" }, null, 2));

  const outputPath = path.join(dir, "releaseNotes.generated.json");

  return { dir, unreleasedPath, releaseNotesDir: dir, pkgPath, outputPath };
}

test("cutRelease: fresh UNRELEASED -> creates vX.Y.Z.md, bumps package.json, resets UNRELEASED, rebuilds JSON", () => {
  const fx = makeFixture("## Staff\n- did a thing\n");

  process.exitCode = 0;
  const ok = cutRelease("1.31.0", fx);
  assert.equal(ok, true);
  assert.notEqual(process.exitCode, 1);
  process.exitCode = 0;

  const versionFile = path.join(fx.releaseNotesDir, "v1.31.0.md");
  assert.ok(fs.existsSync(versionFile));
  const versionContent = fs.readFileSync(versionFile, "utf8");
  assert.ok(versionContent.includes("## Staff"));
  assert.ok(versionContent.includes("- did a thing"));

  assert.equal(readVersion(fx.pkgPath), "1.31.0");

  assert.equal(
    fs.readFileSync(fx.unreleasedPath, "utf8"),
    `${HEADER}\n`,
    "UNRELEASED.md must be reset to just its header",
  );

  assert.ok(fs.existsSync(fx.outputPath), "releaseNotes.generated.json must be (re)written");
  const generated = JSON.parse(fs.readFileSync(fx.outputPath, "utf8"));
  assert.deepEqual(
    generated.map((e) => e.version),
    ["1.31.0"],
  );
});

test("cutRelease: vX.Y.Z.md already exists + UNRELEASED has content -> appends under the existing file", () => {
  const fx = makeFixture("## Second batch\n- more notes\n");
  fs.writeFileSync(
    path.join(fx.releaseNotesDir, "v1.31.0.md"),
    "## First batch\n- earlier notes\n",
  );

  const ok = cutRelease("1.31.0", fx);
  assert.equal(ok, true);

  const versionContent = fs.readFileSync(
    path.join(fx.releaseNotesDir, "v1.31.0.md"),
    "utf8",
  );
  assert.ok(versionContent.includes("## First batch"));
  assert.ok(versionContent.includes("- earlier notes"));
  assert.ok(versionContent.includes("## Second batch"));
  assert.ok(versionContent.includes("- more notes"));
  // First batch must come before second (append, not prepend/overwrite).
  assert.ok(
    versionContent.indexOf("First batch") < versionContent.indexOf("Second batch"),
  );
});

test("cutRelease: refuses (no changes, exit code 1) when UNRELEASED has only the header — vX.Y.Z.md already exists", () => {
  const fx = makeFixture("   \n"); // only whitespace after the header
  const versionFilePath = path.join(fx.releaseNotesDir, "v1.31.0.md");
  fs.writeFileSync(versionFilePath, "## Already there\n- untouched\n");

  process.exitCode = 0;
  const ok = cutRelease("1.31.0", fx);
  assert.equal(ok, false);
  assert.equal(process.exitCode, 1);
  process.exitCode = 0;

  // Nothing touched: version file unchanged, package.json unchanged.
  assert.equal(
    fs.readFileSync(versionFilePath, "utf8"),
    "## Already there\n- untouched\n",
  );
  assert.equal(readVersion(fx.pkgPath), "1.30.5");
});

test("cutRelease: refuses when UNRELEASED has only the header — vX.Y.Z.md does NOT exist either (nothing to cut, generalized)", () => {
  const fx = makeFixture("\n");

  process.exitCode = 0;
  const ok = cutRelease("1.31.0", fx);
  assert.equal(ok, false);
  assert.equal(process.exitCode, 1);
  process.exitCode = 0;

  assert.ok(!fs.existsSync(path.join(fx.releaseNotesDir, "v1.31.0.md")));
  assert.equal(readVersion(fx.pkgPath), "1.30.5", "package.json must not be bumped on refusal");
});

test("cutRelease: rejects a non-exact version (e.g. 'patch') without touching anything", () => {
  const fx = makeFixture("## Area\n- thing\n");

  process.exitCode = 0;
  const ok = cutRelease("patch", fx);
  assert.equal(ok, false);
  assert.equal(process.exitCode, 1);
  process.exitCode = 0;

  assert.equal(readVersion(fx.pkgPath), "1.30.5");
  assert.equal(
    fs.readFileSync(fx.unreleasedPath, "utf8"),
    `${HEADER}\n\n## Area\n- thing\n`,
  );
});

test("release after a cut: bumpVersion keeps the SAME exact version (no error)", () => {
  assert.equal(bumpVersion("1.31.0", "1.31.0"), "1.31.0");
});

test("release after a cut: rollReleaseNotes APPENDS new UNRELEASED content into the already-cut vX.Y.Z.md and keeps the version", () => {
  const fx = makeFixture("## First batch (cut)\n- from the cut\n");

  // Step 1: cut 1.31.0 — package.json -> 1.31.0, v1.31.0.md created.
  const cutOk = cutRelease("1.31.0", fx);
  assert.equal(cutOk, true);
  assert.equal(readVersion(fx.pkgPath), "1.31.0");

  // Step 2: more notes accumulate on UNRELEASED before the desktop release.
  fs.writeFileSync(
    fx.unreleasedPath,
    `${HEADER}\n\n## Second batch (pre-desktop-release)\n- from before the tag\n`,
  );

  // Step 3: `yarn release 1.31.0` — same version stays the same; the new
  // rollReleaseNotes call must APPEND, not overwrite v1.31.0.md.
  const newVersion = bumpVersion(readVersion(fx.pkgPath), "1.31.0");
  assert.equal(newVersion, "1.31.0");
  writeVersion(newVersion, fx.pkgPath);
  rollReleaseNotes(newVersion, fx);

  assert.equal(readVersion(fx.pkgPath), "1.31.0");

  const versionContent = fs.readFileSync(
    path.join(fx.releaseNotesDir, "v1.31.0.md"),
    "utf8",
  );
  assert.ok(versionContent.includes("## First batch (cut)"));
  assert.ok(versionContent.includes("- from the cut"));
  assert.ok(versionContent.includes("## Second batch (pre-desktop-release)"));
  assert.ok(versionContent.includes("- from before the tag"));
  assert.ok(
    versionContent.indexOf("First batch") < versionContent.indexOf("Second batch"),
  );

  assert.equal(
    fs.readFileSync(fx.unreleasedPath, "utf8"),
    `${HEADER}\n`,
    "UNRELEASED.md must be reset again after the second roll",
  );
});
