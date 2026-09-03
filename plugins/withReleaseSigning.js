const { withAppBuildGradle } = require('expo/config-plugins');

/**
 * Signs release builds with our own key instead of Android's public debug key.
 *
 * The prebuild template ships `buildTypes.release { signingConfig
 * signingConfigs.debug }` and warns about it in a comment nobody reads. Left
 * alone, `assembleRelease` produces an APK signed with the keystore whose
 * password is literally "android" — so anyone could build a replacement APK
 * that Android would install straight over ours as an update. For handsets
 * whose records are the plant's compliance trail, that is not acceptable.
 *
 * This lives in a config plugin rather than in android/app/build.gradle
 * because that directory is generated: `npx expo prebuild --clean` deletes it,
 * and a fix applied there would silently disappear on the next regeneration
 * (docs.expo.dev/workflow/prebuild — customisations belong in config plugins).
 *
 * The credentials themselves never enter this repository. They are read from
 * Gradle properties, which live in ~/.gradle/gradle.properties on the build
 * machine — see docs/APK-BUILD.md.
 */

const PROPERTY = 'SRU_RELEASE_STORE_FILE';

/**
 * The template block we expect to find. Matched in full, and the plugin throws
 * if it is missing: a failed prebuild is recoverable, whereas a quietly
 * unpatched template ships a debug-signed APK that looks completely normal.
 */
const TEMPLATE_RELEASE_SIGNING = `        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug`;

const PATCHED_RELEASE_SIGNING = `        release {
            signingConfig signingConfigs.release`;

const TEMPLATE_DEBUG_CONFIG = `    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }`;

const PATCHED_SIGNING_CONFIGS = `    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        release {
            // Guarded rather than required: a machine that only ever builds
            // debug has no reason to hold the release key, and Gradle
            // configures every build type on every build.
            if (project.hasProperty('${PROPERTY}')) {
                storeFile file(project.property('${PROPERTY}'))
                storePassword project.property('SRU_RELEASE_STORE_PASSWORD')
                keyAlias project.property('SRU_RELEASE_KEY_ALIAS')
                keyPassword project.property('SRU_RELEASE_KEY_PASSWORD')
            }
        }
    }`;

/**
 * Refuses a release build with no key, rather than falling back to something
 * that still produces an installable file. An unsigned or debug-signed APK is
 * the failure worth being loud about, because it is indistinguishable from a
 * correct one until an update refuses to install months later.
 */
const RELEASE_GUARD = `
// Added by plugins/withReleaseSigning.js — do not edit here, this file is generated.
gradle.taskGraph.whenReady { graph ->
    def buildingRelease = graph.allTasks.any { it.path.toLowerCase().contains('release') }
    if (buildingRelease && !project.hasProperty('${PROPERTY}')) {
        throw new GradleException(
            "Release build has no signing key.\\n" +
            "Set ${PROPERTY}, SRU_RELEASE_STORE_PASSWORD, SRU_RELEASE_KEY_ALIAS and\\n" +
            "SRU_RELEASE_KEY_PASSWORD in ~/.gradle/gradle.properties — see docs/APK-BUILD.md.\\n" +
            "Refusing to fall back to the public Android debug key.")
    }
}
`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (gradleConfig) => {
    let contents = gradleConfig.modResults.contents;

    for (const [name, anchor] of [
      ['signingConfigs', TEMPLATE_DEBUG_CONFIG],
      ['buildTypes.release', TEMPLATE_RELEASE_SIGNING],
    ]) {
      if (!contents.includes(anchor)) {
        throw new Error(
          `withReleaseSigning: could not find the expected ${name} block in ` +
          'android/app/build.gradle. The prebuild template has changed — update ' +
          'plugins/withReleaseSigning.js before building, or the release APK will ' +
          'be signed with the public debug key.',
        );
      }
    }

    contents = contents.replace(TEMPLATE_DEBUG_CONFIG, PATCHED_SIGNING_CONFIGS);
    contents = contents.replace(TEMPLATE_RELEASE_SIGNING, PATCHED_RELEASE_SIGNING);
    contents += RELEASE_GUARD;

    gradleConfig.modResults.contents = contents;
    return gradleConfig;
  });
};
