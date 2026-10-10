// Signs Android RELEASE builds with LiraTek's own upload key, kept OUTSIDE the
// repo. android/ is generated (CNG), so the signing config is injected here
// instead of hand-edited. The key's location and passwords come from Gradle
// properties (~/.gradle/gradle.properties), never from this file:
//
//   LIRATEK_UPLOAD_STORE_FILE=/absolute/path/liratek-release.keystore
//   LIRATEK_UPLOAD_STORE_PASSWORD=…
//   LIRATEK_UPLOAD_KEY_ALIAS=liratek
//   LIRATEK_UPLOAD_KEY_PASSWORD=…
//
// Without those properties a release build falls back to the debug key (fine
// for local testing, never for an APK given to a shop — updates must be signed
// with the SAME key or Android refuses to install them over the old app).
const { withAppBuildGradle } = require("expo/config-plugins");

const RELEASE_CONFIG = `
        release {
            if (project.hasProperty('LIRATEK_UPLOAD_STORE_FILE')) {
                storeFile file(LIRATEK_UPLOAD_STORE_FILE)
                storePassword LIRATEK_UPLOAD_STORE_PASSWORD
                keyAlias LIRATEK_UPLOAD_KEY_ALIAS
                keyPassword LIRATEK_UPLOAD_KEY_PASSWORD
            }
        }`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    if (!gradle.includes("LIRATEK_UPLOAD_STORE_FILE")) {
      gradle = gradle.replace(/signingConfigs\s*\{/, (m) => `${m}${RELEASE_CONFIG}`);
      // Inside buildTypes.release, use our key when it is configured.
      gradle = gradle.replace(
        /(release\s*\{[^}]*?)signingConfig signingConfigs\.debug/,
        "$1signingConfig project.hasProperty('LIRATEK_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug",
      );
    }
    cfg.modResults.contents = gradle;
    return cfg;
  });
};
