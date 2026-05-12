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
 *   3. Commits all changes with "release: vX.Y.Z"
 *   4. Creates git tag vX.Y.Z
 *   5. Pushes commit + tag (triggers CI build workflow)
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const PKG_PATH = path.resolve(__dirname, "..", "package.json");

function run(cmd, opts = {}) {
  console.log(`  → ${cmd}`);
  return execSync(cmd, {
    cwd: path.resolve(__dirname, ".."),
    stdio: opts.silent ? "pipe" : "inherit",
    ...opts,
  });
}

function readVersion() {
  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, "utf8"));
  return pkg.version;
}

function writeVersion(version) {
  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, "utf8"));
  pkg.version = version;
  fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + "\n");
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

function main() {
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

main();
