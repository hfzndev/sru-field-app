const { withAppBuildGradle } = require('expo/config-plugins');

/**
 * Pins the Android SDK CMake version used for the native build.
 *
 * AGP defaults to CMake 3.22.1, which bundles ninja 1.10 — and that ninja
 * rejects any path over 260 characters with `Filename longer than 260
 * characters`, regardless of the Windows LongPathsEnabled setting, because the
 * check is ninja's own rather than the OS's.
 *
 * React Native's codegen mirrors each source file's absolute path into the
 * object file's path, so a single gesture-handler shadow node comes out at 293
 * characters *relative to the build directory*. That is already over the limit
 * before any project path is prepended, which is why moving the project
 * somewhere shorter does not help and only a newer ninja does.
 *
 * ninja 1.12 lifted the limit. It ships with SDK CMake 3.30+; 3.22.1 was never
 * back-patched. Install the pinned version with:
 *
 *   android sdk install cmake/3.31.6
 *
 * (Android Studio's SDK Manager works too — SDK Tools, untick "Hide Obsolete",
 * pick the CMake version.)
 */

const CMAKE_VERSION = '3.31.6';

const ANCHOR = 'android {';

const INJECTED = `android {
    // Pinned by plugins/withCmakeVersion.js. AGP's default (3.22.1) bundles
    // ninja 1.10, which cannot build this project on Windows — see the plugin
    // for why a shorter project path is not an alternative.
    externalNativeBuild {
        cmake {
            version "${CMAKE_VERSION}"
        }
    }
`;

module.exports = function withCmakeVersion(config) {
  return withAppBuildGradle(config, (gradleConfig) => {
    const contents = gradleConfig.modResults.contents;

    if (contents.includes('externalNativeBuild')) {
      throw new Error(
        'withCmakeVersion: android/app/build.gradle already declares an ' +
        'externalNativeBuild block. The template changed — merge the CMake ' +
        'version pin into it by hand rather than injecting a second one.',
      );
    }

    const index = contents.indexOf(ANCHOR);
    if (index === -1) {
      throw new Error(
        'withCmakeVersion: could not find the android { } block in ' +
        'android/app/build.gradle.',
      );
    }

    gradleConfig.modResults.contents =
      contents.slice(0, index) + INJECTED + contents.slice(index + ANCHOR.length);

    return gradleConfig;
  });
};
