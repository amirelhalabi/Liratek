#!/usr/bin/env node
// Build the latest phone app (native + JS) and run it on the iOS simulator or
// the Android emulator, pointed at either the LOCAL backend (local db file) or
// the DEPLOYED API.
//
//   node scripts/run-mobile.mjs <ios|android> <local|dev>
//
// Wired as `yarn ios:local`, `yarn ios:dev`, `yarn android:local`,
// `yarn android:dev` (mobile/package.json).
//
// Why each target gets its own Metro port: the API address is an
// EXPO_PUBLIC_ variable, which Expo injects from the environment of the Metro
// process serving the bundle. A Metro already running on 8081 (e.g. `yarn
// start`) would serve its own address, so every target starts a fresh Metro
// on a dedicated port with the right address set.
//
// Never uses EAS or any online Expo service: everything builds on this Mac.
import { execSync, spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const [platform, target] = process.argv.slice(2);
const PLATFORMS = ["ios", "android"];
const TARGETS = ["local", "dev"];
if (!PLATFORMS.includes(platform) || !TARGETS.includes(target)) {
  console.error("Usage: node scripts/run-mobile.mjs <ios|android> <local|dev>");
  process.exit(1);
}

// The local backend (`yarn workspace @liratek/backend dev`) listens on 4310 and
// reads DATABASE_PATH from backend/.env (the local db file). The Android
// emulator reaches the Mac's localhost as 10.0.2.2.
const LOCAL_PORT = 4310;
const API = {
  local:
    platform === "android"
      ? `http://10.0.2.2:${LOCAL_PORT}`
      : `http://localhost:${LOCAL_PORT}`,
  dev: "https://api.liratek.shop",
}[target];
const METRO_PORT = target === "local" ? 8091 : 8092;
const IOS_DEVICE = process.env.IOS_DEVICE ?? "iPhone 17";
const ANDROID_AVD = process.env.ANDROID_AVD ?? "LiraTek_Pixel";

const env = {
  ...process.env,
  APP_VARIANT: "local", // the development app "LiraTek Local" (shop.liratek.app.local)
  EXPO_PUBLIC_API_BASE_URL: API,
  CI: "1", // no interactive prompts from the Expo CLI
};

if (platform === "android") {
  // Gradle does not run on the default JDK 26; use Homebrew's JDK 17.
  const jdk17 =
    "/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home";
  if (!process.env.JAVA_HOME && existsSync(jdk17)) env.JAVA_HOME = jdk17;
  env.ANDROID_HOME ??= join(homedir(), "Library/Android/sdk");
}

async function localBackendUp() {
  try {
    await fetch(`http://localhost:${LOCAL_PORT}/`, {
      signal: AbortSignal.timeout(3000),
    });
    return true; // any HTTP answer means the server is listening
  } catch {
    return false;
  }
}

if (target === "local" && !(await localBackendUp())) {
  console.error(
    `The local backend is not answering on http://localhost:${LOCAL_PORT}.\n` +
      "Start it first (from the repo root): yarn workspace @liratek/backend dev",
  );
  process.exit(1);
}

function run(cmd, args) {
  console.log(`\n> ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", env });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

console.log(
  `Phone app: ${platform}, API ${API} (${target === "local" ? "local db file" : "deployed"}), Metro :${METRO_PORT}`,
);

// Sync the native project with app.config.ts (app id, splash, plugins) without
// wiping it; a `--clean` prebuild is only needed after removing plugins.
// (`expo run:ios` installs pods itself when they changed.)
run("npx", ["expo", "prebuild", "--platform", platform, "--no-install"]);

if (platform === "android") {
  const adb = join(env.ANDROID_HOME, "platform-tools/adb");
  const online = () =>
    execSync(`"${adb}" devices`, { encoding: "utf8" })
      .split("\n")
      .some((l) => /\tdevice$/.test(l));
  // No phone attached: start the virtual phone and wait until Android has booted.
  if (!online()) {
    console.log(`\nStarting the Android emulator (${ANDROID_AVD})…`);
    spawn(join(env.ANDROID_HOME, "emulator/emulator"), ["-avd", ANDROID_AVD], {
      detached: true,
      stdio: "ignore",
      env,
    }).unref();
    execSync(`"${adb}" wait-for-device`, { stdio: "ignore" });
    while (
      execSync(`"${adb}" shell getprop sys.boot_completed`, {
        encoding: "utf8",
      }).trim() !== "1"
    ) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  // Let the emulator reach this Metro through its own localhost too.
  execSync(`"${adb}" reverse tcp:${METRO_PORT} tcp:${METRO_PORT}`, {
    stdio: "ignore",
  });
}

run("npx", [
  "expo",
  `run:${platform}`,
  "--port",
  String(METRO_PORT),
  ...(platform === "ios" ? ["--device", IOS_DEVICE] : []),
]);
