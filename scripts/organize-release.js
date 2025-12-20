import fs from "fs";
import path from "path";

const releaseDir = path.resolve("releases");
const metadataDir = path.join(releaseDir, "metadata");

async function organize() {
  if (!fs.existsSync(releaseDir)) return;
  if (!fs.existsSync(metadataDir))
    fs.mkdirSync(metadataDir, { recursive: true });

  // 1. Rename macarm64 to macArm BEFORE moving things to metadata
  const arm64Path = path.join(releaseDir, "macarm64");
  const armPath = path.join(releaseDir, "macArm");
  if (fs.existsSync(arm64Path)) {
    if (fs.existsSync(armPath))
      fs.rmSync(armPath, { recursive: true, force: true });
    fs.renameSync(arm64Path, armPath);
    console.log("Renamed macarm64 to macArm");
  }

  // 2. Refresh items list after rename
  const items = fs.readdirSync(releaseDir);
  const keepList = ["macArm", "macx64", "winx64", "metadata"];

  for (const item of items) {
    const fullPath = path.join(releaseDir, item);

    // Skip the ones we want to keep
    if (keepList.includes(item)) {
      continue;
    }

    // Move everything else to metadata
    const destPath = path.join(metadataDir, item);
    try {
      if (fs.existsSync(destPath)) {
        fs.rmSync(destPath, { recursive: true, force: true });
      }
      fs.renameSync(fullPath, destPath);
      console.log(`Moved ${item} to metadata/`);
    } catch (e) {
      console.error(`Could not move ${item}:`, e.message);
    }
  }
}

organize().catch(console.error);
