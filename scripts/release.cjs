#!/usr/bin/env node

/**
 * Release script for LiraTek POS
 *
 * Usage:
 *   yarn release              # bump patch (1.18.48 → 1.18.49)
 *   yarn release minor        # bump minor (1.18.48 → 1.19.0)
 *   yarn release major        # bump major (1.18.48 → 2.0.0)
 *   yarn release 1.20.0       # set exact version
 *
 * What it does:
 *   1. Checks for uncommitted changes (stages them)
 *   2. Bumps version in package.json
 *   3. Rolls docs/release-notes/UNRELEASED.md into vX.Y.Z.md and rebuilds
 *      releaseNotes.generated.json (the in-app "What's new" data)
 *   4. Commits all changes with "release: vX.Y.Z"
 *   5. Creates git tag vX.Y.Z
 *   6. Pushes commit + tag (triggers the desktop CI build workflow, which
 *      only runs on a v* tag push — see .github/workflows/build.yml)
 *
 * ---
 *
 *   yarn release-notes:cut <version>   (node scripts/release.cjs --cut <version>)
 *
 * Ships release notes to the WEB app (Vercel builds every push to `main`)
 * WITHOUT publishing a desktop release (which needs a `v*` tag). Bumps
 * package.json's version and rolls UNRELEASED.md exactly like `yarn
 * release` does, rebuilds releaseNotes.generated.json, but does NOT touch
 * git at all — commit and push `main` yourself when ready.
 *
 * `yarn release <exact-version>` afterwards (once you DO want the desktop
 * build) is safe to run for that same version: it keeps the version and
 * APPENDS any release notes added since the cut into the same vX.Y.Z.md,
 * then tags and pushes as usual.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const releaseNotesBuilder = require("./build-release-notes.cjs");

const PKG_PATH = path.resolve(__dirname, "..", "package.json");
const RELEASE_NOTES_DIR = path.resolve(
  __dirname,
  "..",
  "docs",
  "release-notes",
);
const UNRELEASED_PATH = path.join(RELEASE_NOTES_DIR, "UNRELEASED.md");

function run(cmd, opts = {}) {
  console.log(`  → ${cmd}`);
  return execSync(cmd, {
    cwd: path.resolve(__dirname, ".."),
    stdio: opts.silent ? "pipe" : "inherit",
    ...opts,
  });
}

function readVersion(pkgPath = PKG_PATH) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  return pkg.version;
}

function writeVersion(version, pkgPath = PKG_PATH) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  pkg.version = version;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
}

function bumpVersion(current, type) {
  const [major, minor, patch] = current.split(".").map(Number);
  switch (type) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    default:
      // Exact version provided
      if (/^\d+\.\d+\.\d+$/.test(type)) return type;
      console.error(
        `Unknown bump type: "${type}". Use patch, minor, major, or an exact version (e.g. 1.20.0)`,
      );
      process.exit(1);
  }
}

/** The leading HTML comment block (the "rules" header), preserved verbatim. */
function extractHeaderComment(markdown) {
  const match = markdown.match(/^<!--[\s\S]*?-->/);
  return match ? match[0] : "";
}

/**
 * Writes `bodyRaw` to `versionFilePath`. If that file already exists (e.g.
 * `yarn release-notes:cut` already created it, or `yarn release` is run
 * twice for the same version), the new content is APPENDED underneath the
 * existing content rather than overwriting or erroring — a version file is
 * cumulative, never a single writer's property.
 */
function writeOrAppendVersionFile(versionFilePath, bodyRaw) {
  const trimmedBody = releaseNotesBuilder.normalizeLineEndings(bodyRaw).trim();
  if (fs.existsSync(versionFilePath)) {
    const existing = releaseNotesBuilder
      .normalizeLineEndings(fs.readFileSync(versionFilePath, "utf8"))
      .trim();
    fs.writeFileSync(versionFilePath, `${existing}\n\n${trimmedBody}\n`);
  } else {
    fs.writeFileSync(versionFilePath, `${trimmedBody}\n`);
  }
}

/**
 * Rolls docs/release-notes/UNRELEASED.md into docs/release-notes/v<newVersion>.md
 * and resets UNRELEASED.md back to just its comment header, so the next
 * release starts from a clean slate. Called after the version bump and
 * before `git add -A`, so both files land in the release commit.
 *
 * If UNRELEASED.md has no real content beyond its instructional HTML
 * comment (and whitespace), nothing is moved — a clear warning is printed
 * and the release continues (the GitHub release / in-app What's new simply
 * have nothing new to show for this version). This is also what makes
 * re-running `yarn release <version>` for a version that was already
 * `release-notes:cut` safe: if UNRELEASED is empty (nothing added since the
 * cut), the existing vX.Y.Z.md is left exactly as the cut wrote it; if new
 * notes WERE added since the cut, they're appended (writeOrAppendVersionFile)
 * rather than clobbering what the cut already published.
 */
function rollReleaseNotes(
  newVersion,
  { unreleasedPath = UNRELEASED_PATH, releaseNotesDir = RELEASE_NOTES_DIR } = {},
) {
  if (!fs.existsSync(unreleasedPath)) {
    console.warn(
      "\n⚠ docs/release-notes/UNRELEASED.md not found — no release notes for this version. The GitHub release and in-app What's new will be empty/fallback.\n",
    );
    return;
  }

  const raw = releaseNotesBuilder.normalizeLineEndings(
    fs.readFileSync(unreleasedPath, "utf8"),
  );
  const header = extractHeaderComment(raw);
  const bodyRaw = header ? raw.slice(header.length) : raw;
  const bodyForEmptyCheck = releaseNotesBuilder
    .stripHtmlComments(bodyRaw)
    .trim();

  if (!bodyForEmptyCheck) {
    console.warn(
      "\n⚠ docs/release-notes/UNRELEASED.md has no release notes — the GitHub release and in-app What's new will be empty/fallback.\n",
    );
    return;
  }

  const versionFilePath = path.join(releaseNotesDir, `v${newVersion}.md`);
  writeOrAppendVersionFile(versionFilePath, bodyRaw);
  fs.writeFileSync(unreleasedPath, `${header}\n`);
  console.log(
    `  → moved docs/release-notes/UNRELEASED.md content into docs/release-notes/v${newVersion}.md`,
  );
}

/**
 * `yarn release-notes:cut <version>` — ships release notes to the WEB app
 * (Vercel builds `main` on every push) WITHOUT publishing a desktop release
 * (which only happens on a `v*` TAG push or manual dispatch, per
 * .github/workflows/build.yml). Bumps package.json's version (drives the
 * web sidebar's `__APP_VERSION__`), rolls UNRELEASED.md into
 * docs/release-notes/v<version>.md exactly like `yarn release` does, and
 * rebuilds releaseNotes.generated.json — all WITHOUT git add/commit/tag/push;
 * the caller commits and pushes to main themselves.
 *
 * Refuses (no files touched, no version bump) when there is nothing to cut:
 * UNRELEASED.md has no real content. The owner's spec names the case where
 * v<version>.md already exists too, but the underlying reason — nothing new
 * to publish — is identical whether or not that file exists yet, so this
 * refuses in both cases rather than drawing an arbitrary distinction.
 *
 * Returns true on success, false on refusal (mirrors runCheck/runBuild's
 * boolean-return, no-process.exit style so it's safely callable from tests).
 */
function cutRelease(
  version,
  {
    unreleasedPath = UNRELEASED_PATH,
    releaseNotesDir = RELEASE_NOTES_DIR,
    pkgPath = PKG_PATH,
    outputPath = releaseNotesBuilder.DEFAULT_OUTPUT_PATH,
  } = {},
) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    console.error(
      `\n❌ Invalid version "${version}" — expected an exact X.Y.Z (release-notes:cut never bumps).\n`,
    );
    process.exitCode = 1;
    return false;
  }

  if (!fs.existsSync(unreleasedPath)) {
    console.error(
      "\n❌ docs/release-notes/UNRELEASED.md not found — nothing to cut.\n",
    );
    process.exitCode = 1;
    return false;
  }

  const raw = releaseNotesBuilder.normalizeLineEndings(
    fs.readFileSync(unreleasedPath, "utf8"),
  );
  const header = extractHeaderComment(raw);
  const bodyRaw = header ? raw.slice(header.length) : raw;
  const bodyForEmptyCheck = releaseNotesBuilder
    .stripHtmlComments(bodyRaw)
    .trim();

  if (!bodyForEmptyCheck) {
    console.error(
      `\n❌ docs/release-notes/UNRELEASED.md has no release notes — nothing to cut for v${version}.\n`,
    );
    process.exitCode = 1;
    return false;
  }

  const versionFilePath = path.join(releaseNotesDir, `v${version}.md`);
  writeOrAppendVersionFile(versionFilePath, bodyRaw);
  fs.writeFileSync(unreleasedPath, `${header}\n`);
  writeVersion(version, pkgPath);
  releaseNotesBuilder.runBuild({ releaseNotesDir, outputPath });

  console.log(
    `\nnotes cut for v${version} — commit and push to main to show them on the web; no desktop release was made (no tag).\n`,
  );
  return true;
}

function main() {
  if (process.argv[2] === "--cut") {
    const version = process.argv[3];
    if (!version) {
      console.error("Usage: yarn release-notes:cut <version>");
      process.exit(1);
      return;
    }
    const ok = cutRelease(version);
    process.exit(ok ? 0 : 1);
    return;
  }

  const arg = process.argv[2] || "patch";
  const currentVersion = readVersion();
  const newVersion = bumpVersion(currentVersion, arg);
  const tag = `v${newVersion}`;

  console.log(`\n🚀 LiraTek Release: ${currentVersion} → ${newVersion}\n`);

  // Check if tag already exists
  try {
    const existingTags = run(`git tag -l "${tag}"`, { silent: true })
      .toString()
      .trim();
    if (existingTags) {
      console.error(
        `\n❌ Tag ${tag} already exists. Delete it first or choose a different version.`,
      );
      process.exit(1);
    }
  } catch {
    // git tag -l won't fail
  }

  // 1. Bump version
  console.log(`\n[1/5] Bumping version...`);
  writeVersion(newVersion);

  // Release notes: move UNRELEASED.md → docs/release-notes/vX.Y.Z.md, then
  // rebuild the generated JSON the in-app "What's new" screen reads. Both
  // must land in the same commit as the version bump, so this runs before
  // `git add -A` below.
  console.log(`\n[Release notes] Rolling UNRELEASED.md → ${tag}.md...`);
  rollReleaseNotes(newVersion);
  console.log(`\n[Release notes] Rebuilding releaseNotes.generated.json...`);
  releaseNotesBuilder.runBuild();

  // 2. Stage all changes
  console.log(`\n[2/5] Staging changes...`);
  run("git add -A");

  // 3. Commit
  console.log(`\n[3/5] Committing...`);
  run(`git commit -m "release: ${tag}"`);

  // 4. Tag
  console.log(`\n[4/5] Tagging ${tag}...`);
  run(`git tag ${tag}`);

  // 5. Push
  console.log(`\n[5/5] Pushing...`);
  run("git push");
  run("git push --tags");

  console.log(
    `\n✅ Released ${tag} — CI build workflow should start shortly.\n`,
  );
}

if (require.main === module) {
  main();
}

module.exports = {
  bumpVersion,
  readVersion,
  writeVersion,
  extractHeaderComment,
  writeOrAppendVersionFile,
  rollReleaseNotes,
  cutRelease,
};
